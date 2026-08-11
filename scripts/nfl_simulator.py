"""
NFL Game Simulator v4 — market odds + optional team stats, Monte Carlo,
auto-calibration, backtesting harness, CSV/Sheets export.

TIER 2 ADDITIONS
-----------------
- Optional team offensive/defensive ratings blend with the market-implied
  projection (stat_weight controls the blend, 0=pure market/default).
- IMPORTANT: game VOLATILITY is still calibrated from the market alone
  (sportsbooks price uncertainty well). Only the MEAN projection shifts
  toward your stats. This is what lets the model diverge from the market's
  implied win probability when your stats disagree with it — otherwise
  adding stats would be pointless busywork that just re-derives the odds.
- Backtesting harness: run the model against historical closing
  odds + actual results, get a Brier score (lower = better calibrated).
- CSV export for Google Sheets (File > Import, or drop the CSV into
  Drive and open with Sheets).
"""

import random
import math
import csv
import statistics
from dataclasses import dataclass, field


# ---------- odds math ----------

def american_to_prob(odds: int) -> float:
    if odds > 0:
        return 100 / (odds + 100)
    return -odds / (-odds + 100)


def devig_two_way(prob_a: float, prob_b: float) -> tuple[float, float]:
    total = prob_a + prob_b
    return prob_a / total, prob_b / total


# ---------- scoring model constants ----------
N_DRIVES = 11
TD_POINT_SHARE = 0.68
FG_POINT_SHARE = 0.28
POINTS_PER_TD_EFFECTIVE = 6.94
POINTS_PER_FG = 3.0
SAFETY_PROB_PER_TEAM = 0.02
LEAGUE_AVG_POINTS = 22.5     # NFL points/team/game, long-run average
HOME_FIELD_POINTS = 1.5      # modern NFL home-field edge (market already prices most of this)


def ratings_from_stats(points_scored_avg: float, points_allowed_avg: float,
                        league_avg: float = LEAGUE_AVG_POINTS) -> tuple[float, float]:
    """Convert simple season stats into off/def ratings (points above/below
    league average). Pull these from any public source: NFL.com, Pro
    Football Reference, ESPN. No API needed."""
    return points_scored_avg - league_avg, points_allowed_avg - league_avg


def _drive_probs(expected_points: float, pace_factor: float):
    adj_points = max(expected_points * pace_factor, 0)
    # Allocate ALL points between TD/FG (keeping their relative ratio) rather
    # than TD_SHARE + FG_SHARE independently, which left ~4% of points
    # unaccounted for and caused a systematic under-projection on every game.
    td_ratio = TD_POINT_SHARE / (TD_POINT_SHARE + FG_POINT_SHARE)
    td_points_target = adj_points * td_ratio
    fg_points_target = adj_points - td_points_target
    mean_td = td_points_target / POINTS_PER_TD_EFFECTIVE
    mean_fg = max(fg_points_target, 0) / POINTS_PER_FG
    p_td = min(max(mean_td / N_DRIVES, 0), 0.65)
    p_fg = min(max(mean_fg / N_DRIVES, 0), 0.45)
    p_safety = SAFETY_PROB_PER_TEAM / N_DRIVES
    total = p_td + p_fg + p_safety
    if total > 0.95:
        scale = 0.95 / total
        p_td *= scale
        p_fg *= scale
        p_safety *= scale
    return p_td, p_fg, p_safety, mean_td, mean_fg


def _sample_with_rng(expected_points, pace_factor, alpha, r: random.Random) -> int:
    p_td, p_fg, p_safety, mean_td, mean_fg = _drive_probs(expected_points, pace_factor)
    binomial_score = 0
    for _ in range(N_DRIVES):
        rr = r.random()
        if rr < p_td:
            xr = r.random()
            if xr < 0.94:
                binomial_score += 7
            elif xr < 0.98:
                binomial_score += 6
            else:
                binomial_score += 8
        elif rr < p_td + p_fg:
            binomial_score += 3
        elif rr < p_td + p_fg + p_safety:
            binomial_score += 2
    deterministic_score = mean_td * POINTS_PER_TD_EFFECTIVE + mean_fg * POINTS_PER_FG
    blended = alpha * binomial_score + (1 - alpha) * deterministic_score
    if alpha > 1:
        blended += r.gauss(0, (alpha - 1) * 8)
    return max(round(blended), 0)


def sample_team_score(expected_points: float, pace_factor: float, alpha: float) -> int:
    return _sample_with_rng(expected_points, pace_factor, alpha, random)


# ---------- game setup ----------

@dataclass
class Game:
    home_team: str
    away_team: str
    home_ml: int
    away_ml: int
    home_spread: float
    total_line: float
    pace_std: float = 0.10

    # Tier 2 (optional): supply these to blend team stats into the projection.
    # Get them from ratings_from_stats(points_scored_avg, points_allowed_avg).
    home_off_rating: float = 0.0
    home_def_rating: float = 0.0
    away_off_rating: float = 0.0
    away_def_rating: float = 0.0
    stat_weight: float = 0.0   # 0 = pure market (default), 1 = pure stats

    margin_mean: float = field(init=False, default=0.0)
    market_home_expected: float = field(init=False, default=0.0)
    market_away_expected: float = field(init=False, default=0.0)
    home_expected: float = field(init=False, default=0.0)   # final, stats-blended
    away_expected: float = field(init=False, default=0.0)   # final, stats-blended
    home_win_prob_market: float = field(init=False, default=0.0)
    variance_alpha: float = field(init=False, default=1.0)  # auto-calibrated

    def prepare(self):
        raw_home = american_to_prob(self.home_ml)
        raw_away = american_to_prob(self.away_ml)
        home_p, _ = devig_two_way(raw_home, raw_away)
        self.home_win_prob_market = home_p

        self.margin_mean = -self.home_spread
        self.market_home_expected = self.total_line / 2 + self.margin_mean / 2
        self.market_away_expected = self.total_line / 2 - self.margin_mean / 2

        stats_home_expected = LEAGUE_AVG_POINTS + self.home_off_rating - self.away_def_rating + HOME_FIELD_POINTS
        stats_away_expected = LEAGUE_AVG_POINTS + self.away_off_rating - self.home_def_rating

        w = min(max(self.stat_weight, 0), 1)
        self.home_expected = (1 - w) * self.market_home_expected + w * stats_home_expected
        self.away_expected = (1 - w) * self.market_away_expected + w * stats_away_expected
        return self


def simulate_once(game: Game, home_expected: float, away_expected: float, rng: random.Random = None):
    r = rng or random
    pace = max(r.gauss(1.0, game.pace_std), 0.4)
    hs = _sample_with_rng(home_expected, pace, game.variance_alpha, r)
    as_ = _sample_with_rng(away_expected, pace, game.variance_alpha, r)
    return hs, as_


# ---------- auto-calibration (calibrated on MARKET projection only) ----------

def _home_win_rate_crn(game: Game, alpha: float, n: int, seed_base: int) -> float:
    old_alpha = game.variance_alpha
    game.variance_alpha = alpha
    wins = 0.0
    for i in range(n):
        r = random.Random(seed_base + i)
        hs, as_ = simulate_once(game, game.market_home_expected, game.market_away_expected, rng=r)
        if hs > as_:
            wins += 1
        elif hs == as_:
            wins += 0.5
    game.variance_alpha = old_alpha
    return wins / n


def calibrate_variance_alpha(game: Game, n_calib: int = 4000, iters: int = 14,
                              lo: float = 0.0, hi: float = 1.6, seed_base: int = 777) -> float:
    target = game.home_win_prob_market
    f_lo = _home_win_rate_crn(game, lo, n_calib, seed_base) - target
    f_hi = _home_win_rate_crn(game, hi, n_calib, seed_base) - target
    if (f_lo < 0) == (f_hi < 0):
        return lo if abs(f_lo) < abs(f_hi) else hi
    for _ in range(iters):
        mid = (lo + hi) / 2
        f_mid = _home_win_rate_crn(game, mid, n_calib, seed_base) - target
        if (f_lo < 0) != (f_mid < 0):
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


# ---------- full simulation ----------

def wilson_ci(p: float, n: int, z: float = 1.96) -> tuple[float, float]:
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    margin = z * math.sqrt((p * (1 - p) / n) + (z**2 / (4 * n**2))) / denom
    return max(0, center - margin), min(1, center + margin)


def simulate_game(game: Game, n_sims: int = 25000, seed: int | None = None,
                   auto_calibrate: bool = True):
    game.prepare()
    if seed is not None:
        random.seed(seed)
    if auto_calibrate:
        game.variance_alpha = calibrate_variance_alpha(game)

    home_wins = away_wins = ties = 0
    home_covers = away_covers = push_spread = 0
    overs = unders = push_total = 0
    home_scores, away_scores = [], []

    for _ in range(n_sims):
        hs, as_ = simulate_once(game, game.home_expected, game.away_expected)

        if hs == as_:
            p_home_ot = 0.5 + 0.5 * math.tanh((game.home_expected - game.away_expected) / 14)
            if random.random() < p_home_ot:
                hs += 3
            else:
                as_ += 3

        home_scores.append(hs)
        away_scores.append(as_)

        if hs > as_:
            home_wins += 1
        elif as_ > hs:
            away_wins += 1
        else:
            ties += 1

        cover_line = -game.home_spread
        m = hs - as_
        if m > cover_line:
            home_covers += 1
        elif m < cover_line:
            away_covers += 1
        else:
            push_spread += 1

        t = hs + as_
        if t > game.total_line:
            overs += 1
        elif t < game.total_line:
            unders += 1
        else:
            push_total += 1

    n = n_sims
    home_win_pct = home_wins / n
    over_pct = overs / n
    home_cover_pct = home_covers / n

    return {
        "matchup": f"{game.away_team} @ {game.home_team}",
        "market_home_win_prob": round(game.home_win_prob_market * 100, 1),
        "calibrated_variance_alpha": round(game.variance_alpha, 3),
        "stat_weight": game.stat_weight,
        "market_projected_home": round(game.market_home_expected, 1),
        "market_projected_away": round(game.market_away_expected, 1),
        "final_projected_home": round(game.home_expected, 1),
        "final_projected_away": round(game.away_expected, 1),
        "sim_home_win_pct": round(home_win_pct * 100, 1),
        "sim_home_win_ci": tuple(round(x * 100, 1) for x in wilson_ci(home_win_pct, n)),
        "sim_away_win_pct": round(away_wins / n * 100, 1),
        "sim_home_cover_pct": round(home_cover_pct * 100, 1),
        "sim_home_cover_ci": tuple(round(x * 100, 1) for x in wilson_ci(home_cover_pct, n)),
        "sim_away_cover_pct": round(away_covers / n * 100, 1),
        "sim_push_pct": round(push_spread / n * 100, 2),
        "sim_over_pct": round(over_pct * 100, 1),
        "sim_over_ci": tuple(round(x * 100, 1) for x in wilson_ci(over_pct, n)),
        "sim_under_pct": round(unders / n * 100, 1),
        "avg_home_score": round(statistics.mean(home_scores), 1),
        "avg_away_score": round(statistics.mean(away_scores), 1),
        "median_total": statistics.median([h + a for h, a in zip(home_scores, away_scores)]),
    }


def print_report(result: dict, game: Game):
    print("=" * 62)
    print(result["matchup"])
    print("=" * 62)
    print(f"Market home win prob (de-vigged): {result['market_home_win_prob']}%")
    if game.stat_weight > 0:
        print(f"Stat weight: {result['stat_weight']}  |  "
              f"Market proj: {result['market_projected_home']}-{result['market_projected_away']}  "
              f"-> Final proj: {result['final_projected_home']}-{result['final_projected_away']}")
    print(f"Auto-calibrated variance dial: {result['calibrated_variance_alpha']}")
    print()
    print("MONEYLINE (25,000 sims)")
    lo, hi = result["sim_home_win_ci"]
    print(f"  {game.home_team} win: {result['sim_home_win_pct']}%  (95% CI: {lo}-{hi}%)")
    print(f"  {game.away_team} win: {result['sim_away_win_pct']}%")
    print()
    print(f"SPREAD ({game.home_team} {game.home_spread:+.1f})")
    lo, hi = result["sim_home_cover_ci"]
    print(f"  {game.home_team} covers: {result['sim_home_cover_pct']}%  (95% CI: {lo}-{hi}%)")
    print(f"  {game.away_team} covers: {result['sim_away_cover_pct']}%")
    if result["sim_push_pct"] > 0:
        print(f"  Push: {result['sim_push_pct']}%")
    print()
    print(f"TOTAL ({game.total_line})")
    lo, hi = result["sim_over_ci"]
    print(f"  Over:  {result['sim_over_pct']}%  (95% CI: {lo}-{hi}%)")
    print(f"  Under: {result['sim_under_pct']}%")
    print()
    print(f"Projected score: {game.home_team} {result['avg_home_score']} - "
          f"{game.away_team} {result['avg_away_score']}")
    print()

# ---------- backtesting ----------

def brier_score(predictions_and_outcomes: list[tuple[float, int]]) -> float:
    """predictions_and_outcomes: list of (predicted_prob 0-1, actual_outcome 0/1).
    Lower is better. 0.25 = no-skill coin flip; under ~0.20 is solid for NFL;
    well-calibrated sportsbook closing lines land around 0.17-0.19."""
    n = len(predictions_and_outcomes)
    return sum((p - o) ** 2 for p, o in predictions_and_outcomes) / n


def calibration_table(predictions_and_outcomes: list[tuple[float, int]], n_buckets: int = 5) -> list[dict]:
    """Buckets predictions by confidence and shows actual win rate per bucket.
    A well-calibrated model's 'predicted avg' and 'actual rate' columns should
    track closely — e.g. games predicted ~70% should win close to 70% of the time."""
    buckets = [[] for _ in range(n_buckets)]
    for p, o in predictions_and_outcomes:
        idx = min(int(p * n_buckets), n_buckets - 1)
        buckets[idx].append((p, o))
    rows = []
    for i, b in enumerate(buckets):
        if not b:
            continue
        rows.append({
            "range": f"{i/n_buckets:.0%}-{(i+1)/n_buckets:.0%}",
            "n_games": len(b),
            "predicted_avg": round(statistics.mean(p for p, _ in b) * 100, 1),
            "actual_rate": round(statistics.mean(o for _, o in b) * 100, 1),
        })
    return rows


def backtest_from_csv(filepath: str, n_sims: int = 3000) -> dict:
    """
    Expects a CSV with columns:
      home_team, away_team, home_ml, away_ml, home_spread, total_line,
      home_score, away_score
    Optional stat columns (blank = pure market for that row):
      home_off_rating, home_def_rating, away_off_rating, away_def_rating, stat_weight

    Runs the model on each historical game using odds/stats known BEFORE
    kickoff, compares to what actually happened, and reports Brier scores
    for moneyline, spread cover, and over/under -- the real test of accuracy.
    """
    ml_preds, spread_preds, total_preds = [], [], []

    with open(filepath, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            g = game_from_row(row)
            result = simulate_game(g, n_sims=n_sims, seed=42)

            actual_home_score = int(row["home_score"])
            actual_away_score = int(row["away_score"])
            actual_home_win = 1 if actual_home_score > actual_away_score else 0
            actual_home_cover = 1 if (actual_home_score - actual_away_score) > -g.home_spread else 0
            actual_over = 1 if (actual_home_score + actual_away_score) > g.total_line else 0

            ml_preds.append((result["sim_home_win_pct"] / 100, actual_home_win))
            spread_preds.append((result["sim_home_cover_pct"] / 100, actual_home_cover))
            total_preds.append((result["sim_over_pct"] / 100, actual_over))

    return {
        "n_games": len(ml_preds),
        "moneyline_brier": round(brier_score(ml_preds), 4),
        "spread_brier": round(brier_score(spread_preds), 4),
        "total_brier": round(brier_score(total_preds), 4),
        "moneyline_calibration": calibration_table(ml_preds),
    }


# ---------- export for Google Sheets ----------

CSV_COLUMNS = [
    "matchup", "home_team", "away_team",
    "market_home_win_pct", "sim_home_win_pct", "sim_away_win_pct",
    "home_spread", "sim_home_cover_pct", "sim_away_cover_pct",
    "total_line", "sim_over_pct", "sim_under_pct",
    "proj_home_score", "proj_away_score", "variance_alpha",
]


def export_results_csv(games_and_results: list[tuple["Game", dict]], filepath: str):
    """Writes one row per game. Open the file, or drag it into Google Drive
    and choose 'Open with > Google Sheets' to auto-convert -- or in Sheets:
    File > Import > Upload > select this file > 'Insert new sheet'."""
    with open(filepath, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for game, result in games_and_results:
            writer.writerow({
                "matchup": result["matchup"],
                "home_team": game.home_team,
                "away_team": game.away_team,
                "market_home_win_pct": result["market_home_win_prob"],
                "sim_home_win_pct": result["sim_home_win_pct"],
                "sim_away_win_pct": result["sim_away_win_pct"],
                "home_spread": game.home_spread,
                "sim_home_cover_pct": result["sim_home_cover_pct"],
                "sim_away_cover_pct": result["sim_away_cover_pct"],
                "total_line": game.total_line,
                "sim_over_pct": result["sim_over_pct"],
                "sim_under_pct": result["sim_under_pct"],
                "proj_home_score": result["avg_home_score"],
                "proj_away_score": result["avg_away_score"],
                "variance_alpha": result["calibrated_variance_alpha"],
            })


if __name__ == "__main__":
    games = [
        Game(home_team="Chiefs", away_team="Ravens",
             home_ml=-135, away_ml=+115, home_spread=-2.5, total_line=47.5),
        Game(home_team="49ers", away_team="Cowboys",
             home_ml=-180, away_ml=+155, home_spread=-4.0, total_line=44.0),
        # Example WITH stats blended in (30% weight toward stats):
        Game(home_team="Bills", away_team="Jets",
             home_ml=-160, away_ml=+135, home_spread=-3.5, total_line=41.5,
             home_off_rating=4.2, home_def_rating=-2.1,
             away_off_rating=-3.5, away_def_rating=1.0,
             stat_weight=0.3),
    ]

    results = []
    for g in games:
        r = simulate_game(g, n_sims=25000, seed=None)
        print_report(r, g)
        results.append((g, r))

    export_results_csv(results, "/mnt/user-data/outputs/nfl_sim_results.csv")
    print("Exported: nfl_sim_results.csv")


# ---------- weekly slate workflow (CSV in -> CSV out, no code editing) ----------

def game_from_row(row: dict) -> "Game":
    """Shared CSV-row parser used by both backtesting and the weekly slate
    runner. Blank/missing stat columns default to pure market (stat_weight=0)."""
    return Game(
        home_team=row["home_team"], away_team=row["away_team"],
        home_ml=int(row["home_ml"]), away_ml=int(row["away_ml"]),
        home_spread=float(row["home_spread"]), total_line=float(row["total_line"]),
        home_off_rating=float(row.get("home_off_rating") or 0),
        home_def_rating=float(row.get("home_def_rating") or 0),
        away_off_rating=float(row.get("away_off_rating") or 0),
        away_def_rating=float(row.get("away_def_rating") or 0),
        stat_weight=float(row.get("stat_weight") or 0),
    )


SLATE_CSV_COLUMNS = [
    "slate", "matchup", "home_team", "away_team",
    "market_home_win_pct", "sim_home_win_pct",
    "home_spread", "sim_home_cover_pct",
    "total_line", "sim_over_pct",
    "proj_home_score", "proj_away_score",
    "best_bet", "best_bet_edge_pts",
]


def run_slate_from_csv(input_csv: str, output_csv: str, n_sims: int = 25000):
    """
    Weekly workflow: fill in ONE csv (see the 'slate' column for TNF/SUN/MNF
    labels), run this, get back a ranked CSV -- no code editing required.

    Required input columns: slate, home_team, away_team, home_ml, away_ml,
    home_spread, total_line
    Optional (leave blank for pure market): home_off_rating, home_def_rating,
    away_off_rating, away_def_rating, stat_weight

    Sorts output by the size of the biggest disagreement between the model
    and the market for that game, so the games most worth a second look
    float to the top instead of being buried in a 13-game list.
    """
    rows_out = []
    skipped = []

    with open(input_csv, newline="") as f:
        for row in csv.DictReader(f):
            if not row.get("home_team") or not row.get("home_ml"):
                skipped.append(row.get("home_team", "?"))
                continue
            try:
                g = game_from_row(row)
            except (ValueError, KeyError) as e:
                skipped.append(f"{row.get('home_team','?')} ({e})")
                continue

            r = simulate_game(g, n_sims=n_sims, seed=None)

            ml_edge = r["sim_home_win_pct"] - r["market_home_win_prob"]
            spread_edge = r["sim_home_cover_pct"] - 50.0
            total_edge = r["sim_over_pct"] - 50.0

            candidates = [
                ("ML", g.home_team if ml_edge > 0 else g.away_team, abs(ml_edge)),
                ("Spread", f"{g.home_team} {g.home_spread:+.1f}" if spread_edge > 0
                           else f"{g.away_team} {-g.home_spread:+.1f}", abs(spread_edge)),
                ("Total", f"Over {g.total_line}" if total_edge > 0 else f"Under {g.total_line}", abs(total_edge)),
            ]
            best = max(candidates, key=lambda c: c[2])

            rows_out.append({
                "slate": row.get("slate", ""),
                "matchup": r["matchup"],
                "home_team": g.home_team, "away_team": g.away_team,
                "market_home_win_pct": r["market_home_win_prob"],
                "sim_home_win_pct": r["sim_home_win_pct"],
                "home_spread": g.home_spread,
                "sim_home_cover_pct": r["sim_home_cover_pct"],
                "total_line": g.total_line,
                "sim_over_pct": r["sim_over_pct"],
                "proj_home_score": r["avg_home_score"],
                "proj_away_score": r["avg_away_score"],
                "best_bet": f"{best[0]}: {best[1]}",
                "best_bet_edge_pts": round(best[2], 1),
            })

    rows_out.sort(key=lambda r: r["best_bet_edge_pts"], reverse=True)

    with open(output_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=SLATE_CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows_out)

    print(f"\n{'='*62}\nBEST BETS THIS WEEK (ranked by model-vs-market disagreement)\n{'='*62}")
    for r in rows_out[:8]:
        print(f"  [{r['slate']:>4}] {r['matchup']:<28} {r['best_bet']:<22} edge: {r['best_bet_edge_pts']} pts")
    if skipped:
        print(f"\nSkipped {len(skipped)} incomplete row(s): {skipped}")
    print(f"\nFull results -> {output_csv} ({len(rows_out)} games)")
    return rows_out
