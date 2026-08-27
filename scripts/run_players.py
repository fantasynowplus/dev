"""
Player stat + fantasy point projections, built on top of nfl_simulator.py.

HOW IT WORKS
------------
nfl_simulator.py already gives you a full Monte Carlo distribution of each
TEAM's points per game (not just a mean -- the actual simulated scores from
every drive-by-drive sim). This module reuses that same team-score sampler,
and for every simulated game:

  1. Converts the team's simulated POINTS into approximate team-level
     volume (pass attempts, completions, rush attempts, pass/rush yards,
     pass/rush TDs, INTs) using league-average rates -- see TeamStyle.
  2. Splits that team volume across your roster using each player's USAGE
     SHARES (target share, rush share, TD share, etc.) that you supply in
     players.csv.
  3. Scores each player's simulated stat line with your fantasy rules
     (half-PPR by default).

Because this runs inside the same per-game simulation loop, a player's
projection stays correlated with their own team's simulated game script --
a positive script naturally produces more RB volume/rush TDs, a negative
script naturally produces more pass volume, etc. You get a full
distribution per player (mean/median/floor/ceiling), not just one number.

THIS IS A VOLUME/EFFICIENCY MODEL, NOT A PLAY-BY-PLAY SIM. The team-level
conversion (points -> yards/attempts/TDs) uses fixed league-average
constants below. They're reasonable NFL averages but tune them for extreme
pace or run/pass-heavy teams via TeamStyle overrides.
"""

import csv
import random
import statistics
from dataclasses import dataclass

from nfl_simulator import Game, simulate_once, calibrate_variance_alpha

# ---------- league-average conversion constants (tune as needed) ----------

YARDS_PER_POINT = 15.5      # total offensive yards per point scored, NFL long-run avg
PASS_YARDS_SHARE = 0.63     # share of total yards that come via the pass
PASS_TD_SHARE = 0.62        # share of offensive TDs that are passing TDs (vs rushing)
LEAGUE_YPA = 6.9            # yards per pass attempt
LEAGUE_YPC = 4.3            # yards per rush attempt
LEAGUE_COMP_PCT = 0.65      # completion percentage
LEAGUE_INT_RATE = 0.023     # interceptions per pass attempt
LEAGUE_YPT = 7.8            # yards per target (receiving)

POSITION_CATCH_RATE = {"RB": 0.76, "WR": 0.64, "TE": 0.70}

# Same TD/FG point-allocation ratio nfl_simulator.py uses internally, so the
# implied TD count here is consistent with how it generated the score.
_TD_RATIO = 0.68 / (0.68 + 0.28)
POINTS_PER_TD_EFFECTIVE = 6.94


STAT_KEYS = ["pass_att", "completions", "pass_yards", "pass_td", "interceptions",
             "rush_att", "rush_yards", "rush_td", "targets", "receptions",
             "rec_yards", "rec_td"]


@dataclass
class TeamStyle:
    """Optional per-team overrides. Leave defaults for league-average."""
    pass_yards_share: float = PASS_YARDS_SHARE
    pass_td_share: float = PASS_TD_SHARE
    ypa: float = LEAGUE_YPA
    ypc: float = LEAGUE_YPC
    comp_pct: float = LEAGUE_COMP_PCT
    int_rate: float = LEAGUE_INT_RATE


@dataclass
class PlayerUsage:
    name: str
    team: str
    position: str  # QB / RB / WR / TE

    # Passing (QB)
    pass_att_share: float = 0.0   # share of team's pass attempts this player throws
    comp_pct: float = None        # None -> team/league default
    int_rate: float = None        # None -> team/league default

    # Rushing (RB / QB scrambles)
    rush_share: float = 0.0       # share of team's rush attempts
    ypc_mult: float = 1.0         # multiplier on team/league yards-per-carry
    rush_td_share: float = None   # None -> defaults to rush_share

    # Receiving (RB / WR / TE)
    target_share: float = 0.0     # share of team's pass attempts thrown to this player
    catch_rate: float = None      # None -> position default
    ypt_mult: float = 1.0         # multiplier on league yards-per-target
    rec_td_share: float = None    # None -> defaults to target_share

    def resolved_catch_rate(self) -> float:
        return self.catch_rate if self.catch_rate is not None else POSITION_CATCH_RATE.get(self.position, 0.65)

    def resolved_rush_td_share(self) -> float:
        return self.rush_share if self.rush_td_share is None else self.rush_td_share

    def resolved_rec_td_share(self) -> float:
        return self.target_share if self.rec_td_share is None else self.rec_td_share


# ---------- fantasy scoring ----------

@dataclass
class ScoringRules:
    pass_yd: float = 0.04     # 1 pt / 25 yds
    pass_td: float = 4.0
    interception: float = -2.0
    rush_yd: float = 0.1      # 1 pt / 10 yds
    rush_td: float = 6.0
    reception: float = 0.5    # half-PPR
    rec_yd: float = 0.1       # 1 pt / 10 yds
    rec_td: float = 6.0


HALF_PPR = ScoringRules()
PPR = ScoringRules(reception=1.0)
STANDARD = ScoringRules(reception=0.0)


def score_stat_line(s: dict, rules: ScoringRules = HALF_PPR) -> float:
    return (
        s.get("pass_yards", 0) * rules.pass_yd
        + s.get("pass_td", 0) * rules.pass_td
        + s.get("interceptions", 0) * rules.interception
        + s.get("rush_yards", 0) * rules.rush_yd
        + s.get("rush_td", 0) * rules.rush_td
        + s.get("receptions", 0) * rules.reception
        + s.get("rec_yards", 0) * rules.rec_yd
        + s.get("rec_td", 0) * rules.rec_td
    )


# ---------- team points -> team volume ----------

def _rand_count(mean: float, r: random.Random) -> int:
    """Normal-approximation stand-in for a Poisson draw (no numpy dep).
    Fine for the mean sizes involved here (attempts ~35, TDs ~3, etc.)."""
    if mean <= 0:
        return 0
    return max(round(r.gauss(mean, mean ** 0.5)), 0)


def team_game_volume(points: int, style: TeamStyle, r: random.Random) -> dict:
    total_yards = max(points * YARDS_PER_POINT, 0)
    pass_yards = total_yards * style.pass_yards_share
    rush_yards = total_yards - pass_yards

    pass_att = _rand_count(pass_yards / style.ypa, r)
    completions = min(_rand_count(pass_att * style.comp_pct, r), pass_att)
    interceptions = min(_rand_count(pass_att * style.int_rate, r), pass_att)
    rush_att = _rand_count(rush_yards / style.ypc, r)

    total_td = _rand_count(points * _TD_RATIO / POINTS_PER_TD_EFFECTIVE, r)
    pass_td = sum(1 for _ in range(total_td) if r.random() < style.pass_td_share)
    rush_td = total_td - pass_td

    return {
        "pass_att": pass_att, "completions": completions,
        "pass_yards": pass_yards, "interceptions": interceptions,
        "rush_att": rush_att, "rush_yards": rush_yards,
        "pass_td": pass_td, "rush_td": rush_td,
        "targets": pass_att,
    }


# ---------- allocate one team's volume across its roster for one sim ----------

def _split_counts(count: int, players: list, weight_fn, r: random.Random) -> dict:
    """Multinomially split `count` discrete events across players by weight.
    Any share of usage not assigned to a listed player (e.g. backups/
    committee mates you didn't add) is implicitly absorbed -- add an 'Other'
    row per team if you want to see it explicitly."""
    weights = [max(weight_fn(p), 0) for p in players]
    if count <= 0 or sum(weights) <= 0:
        return {p.name: 0 for p in players}
    picks = r.choices(players, weights=weights, k=count)
    out = {p.name: 0 for p in players}
    for pick in picks:
        out[pick.name] += 1
    return out


def _allocate_team(points: int, players: list, style: TeamStyle, r: random.Random) -> dict:
    """Returns {player_name: stat_line_dict} for one team, one simulated game."""
    vol = team_game_volume(points, style, r)
    lines = {p.name: {"pass_att": 0, "completions": 0, "pass_yards": 0, "pass_td": 0,
                       "interceptions": 0, "rush_att": 0, "rush_yards": 0, "rush_td": 0,
                       "targets": 0, "receptions": 0, "rec_yards": 0, "rec_td": 0}
             for p in players}

    qbs = [p for p in players if p.pass_att_share > 0]
    qb_att = _split_counts(vol["pass_att"], qbs, lambda p: p.pass_att_share, r)
    for p in qbs:
        att = qb_att[p.name]
        if att == 0:
            continue
        comp_pct = p.comp_pct if p.comp_pct is not None else style.comp_pct
        int_rate = p.int_rate if p.int_rate is not None else style.int_rate
        comps = min(_rand_count(att * comp_pct, r), att)
        ints = min(_rand_count(att * int_rate, r), att)
        share = att / vol["pass_att"] if vol["pass_att"] else 0
        lines[p.name]["pass_att"] = att
        lines[p.name]["completions"] = comps
        lines[p.name]["pass_yards"] = round(vol["pass_yards"] * share)
        lines[p.name]["pass_td"] = round(vol["pass_td"] * share)
        lines[p.name]["interceptions"] = ints

    rushers = [p for p in players if p.rush_share > 0]
    rush_att = _split_counts(vol["rush_att"], rushers, lambda p: p.rush_share, r)
    rush_td_split = _split_counts(vol["rush_td"], rushers, lambda p: p.resolved_rush_td_share(), r)
    for p in rushers:
        att = rush_att[p.name]
        lines[p.name]["rush_att"] = att
        lines[p.name]["rush_yards"] = round(att * style.ypc * p.ypc_mult)
        lines[p.name]["rush_td"] = rush_td_split[p.name]

    receivers = [p for p in players if p.target_share > 0]
    targets = _split_counts(vol["targets"], receivers, lambda p: p.target_share, r)
    rec_td_split = _split_counts(vol["pass_td"], receivers, lambda p: p.resolved_rec_td_share(), r)
    for p in receivers:
        tgt = targets[p.name]
        catch_rate = p.resolved_catch_rate()
        recs = min(_rand_count(tgt * catch_rate, r), tgt)
        lines[p.name]["targets"] = tgt
        lines[p.name]["receptions"] = recs
        lines[p.name]["rec_yards"] = round(tgt * LEAGUE_YPT * p.ypt_mult)
        lines[p.name]["rec_td"] = rec_td_split[p.name]

    return lines


# ---------- full simulation across n_sims ----------

def simulate_players_for_game(
    game: Game,
    home_players: list,
    away_players: list,
    n_sims: int = 20000,
    home_style: TeamStyle = None,
    away_style: TeamStyle = None,
    rules: ScoringRules = HALF_PPR,
    cov_stride: int = 20,
    seed: int = None,
) -> dict:
    """Returns {player_name: {stat averages..., fantasy_pts_mean, median,
    floor (10th pct), ceiling (90th pct)}}."""
    game.prepare()
    home_style = home_style or TeamStyle()
    away_style = away_style or TeamStyle()
    r = random.Random(seed)
    game.variance_alpha = calibrate_variance_alpha(game)

    all_players = home_players + away_players
    stat_keys = STAT_KEYS
    stat_sums = {p.name: {k: 0.0 for k in stat_keys} for p in all_players}
    fpts = {p.name: [] for p in all_players}
    samples = {p.name: [] for p in all_players}

    for sim_i in range(n_sims):
        hs, as_ = simulate_once(game, game.home_expected, game.away_expected, rng=r)
        for points, players, style in ((hs, home_players, home_style),
                                        (as_, away_players, away_style)):
            lines = _allocate_team(points, players, style, r)
            for p in players:
                line = lines[p.name]
                for k in stat_keys:
                    stat_sums[p.name][k] += line[k]
                fpts[p.name].append(score_stat_line(line, rules))
                if sim_i % cov_stride == 0:
                    samples[p.name].append([line[k] for k in stat_keys])

    out = {}
    for p in all_players:
        pts = fpts[p.name]
        pts_sorted = sorted(pts)
        n = len(pts_sorted)
        floor = pts_sorted[int(n * 0.10)]
        ceiling = pts_sorted[int(n * 0.90)]
        row = {
            "player": p.name, "team": p.team, "position": p.position,
            "fantasy_pts_mean": round(statistics.mean(pts), 2),
            "fantasy_pts_median": round(statistics.median(pts), 2),
            "fantasy_pts_floor10": round(floor, 2),
            "fantasy_pts_ceiling90": round(ceiling, 2),
            "fantasy_pts_stdev": round(statistics.pstdev(pts), 2),
        }
        for k in stat_keys:
            row[k] = round(stat_sums[p.name][k] / n_sims, 1)
        row["_samples"] = samples[p.name]
        out[p.name] = row
    return out


def print_player_report(results: dict):
    """Position-specific stat columns:
      QB: att, comp, pass TD, INT, rush att, rush TD  (+ pass yards, kept for
          scoring context even though not in the original stat list)
      RB: rush att, rush yds, rush TD, rec, rec yds, rec TD
      WR: rec, tgt, rec TD, rush att, rush yds, rush TD  (+ rec yards, kept
          for scoring context)
      TE: rec, tgt, rec yds, rec TD
    """
    order = {"QB": 0, "RB": 1, "WR": 2, "TE": 3}
    rows = sorted(results.values(), key=lambda x: (order.get(x["position"], 9), -x["fantasy_pts_mean"]))

    print(f"{'PLAYER':<20}{'POS':<5}{'TM':<20}{'FPTS':>6}{'FLR':>6}{'CEIL':>6}   STATS")
    print("-" * 110)
    for row in rows:
        pos = row["position"]
        if pos == "QB":
            stat_str = (f"{row['completions']}/{row['pass_att']} att, {row['pass_yards']} pass yd, "
                        f"{row['pass_td']} pass TD, {row['interceptions']} INT, "
                        f"{row['rush_att']} rush att, {row['rush_td']} rush TD")
        elif pos == "RB":
            stat_str = (f"{row['rush_att']} rush att, {row['rush_yards']} rush yd, {row['rush_td']} rush TD, "
                        f"{row['receptions']}/{row['targets']} rec, {row['rec_yards']} rec yd, "
                        f"{row['rec_td']} rec TD")
        elif pos == "WR":
            stat_str = (f"{row['receptions']}/{row['targets']} rec, {row['rec_yards']} rec yd, "
                        f"{row['rec_td']} rec TD, {row['rush_att']} rush att, "
                        f"{row['rush_yards']} rush yd, {row['rush_td']} rush TD")
        else:  # TE
            stat_str = (f"{row['receptions']}/{row['targets']} rec, {row['rec_yards']} rec yd, "
                        f"{row['rec_td']} rec TD")
        print(f"{row['player']:<20}{pos:<5}{row['team']:<20}"
              f"{row['fantasy_pts_mean']:>6}{row['fantasy_pts_floor10']:>6}"
              f"{row['fantasy_pts_ceiling90']:>6}   {stat_str}")


# Position-specific column sets for CSV export, matching the requested stats.
# pass_yards / rec_yards are appended even where not explicitly requested
# because half-PPR fantasy_pts is computed from them -- dropping them would
# make the fantasy point column unverifiable.
POSITION_COLUMNS = {
    "QB": ["pass_att", "completions", "pass_yards", "pass_td", "interceptions",
           "rush_att", "rush_td"],
    "RB": ["rush_att", "rush_yards", "rush_td", "receptions", "targets", "rec_yards", "rec_td"],
    "WR": ["receptions", "targets", "rec_yards", "rec_td", "rush_att", "rush_yards", "rush_td"],
    "TE": ["receptions", "targets", "rec_yards", "rec_td"],
}


def export_player_projections_csv(results: dict, filepath: str):
    """Writes one row per player. Only the stat columns relevant to that
    player's position are populated -- the rest are left blank, so a QB row
    doesn't show a receptions column full of zeroes, etc.

    Every row still gets fantasy_pts_mean/median/floor10/ceiling90 and
    fantasy_pts_stdev regardless of position, since that's the number you
    actually draft/start/sit on.
    """
    all_stat_cols = ["pass_att", "completions", "pass_yards", "pass_td", "interceptions",
                      "rush_att", "rush_yards", "rush_td", "targets", "receptions",
                      "rec_yards", "rec_td"]
    fieldnames = (["player", "team", "position"] + all_stat_cols +
                  ["fantasy_pts_mean", "fantasy_pts_median", "fantasy_pts_floor10",
                   "fantasy_pts_ceiling90", "fantasy_pts_stdev"])

    order = {"QB": 0, "RB": 1, "WR": 2, "TE": 3}
    rows = sorted(results.values(), key=lambda x: (order.get(x["position"], 9), -x["fantasy_pts_mean"]))

    with open(filepath, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            relevant = set(POSITION_COLUMNS.get(row["position"], all_stat_cols))
            out_row = {"player": row["player"], "team": row["team"], "position": row["position"],
                       "fantasy_pts_mean": row["fantasy_pts_mean"],
                       "fantasy_pts_median": row["fantasy_pts_median"],
                       "fantasy_pts_floor10": row["fantasy_pts_floor10"],
                       "fantasy_pts_ceiling90": row["fantasy_pts_ceiling90"],
                       "fantasy_pts_stdev": row["fantasy_pts_stdev"]}
            for col in all_stat_cols:
                out_row[col] = row[col] if col in relevant else ""
            writer.writerow(out_row)


# ---------- CSV loading ----------

def _f(row, key, default=None):
    v = row.get(key, "")
    if v is None or str(v).strip() == "":
        return default
    return float(v)


def load_players_csv(filepath: str) -> dict:
    """Returns {team_abbr_or_name: [PlayerUsage, ...]}."""
    by_team: dict = {}
    with open(filepath, newline="") as f:
        for row in csv.DictReader(f):
            if not row.get("player") or not row.get("team"):
                continue
            p = PlayerUsage(
                name=row["player"].strip(),
                team=row["team"].strip(),
                position=row["position"].strip().upper(),
                pass_att_share=_f(row, "pass_att_share", 0.0),
                comp_pct=_f(row, "comp_pct"),
                int_rate=_f(row, "int_rate"),
                rush_share=_f(row, "rush_share", 0.0),
                ypc_mult=_f(row, "ypc_mult", 1.0),
                rush_td_share=_f(row, "rush_td_share"),
                target_share=_f(row, "target_share", 0.0),
                catch_rate=_f(row, "catch_rate"),
                ypt_mult=_f(row, "ypt_mult", 1.0),
                rec_td_share=_f(row, "rec_td_share"),
            )
            by_team.setdefault(p.team, []).append(p)
    return by_team


def validate_players(by_team: dict) -> list:
    """Sanity check: usage shares within a team shouldn't exceed 100%.
    Returns a list of warning strings (empty if all good)."""
    warnings = []
    for team, players in by_team.items():
        pass_share = sum(p.pass_att_share for p in players)
        rush_share = sum(p.rush_share for p in players)
        target_share = sum(p.target_share for p in players)
        if pass_share > 1.01:
            warnings.append(f"{team}: pass_att_share sums to {pass_share:.2f} (>1.0)")
        if rush_share > 1.01:
            warnings.append(f"{team}: rush_share sums to {rush_share:.2f} (>1.0)")
        if target_share > 1.01:
            warnings.append(f"{team}: target_share sums to {target_share:.2f} (>1.0)")
    return warnings