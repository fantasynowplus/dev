#!/usr/bin/env python3
"""
Slate runner for player_sim.py -- the player-projection equivalent of run_sim.py.

PIPELINE
--------
1. Pull this week's Game objects from run_sim.py (same odds feed as the NFL sim).
2. Build usage shares for every team on the slate via build_players_from_nflverse.
3. Drop players Sleeper lists as OUT/IR/PUP/SUS and redistribute their share.
4. Add a synthetic "Other" residual player per team so listed players don't
   absorb 100% of team volume (see _split_counts in player_sim.py).
5. Run the Monte Carlo per game under PPR, capturing subsampled stat lines.
6. Turn those samples into a per-player covariance block + z10/z90 shape
   offsets, so the BROWSER can rescore for arbitrary league settings:
       mean = sum(w_k * proj_k)
       var  = w' C w
       floor = mean + z10 * sqrt(var)
7. Attach DraftKings salaries for the main slate.
8. Write JSON and upsert it into the Supabase player_proj table.

Run:
    python run_players.py --season 2026 --weeks 4 --sims 8000 --out player-proj.json
"""

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import player_sim
from player_sim import PPR, PlayerUsage, load_players_csv, simulate_players_for_game
import build_players_from_nflverse as nflverse


# ---------------------------------------------------------------- team keys

TEAM_ABBR = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
    "Los Angeles Rams": "LA", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
    "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}

# nflverse is the canonical key; these are the other spellings we may meet.
ABBR_ALIASES = {
    "LAR": "LA", "STL": "LA", "SD": "LAC", "OAK": "LV",
    "JAC": "JAX", "WSH": "WAS", "WFT": "WAS", "ARZ": "ARI",
    "BLT": "BAL", "CLV": "CLE", "HST": "HOU", "GNB": "GB",
    "KAN": "KC", "NWE": "NE", "NOR": "NO", "SFO": "SF", "TAM": "TB",
}


def norm_abbr(a):
    a = (a or "").strip().upper()
    return ABBR_ALIASES.get(a, a)


def abbr_from_team(name):
    """Game objects carry full team names; nflverse carries abbreviations."""
    if not name:
        return ""
    n = name.strip()
    if n in TEAM_ABBR:
        return TEAM_ABBR[n]
    if len(n) <= 4:
        return norm_abbr(n)
    for full, ab in TEAM_ABBR.items():
        if full.lower().endswith(n.lower()) or n.lower().endswith(full.split()[-1].lower()):
            return ab
    raise SystemExit(f"Unrecognized team name from slate: {name!r} -- add it to TEAM_ABBR.")


SUFFIX_RE = re.compile(r"\b(jr|sr|ii|iii|iv|v)\.?$", re.I)


def norm_name(n):
    n = (n or "").lower().replace(".", "").replace("'", "").replace("-", " ")
    n = SUFFIX_RE.sub("", n)
    return re.sub(r"\s+", " ", n).strip()


# ------------------------------------------------------------------- slate

def load_games(limit=None):
    """Same source cascade run_sim.py uses in main(): the-odds-api, then
    ESPN, then scripts/slate.csv. Each fetcher returns [(Game, kickoff, book)]."""
    try:
        import run_sim
    except ImportError:
        raise SystemExit("run_sim.py must sit next to run_players.py in scripts/")

    for name, fn in (("the-odds-api", run_sim.fetch_odds_api),
                     ("espn", run_sim.fetch_espn),
                     ("slate.csv", run_sim.fetch_csv)):
        try:
            slate = fn()
        except Exception as e:
            print(f"  slate source {name} failed: {e}")
            continue
        if slate:
            print(f"  slate: {len(slate)} games from {name}")
            return slate[:limit] if limit else slate

    raise SystemExit(
        "No slate from any source. Set ODDS_API_KEY, or fill scripts/slate.csv "
        "with home_team,away_team,home_ml,away_ml,home_spread,total_line."
    )


# ---------------------------------------------------------------- injuries

SLEEPER_PLAYERS = "https://api.sleeper.app/v1/players/nfl"
OUT_STATUSES = {"out", "ir", "pup", "sus", "susp", "dnr", "nfi"}
OUT_STATUS_TEXT = {"inactive", "injured reserve", "physically unable to perform",
                   "non football injury", "suspended", "practice squad"}


def fetch_sleeper_index():
    """Current team, depth-chart slot and availability for every NFL player.

    The usage CSV describes LAST season. Sleeper describes today. Without
    this the model happily starts a quarterback who left in March."""
    try:
        req = urllib.request.Request(SLEEPER_PLAYERS, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f"  WARNING: Sleeper fetch failed ({e}) -- rosters NOT refreshed, "
              f"projections will reflect last season's teams")
        return {}

    idx = {}
    for pl in data.values():
        name = pl.get("full_name") or f"{pl.get('first_name','')} {pl.get('last_name','')}"
        key = norm_name(name)
        if not key:
            continue
        inj = (pl.get("injury_status") or "").strip().lower()
        status = (pl.get("status") or "").strip().lower()
        depth = pl.get("depth_chart_order")
        rec = {
            "team": norm_abbr(pl.get("team")),
            "pos": (pl.get("position") or "").upper(),
            "out": inj in OUT_STATUSES or status in OUT_STATUS_TEXT,
            "depth": int(depth) if isinstance(depth, (int, float)) else None,
        }
        idx[(key, rec["pos"])] = rec
        idx.setdefault(key, rec)
    print(f"  Sleeper: {len(data)} players indexed")
    return idx


def _lookup(index, player):
    return index.get((norm_name(player.name), player.position)) or index.get(norm_name(player.name))


SHARE_FIELDS = ["pass_att_share", "rush_share", "target_share",
                "rush_td_share", "rec_td_share"]


def _pick_starting_qb(keep, team):
    """Sleeper's depth chart decides QB1; last season's attempt total is only
    the tiebreak when the depth chart is silent. The starter gets 100% of
    attempts and the other passers are dropped unless they run enough to
    matter on their own."""
    qbs = [p for p in keep if p.pass_att_share > 0]
    if not qbs:
        return keep

    ranked = [p for p in qbs if getattr(p, "_depth", None)]
    if ranked:
        starter = min(ranked, key=lambda p: p._depth)
    else:
        starter = max(qbs, key=lambda p: p.pass_att_share)

    starter.pass_att_share = 1.0
    out = []
    for p in keep:
        if p is starter or p.pass_att_share <= 0:
            out.append(p)
        elif p.rush_share > 0.05:
            p.pass_att_share = 0.0
            out.append(p)
    print(f"  {team}: QB1 = {starter.name}")
    return out


def _normalize(keep, field, cap=1.0):
    total = sum(getattr(p, field) or 0.0 for p in keep)
    if total > cap:
        for p in keep:
            v = getattr(p, field) or 0.0
            if v:
                setattr(p, field, v * cap / total)


def apply_sleeper_rosters(by_team, index, slate_teams, drop_injured=True):
    """Reconciles last season's usage against this season's rosters: drops
    anyone unavailable, moves offseason signings to their current team, picks
    a starting QB off the depth chart, rescales shares past 100%, and adds an
    'Other' row so listed players don't absorb all of a team's volume."""
    if not index:
        moved_by_team = by_team
    else:
        moved_by_team, moved, dropped_out, dropped_gone = {}, [], [], []
        for team, players in by_team.items():
            for p in players:
                rec = _lookup(index, p)
                if rec is None:
                    moved_by_team.setdefault(team, []).append(p)
                    continue
                if rec["out"] and drop_injured:
                    dropped_out.append(p.name)
                    continue
                now = rec["team"]
                if not now or now not in slate_teams:
                    dropped_gone.append(f"{p.name} ({team})")
                    continue
                if now != team:
                    moved.append(f"{p.name} {team}->{now}")
                    p.team = now
                p._depth = rec["depth"]
                moved_by_team.setdefault(now, []).append(p)

        if dropped_out:
            print(f"  unavailable ({len(dropped_out)}): {', '.join(dropped_out[:8])}"
                  + (" ..." if len(dropped_out) > 8 else ""))
        if moved:
            print(f"  changed teams ({len(moved)}): {', '.join(moved[:8])}"
                  + (" ..." if len(moved) > 8 else ""))
        if dropped_gone:
            print(f"  not on a slate roster ({len(dropped_gone)}): {', '.join(dropped_gone[:6])}"
                  + (" ..." if len(dropped_gone) > 6 else ""))

    cleaned = {}
    for team, keep in moved_by_team.items():
        keep = _pick_starting_qb(list(keep), team)
        for field in ("rush_share", "target_share", "rush_td_share", "rec_td_share"):
            _normalize(keep, field)

        other = PlayerUsage(name=f"Other {team}", team=team, position="OTHER")
        other.rush_share = max(0.0, 1.0 - sum(p.rush_share for p in keep))
        other.target_share = max(0.0, 1.0 - sum(p.target_share for p in keep))
        other.rush_td_share = other.rush_share
        other.rec_td_share = other.target_share
        if other.rush_share or other.target_share:
            keep.append(other)
        cleaned[team] = keep
    return cleaned


# ------------------------------------------------------------ DraftKings

DK_LOBBY = "https://www.draftkings.com/lobby/getcontests?sport=NFL"
DK_DRAFTABLES = "https://api.draftkings.com/draftgroups/v1/draftgroups/{}/draftables?format=json"


def _get_json(url, timeout=45):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def fetch_dk_salaries():
    """{(norm_name, abbr): {salary, dk_pos, dk_game}} for the biggest live
    NFL Classic draft group (the main slate). Returns {} on any failure --
    salaries are a nice-to-have, projections still ship without them."""
    try:
        lobby = _get_json(DK_LOBBY)
    except Exception as e:
        print(f"  WARNING: DK lobby fetch failed ({e}) -- shipping without salaries")
        return {}

    groups = [g for g in lobby.get("DraftGroups", [])
              if g.get("GameTypeId") == 1 and (g.get("Sport") or "NFL").upper() == "NFL"]
    if not groups:
        print("  WARNING: no NFL Classic draft groups in DK lobby")
        return {}

    best, best_rows = None, {}
    for g in sorted(groups, key=lambda g: -(g.get("DraftGroupId") or 0))[:6]:
        gid = g.get("DraftGroupId")
        try:
            payload = _get_json(DK_DRAFTABLES.format(gid))
        except Exception:
            continue
        rows = {}
        for d in payload.get("draftables", []):
            key = (norm_name(d.get("displayName")), norm_abbr(d.get("teamAbbreviation")))
            if key in rows:
                continue
            comp = d.get("competition") or {}
            rows[key] = {
                "salary": d.get("salary"),
                "dk_pos": d.get("position"),
                "dk_game": comp.get("name"),
            }
        if len(rows) > len(best_rows):
            best, best_rows = gid, rows

    if best_rows:
        print(f"  DK: draft group {best}, {len(best_rows)} salaries")
    return best_rows


# ------------------------------------------------------- covariance blocks

SCORING_KEYS = {
    "QB": ["pass_att", "completions", "pass_yards", "pass_td", "interceptions",
           "rush_att", "rush_yards", "rush_td"],
    "RB": ["rush_att", "rush_yards", "rush_td", "targets", "receptions", "rec_yards", "rec_td"],
    "WR": ["rush_att", "rush_yards", "rush_td", "targets", "receptions", "rec_yards", "rec_td"],
    "TE": ["rush_att", "rush_yards", "rush_td", "targets", "receptions", "rec_yards", "rec_td"],
}


def cov_block(samples, position):
    """Upper-triangle covariance (incl. diagonal) over that position's
    scoring-relevant stats, in SCORING_KEYS order."""
    keys = SCORING_KEYS.get(position, SCORING_KEYS["WR"])
    idx = [player_sim.STAT_KEYS.index(k) for k in keys]
    m = np.asarray(samples, dtype=float)[:, idx]
    if m.shape[0] < 3:
        return keys, [0.0] * (len(keys) * (len(keys) + 1) // 2)
    c = np.cov(m, rowvar=False)
    flat = [round(float(c[i][j]), 4)
            for i in range(len(keys)) for j in range(i, len(keys))]
    return keys, flat


# ------------------------------------------------------------------- main

def build_payload(season, weeks, sims, prior_season, cov_stride, limit=None):
    slate = load_games(limit)
    games = [g for (g, _k, _b) in slate]
    kickoffs = {id(g): k for (g, k, _b) in slate}
    teams = sorted({abbr_from_team(g.home_team) for g in games} |
                   {abbr_from_team(g.away_team) for g in games})
    print(f"  {len(teams)} teams on the slate")

    tmp = os.path.join(tempfile.gettempdir(), "players_usage.csv")
    nflverse.build(season, weeks, teams, tmp, prior_season)
    by_team = load_players_csv(tmp)

    missing = [t for t in teams if t not in by_team]
    if missing:
        print(f"  WARNING: no usage rows for {', '.join(missing)} -- those games are skipped")

    by_team = apply_sleeper_rosters(by_team, fetch_sleeper_index(), set(teams))
    salaries = fetch_dk_salaries()

    players_out, seen = [], set()
    for gi, game in enumerate(games, 1):
        home, away = abbr_from_team(game.home_team), abbr_from_team(game.away_team)
        if home not in by_team or away not in by_team:
            continue
        print(f"  [{gi}/{len(games)}] {away} @ {home} ...")
        results = simulate_players_for_game(
            game, by_team[home], by_team[away],
            n_sims=sims, rules=PPR, cov_stride=cov_stride, seed=1234 + gi,
        )
        implied = {home: round(float(game.home_expected), 1),
                   away: round(float(game.away_expected), 1)}

        for row in results.values():
            if row["position"] == "OTHER":
                continue
            team = norm_abbr(row["team"])
            key = (norm_name(row["player"]), team)
            if key in seen:
                continue
            seen.add(key)

            keys, cov = cov_block(row.pop("_samples"), row["position"])
            sd = row["fantasy_pts_stdev"] or 1.0
            dk = salaries.get(key, {})
            players_out.append({
                "name": row["player"],
                "kickoff": kickoffs.get(id(game), ""),
                "team": team,
                "opp": away if team == home else home,
                "home": team == home,
                "pos": row["position"],
                "team_implied": implied[team],
                "proj": {k: row[k] for k in player_sim.STAT_KEYS},
                "keys": keys,
                "cov": cov,
                "ppr_mean": row["fantasy_pts_mean"],
                "ppr_sd": row["fantasy_pts_stdev"],
                "z10": round((row["fantasy_pts_floor10"] - row["fantasy_pts_mean"]) / sd, 3),
                "z90": round((row["fantasy_pts_ceiling90"] - row["fantasy_pts_mean"]) / sd, 3),
                "salary": dk.get("salary"),
                "dk_pos": dk.get("dk_pos"),
                "dk_game": dk.get("dk_game"),
            })

    players_out.sort(key=lambda p: -p["ppr_mean"])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": season,
        "n_sims": sims,
        "usage_window_weeks": weeks,
        "scoring_reference": "PPR",
        "salaries_source": "draftkings" if salaries else None,
        "players": players_out,
    }


def upsert_supabase(payload):
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set -- skipping upsert")
        return
    body = json.dumps([{"id": 1, "data": payload,
                        "updated_at": datetime.now(timezone.utc).isoformat()}]).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/player_proj?on_conflict=id", data=body, method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"  Supabase upsert -> HTTP {resp.status}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=datetime.now().year)
    ap.add_argument("--weeks", type=int, default=4)
    ap.add_argument("--sims", type=int, default=8000)
    ap.add_argument("--cov-stride", type=int, default=10)
    ap.add_argument("--prior-season-fallback", type=int, default=None)
    ap.add_argument("--out", default="player-proj.json")
    ap.add_argument("--limit-games", type=int, default=None,
                    help="smoke-test against the first N games only")
    ap.add_argument("--no-upload", action="store_true")
    args = ap.parse_args()

    payload = build_payload(args.season, args.weeks, args.sims,
                            args.prior_season_fallback, args.cov_stride,
                            args.limit_games)
    with open(args.out, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"Wrote {args.out}: {len(payload['players'])} players")

    if not args.no_upload:
        upsert_supabase(payload)