#!/usr/bin/env python3
"""
Season-long player projections for the FantasyNow+ site.

Runs the same Monte Carlo engine as run_players.py, but across all 17 games
on a team's schedule instead of one week, and writes the result to the
player_proj table as id=2.

THIS IS A PRESEASON BENCHMARK. It rebuilds freely until the first kickoff of
week 1, then locks permanently -- it is the published preseason view of the
season, not a rest-of-season forecast, so it must not move once games start.
Re-running after kickoff exits without touching the stored payload.

WHY THE MATH IS EASY
--------------------
Games are independent, so a player's season line is just the sum of their
per-game lines, and the season covariance is the sum of the per-game
covariances. That means the browser rescores season totals with exactly the
same formula it uses for a single week -- no second contract to maintain.
Summing 17 games also pulls the distribution toward normal, so season floor
and ceiling use the normal 10th/90th percentiles rather than the skewed
per-game z-offsets.

GAME ENVIRONMENTS
-----------------
nflverse publishes the full schedule with betting lines attached to the
games books have posted. Those are used directly. For the rest, each team's
scoring level is estimated from the games it DOES have lines for, and the
matchup total and spread are built from those two numbers. That is an
approximation, and the further out the week, the softer it gets.

Run:
    python run_season.py --season 2026 --sims 2000
"""

import argparse
import csv
import io
import json
import os
import sys
import tempfile
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import run_players as rp
import player_sim
import build_players_from_nflverse as nflverse
from player_sim import PPR, load_players_csv, simulate_players_for_game
from nfl_simulator import Game
from run_sim import _spread_to_ml_pair

SCHEDULE_CSV = ("https://github.com/nflverse/nflverse-data/releases/download/"
                "schedules/games.csv")

LEAGUE_TOTAL = 44.5
ET_OFFSET_HOURS = 4
HOME_EDGE = 1.2
SEASON_Z10 = -1.2816
SEASON_Z90 = 1.2816


def download_schedule(season):
    req = urllib.request.Request(SCHEDULE_CSV, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        rows = list(csv.DictReader(io.StringIO(resp.read().decode())))
    games = [r for r in rows if r.get("season") == str(season)
             and r.get("game_type") == "REG"]
    if not games:
        raise SystemExit(f"nflverse has no {season} regular-season schedule yet.")
    lined = sum(1 for g in games if g.get("total_line"))
    print(f"  schedule: {len(games)} games, {lined} with posted lines")
    return games


def kickoff_of_week_one(games):
    """When the benchmark locks: the first kickoff of week 1, in UTC.
    nflverse gameday/gametime are Eastern."""
    from datetime import timedelta
    stamps = []
    for g in games:
        if g.get("week") != "1" or not g.get("gameday"):
            continue
        t = (g.get("gametime") or "13:00")[:5]
        try:
            et = datetime.strptime(f"{g['gameday']} {t}", "%Y-%m-%d %H:%M")
        except ValueError:
            continue
        stamps.append(et + timedelta(hours=ET_OFFSET_HOURS))
    if not stamps:
        return None
    return min(stamps).replace(tzinfo=timezone.utc)


def benchmark_exists():
    """True if a season benchmark has already been published."""
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return False
    req = urllib.request.Request(
        f"{url}/rest/v1/player_proj?id=eq.2&select=id",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return bool(json.loads(resp.read().decode()))
    except Exception:
        return False


def _f(v, default=None):
    try:
        return float(v) if v not in (None, "") else default
    except ValueError:
        return default


def team_scoring_levels(games):
    """Points per game each team is implied to score, from the lined games.

    nflverse spread_line is from the home team's view, positive when the
    home side is favored, so implied points are total/2 +/- spread/2."""
    scored = defaultdict(list)
    for g in games:
        total, spread = _f(g.get("total_line")), _f(g.get("spread_line"))
        if total is None or spread is None:
            continue
        home, away = rp.norm_abbr(g["home_team"]), rp.norm_abbr(g["away_team"])
        scored[home].append(total / 2 + spread / 2)
        scored[away].append(total / 2 - spread / 2)

    levels, base = {}, LEAGUE_TOTAL / 2
    for team, vals in scored.items():
        levels[team] = sum(vals) / len(vals)
    covered = len(levels)
    for g in games:
        for side in ("home_team", "away_team"):
            t = rp.norm_abbr(g[side])
            levels.setdefault(t, base)
    print(f"  scoring levels: {covered} teams from market lines, "
          f"{len(levels) - covered} at league average")
    return levels


def game_from_schedule(row, levels):
    home, away = rp.norm_abbr(row["home_team"]), rp.norm_abbr(row["away_team"])
    total, spread = _f(row.get("total_line")), _f(row.get("spread_line"))

    if total is None or spread is None:
        hp = levels.get(home, LEAGUE_TOTAL / 2) + HOME_EDGE / 2
        ap = levels.get(away, LEAGUE_TOTAL / 2) - HOME_EDGE / 2
        total, spread = round((hp + ap) * 2) / 2, round((hp - ap) * 2) / 2

    home_ml, away_ml = _spread_to_ml_pair(-spread)
    return Game(home_team=home, away_team=away, home_ml=home_ml, away_ml=away_ml,
                home_spread=-spread, total_line=total), home, away


def current_week(schedule):
    """First scheduled week that hasn't finished yet."""
    today = datetime.now(timezone.utc).date().isoformat()
    upcoming = [int(g["week"]) for g in schedule if (g.get("gameday") or "") >= today]
    return min(upcoming) if upcoming else 18


def build(season, weeks_window, sims, prior_season, cov_stride, limit_weeks,
          ros=False, from_week=None):
    schedule = download_schedule(season)

    if ros:
        start = from_week or current_week(schedule)
        schedule = [g for g in schedule if int(g["week"]) >= start]
        print(f"  rest of season: weeks {start}-18, {len(schedule)} games remaining")
        if not schedule:
            raise SystemExit("No games left in the season.")

    if limit_weeks:
        schedule = [g for g in schedule if int(g["week"]) <= limit_weeks]
        print(f"  limited to weeks 1-{limit_weeks}: {len(schedule)} games")

    levels = team_scoring_levels(schedule)
    teams = sorted({rp.norm_abbr(g["home_team"]) for g in schedule} |
                   {rp.norm_abbr(g["away_team"]) for g in schedule})

    tmp = os.path.join(tempfile.gettempdir(), "players_usage_season.csv")
    nflverse.build(season, weeks_window, teams, tmp, prior_season)
    by_team = load_players_csv(tmp)

    # Week-to-week injury tags never apply to a multi-game projection. Season
    # ending ones do, so rest-of-season drops anyone on IR/PUP/NFI/suspension
    # while the preseason benchmark keeps everybody.
    by_team = rp.apply_sleeper_rosters(by_team, rp.fetch_sleeper_index(),
                                       set(teams), drop_injured=False,
                                       drop_longterm=ros)

    acc, meta = {}, {}
    for i, row in enumerate(schedule, 1):
        game, home, away = game_from_schedule(row, levels)
        if home not in by_team or away not in by_team:
            continue
        if i % 40 == 0 or i == 1:
            print(f"  [{i}/{len(schedule)}] week {row['week']} {away} @ {home} ...")

        results = simulate_players_for_game(
            game, by_team[home], by_team[away],
            n_sims=sims, rules=PPR, cov_stride=cov_stride, seed=9000 + i)

        for r in results.values():
            if r["position"] == "OTHER":
                continue
            team = rp.norm_abbr(r["team"])
            key = (rp.norm_name(r["player"]), team)
            keys, cov = rp.cov_block(r.pop("_samples"), r["position"])

            if key not in acc:
                acc[key] = {"proj": defaultdict(float),
                            "cov": np.zeros(len(cov)),
                            "games": 0, "keys": keys}
                meta[key] = {"name": r["player"], "team": team, "pos": r["position"]}
            a = acc[key]
            for k in player_sim.STAT_KEYS:
                a["proj"][k] += r[k]
            a["cov"] += np.asarray(cov, dtype=float)
            a["games"] += 1

    players = []
    for key, a in acc.items():
        m = meta[key]
        sd = float(np.sqrt(max(_ppr_var(a), 0.0)))
        mean = _ppr_mean(a)
        players.append({
            "name": m["name"], "team": m["team"], "pos": m["pos"],
            "games": a["games"],
            "proj": {k: round(v, 3) for k, v in a["proj"].items()},
            "keys": a["keys"],
            "cov": [round(float(x), 4) for x in a["cov"]],
            "ppr_mean": round(mean, 2),
            "ppr_sd": round(sd, 2),
            "z10": SEASON_Z10, "z90": SEASON_Z90,
            "ppg": round(mean / a["games"], 2) if a["games"] else 0,
        })

    players.sort(key=lambda p: -p["ppr_mean"])
    weeks = sorted({int(g["week"]) for g in schedule})
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": season, "mode": "ros" if ros else "season", "n_sims": sims,
        "from_week": weeks[0] if weeks else None,
        "to_week": weeks[-1] if weeks else None,
        "games_in_schedule": len(schedule),
        "scoring_reference": "PPR",
        "players": players,
    }


PPR_W = {"pass_yards": 0.04, "pass_td": 4, "interceptions": -2, "rush_yards": 0.1,
         "rush_td": 6, "receptions": 1.0, "rec_yards": 0.1, "rec_td": 6}


def _ppr_mean(a):
    return sum(PPR_W.get(k, 0) * a["proj"][k] for k in a["keys"])


def _ppr_var(a):
    keys, cov, idx, total = a["keys"], a["cov"], 0, 0.0
    for i in range(len(keys)):
        for j in range(i, len(keys)):
            total += (1 if i == j else 2) * PPR_W.get(keys[i], 0) * PPR_W.get(keys[j], 0) * cov[idx]
            idx += 1
    return total


def upsert(payload, row_id):
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set -- skipping upsert")
        return
    body = json.dumps([{"id": row_id, "data": payload,
                        "updated_at": datetime.now(timezone.utc).isoformat()}]).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/player_proj?on_conflict=id", data=body, method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"  Supabase upsert (id={row_id}) -> HTTP {resp.status}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=datetime.now().year)
    ap.add_argument("--weeks", type=int, default=4, help="usage window for in-season runs")
    ap.add_argument("--sims", type=int, default=2000)
    ap.add_argument("--cov-stride", type=int, default=5)
    ap.add_argument("--prior-season-fallback", type=int, default=None)
    ap.add_argument("--limit-weeks", type=int, default=None, help="smoke test on weeks 1-N")
    ap.add_argument("--ros", action="store_true",
                    help="rest of season: remaining weeks only, drops season-ending injuries")
    ap.add_argument("--from-week", type=int, default=None,
                    help="override the detected current week")
    ap.add_argument("--out", default="player-proj-season.json")
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="rebuild the benchmark even after week 1 has started")
    args = ap.parse_args()

    payload = build(args.season, args.weeks, args.sims,
                    args.prior_season_fallback, args.cov_stride, args.limit_weeks,
                    ros=args.ros, from_week=args.from_week)
    with open(args.out, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"Wrote {args.out}: {len(payload['players'])} players")

    if not args.no_upload:
        upsert(payload, 3 if args.ros else 2)