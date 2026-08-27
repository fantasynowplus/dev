"""
Builds a players.csv (usage-share format expected by player_sim.py) from
nflverse's free, public player-stats CSV -- no API key required.

Source: https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv
Data dictionary: https://nflreadr.nflverse.com/articles/dictionary_player_stats.html

WHAT THIS DOES
--------------
1. Downloads that season's weekly player stats.
2. Filters to the last N weeks (recent-form window) for the teams you ask for.
3. Sums each player's attempts/targets/carries/TDs, and each TEAM's totals,
   over that window.
4. Computes usage shares (pass_att_share, target_share, rush_share, catch
   rate, yards-per-target/carry multipliers, TD shares) exactly the way
   player_sim.py expects them.
5. Writes players.csv, one row per skill-position player who saw meaningful
   volume (min-attempt/target thresholds below, adjustable).

Run:
    python build_players_from_nflverse.py --season 2026 --weeks 4 \
        --teams "KC,BAL" --out players.csv

If a team hasn't played 4 games yet this season (e.g. early September),
pass --season 2025 to bootstrap off last year's full season, or lower
--weeks / raise --prior-season-fallback (see below).
"""

import argparse
import csv
import io
import statistics
import urllib.error
import urllib.request
from collections import defaultdict

NFLVERSE_SEASON_CSV = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "stats_player/stats_player_week_{season}.csv"
)

LEAGUE_YPT = 7.8
LEAGUE_YPC = 4.3

MIN_PASS_ATT_FOR_QB = 30
MIN_TARGETS_FOR_RECEIVER = 8
MIN_CARRIES_FOR_RUSHER = 8


def download_csv(url: str) -> list:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        text = resp.read().decode()
    return list(csv.DictReader(io.StringIO(text)))


def download_season(season: int) -> list:
    """One season file. Returns [] if nflverse hasn't published it yet."""
    url = NFLVERSE_SEASON_CSV.format(season=season)
    try:
        rows = download_csv(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"  nflverse has no {season} file yet (HTTP 404)")
            return []
        raise
    print(f"  {season}: {len(rows)} rows")
    return rows


def f(row, key, default=0.0):
    v = row.get(key, "")
    try:
        return float(v) if v not in (None, "") else default
    except ValueError:
        return default


def build(season: int, weeks: int, teams: list, out_path: str, prior_season: int = None):
    print("Downloading nflverse weekly player stats ...")
    rows = download_season(season)

    def filter_rows(source_rows):
        season_rows = [r for r in source_rows
                       if r.get("season_type") == "REG" and r.get("team") in teams]
        if not season_rows:
            return []
        max_week = max(int(r["week"]) for r in season_rows)
        min_week = max(1, max_week - weeks + 1)
        print(f"  usage window: weeks {min_week}-{max_week}")
        return [r for r in season_rows if min_week <= int(r["week"]) <= max_week]

    use_rows = filter_rows(rows)
    if not use_rows and prior_season:
        print(f"  falling back to {prior_season} full season")
        use_rows = [r for r in download_season(prior_season)
                    if r.get("season_type") == "REG" and r.get("team") in teams]

    if not use_rows:
        raise SystemExit("No matching rows found -- check --season/--teams against the data.")

    # aggregate per player
    agg = defaultdict(lambda: defaultdict(float))
    names, positions, headshots = {}, {}, {}
    for r in use_rows:
        pid = r["player_id"]
        names[pid] = r.get("player_display_name") or r.get("player_name")
        positions[pid] = r.get("position", "")
        if r.get("headshot_url"):
            headshots[pid] = r["headshot_url"]
        team = r.get("team")
        agg[pid]["team_key"] = team  # overwritten each row, fine (same team in window)
        for k in ("attempts", "completions", "passing_yards", "passing_tds",
                  "carries", "rushing_yards", "rushing_tds",
                  "targets", "receptions", "receiving_yards", "receiving_tds"):
            agg[pid][k] += f(r, k)
        agg[pid]["interceptions"] += f(r, "passing_interceptions")
        if f(r, "attempts") + f(r, "carries") + f(r, "targets") > 0:
            agg[pid]["games"] += 1

    # team totals + games played over the same window
    team_games = defaultdict(set)
    team_totals = defaultdict(lambda: defaultdict(float))
    for r in use_rows:
        team = r.get("team")
        if r.get("game_id"):
            team_games[team].add(r["game_id"])
        for k in ("attempts", "carries", "targets", "passing_tds", "rushing_tds", "receiving_tds"):
            team_totals[team][k] += f(r, k)

    out_rows = []
    for pid, d in agg.items():
        team = d["team_key"]
        pos = positions[pid]
        name = names[pid]
        tt = team_totals[team]
        tg = max(len(team_games[team]), 1)
        pg = max(d["games"], 1)

        def share(player_total, team_total):
            """Per-game-played share. Using raw season totals would dilute
            anyone who missed games -- a QB who started 12 of 17 would look
            like a 70% starter instead of a 100% one."""
            if not team_total:
                return ""
            return round((player_total / pg) / (team_total / tg), 3)
        row = {"team": team, "player": name, "position": pos,
               "headshot": headshots.get(pid, ""),
               "pass_att_share": "", "comp_pct": "", "int_rate": "",
               "rush_share": "", "ypc_mult": "", "rush_td_share": "",
               "target_share": "", "catch_rate": "", "ypt_mult": "", "rec_td_share": ""}

        if pos == "QB" and d["attempts"] >= MIN_PASS_ATT_FOR_QB:
            row["pass_att_share"] = share(d["attempts"], tt["attempts"])
            row["comp_pct"] = round(d["completions"] / d["attempts"], 3) if d["attempts"] else ""
            row["int_rate"] = round(d["interceptions"] / d["attempts"], 3) if d["attempts"] else ""

        if d["carries"] >= MIN_CARRIES_FOR_RUSHER:
            row["rush_share"] = share(d["carries"], tt["carries"])
            ypc = d["rushing_yards"] / d["carries"] if d["carries"] else 0
            row["ypc_mult"] = round(ypc / LEAGUE_YPC, 3)
            if tt["rushing_tds"]:
                row["rush_td_share"] = share(d["rushing_tds"], tt["rushing_tds"])

        if d["targets"] >= MIN_TARGETS_FOR_RECEIVER:
            row["target_share"] = share(d["targets"], tt["targets"])
            row["catch_rate"] = round(d["receptions"] / d["targets"], 3) if d["targets"] else ""
            ypt = d["receiving_yards"] / d["targets"] if d["targets"] else 0
            row["ypt_mult"] = round(ypt / LEAGUE_YPT, 3)
            if tt["receiving_tds"]:
                row["rec_td_share"] = share(d["receiving_tds"], tt["receiving_tds"])

        # skip players who cleared none of the volume thresholds (deep bench)
        if row["pass_att_share"] == "" and row["rush_share"] == "" and row["target_share"] == "":
            continue
        out_rows.append(row)

    out_rows.sort(key=lambda r: (r["team"], r["position"]))

    fieldnames = ["team", "player", "position", "headshot", "pass_att_share", "comp_pct", "int_rate",
                  "rush_share", "ypc_mult", "rush_td_share",
                  "target_share", "catch_rate", "ypt_mult", "rec_td_share"]
    with open(out_path, "w", newline="") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"Wrote {out_path}: {len(out_rows)} players across {len(teams)} team(s)")
    print("  shares are per-game-played, so a team can sum above 1.0 -- run_players.py normalizes")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--weeks", type=int, default=4, help="trailing window size")
    ap.add_argument("--teams", required=True,
                     help="comma-separated nflverse team abbreviations, e.g. KC,BAL")
    ap.add_argument("--out", default="players.csv")
    ap.add_argument("--prior-season-fallback", type=int, default=None,
                     help="if --season has no games yet, use this season's full-year rates instead")
    args = ap.parse_args()

    build(args.season, args.weeks, [t.strip() for t in args.teams.split(",")],
          args.out, args.prior_season_fallback)