"""
Daily NFL model runner for the FantasyNow+ site.

Pulls the current slate + odds, runs the Monte Carlo model in
nfl_simulator.py, and writes assets/data/nfl-sim.json for the
nfl-simulator.html page to render.

Two ways to get a slate, tried in this order:

  1. THE ODDS API  (set ODDS_API_KEY in the environment / GitHub secret)
     Live moneyline, spread and total for every upcoming game.
     NFL requires a paid tier on the-odds-api.com; preseason and regular
     season are both handled.

  2. scripts/slate.csv  (fallback, no key needed)
     The same weekly CSV your run_slate_from_csv() workflow already uses.
     Fill it in, commit it, and the model runs on it. Handy in the
     offseason or if you'd rather paste lines by hand.

Run locally:   python scripts/run_sim.py
In CI:         the .github/workflows/nfl-sim.yml action runs this daily.
"""

import math
import os
import json
import csv
import datetime as dt
import urllib.request
import urllib.error

from nfl_simulator import Game, simulate_game, game_from_row

N_SIMS = int(os.environ.get("NFL_SIM_N", "20000"))
OUT_PATH = os.environ.get("NFL_SIM_OUT", "assets/data/nfl-sim.json")
SLATE_CSV = os.environ.get("NFL_SIM_SLATE", "scripts/slate.csv")
ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "").strip()
BOOK_PRIORITY = ["pinnacle", "draftkings", "fanduel", "betmgm", "caesars"]

TEAM_ABBR = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
    "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
    "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}


def abbr(name: str) -> str:
    if name in TEAM_ABBR:
        return TEAM_ABBR[name]
    return "".join(w[0] for w in name.split()[:3]).upper()


def slate_label(kickoff_iso: str) -> str:
    """TNF / SNF / MNF / SAT / SUN / THU from the kickoff timestamp (ET)."""
    if not kickoff_iso:
        return ""
    try:
        t = dt.datetime.fromisoformat(kickoff_iso.replace("Z", "+00:00"))
        et = t - dt.timedelta(hours=4)
    except ValueError:
        return ""
    wd = et.weekday()
    prime = et.hour >= 19
    if wd == 3:
        return "TNF"
    if wd == 0:
        return "MNF"
    if wd == 6:
        return "SNF" if prime else "SUN"
    if wd == 5:
        return "SAT"
    if wd == 4:
        return "FRI"
    if wd == 1:
        return "TUE"
    return "WED"


# ---------- The Odds API ----------

def _get(url: str) -> list:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

def _first_slate(games: list, window_days: int = 7) -> list:
    """Keep only the next slate: every game within window_days of the earliest
    upcoming kickoff. The 16-day fetch guarantees we find games even across a
    gap week; this trims it back so two weeks don't land on the page at once."""
    dated = [(g, k, b) for (g, k, b) in games if k]
    if not dated:
        return games

    def parse(k):
        return dt.datetime.fromisoformat(k.replace("Z", "+00:00"))

    cutoff = min(parse(k) for (_, k, _) in dated) + dt.timedelta(days=window_days)
    return [(g, k, b) for (g, k, b) in dated if parse(k) <= cutoff]

def fetch_odds_api() -> list[tuple[Game, str, str]]:
    """Returns [(Game, kickoff_iso, book_key)] from the-odds-api.com.
    Tries preseason first (August), then the regular season key."""
    if not ODDS_API_KEY:
        return []

    now = dt.datetime.now(dt.timezone.utc)
    horizon_days = int(os.environ.get("NFL_SIM_HORIZON_DAYS", "16"))
    horizon = now + dt.timedelta(days=horizon_days)
    commence_to = horizon.strftime("%Y-%m-%dT%H:%M:%SZ")

    base = "https://api.the-odds-api.com/v4/sports/{sport}/odds"
    params = ("?regions=us&markets=h2h,spreads,totals"
              "&oddsFormat=american&dateFormat=iso"
              "&commenceTimeTo=" + commence_to +
              "&apiKey=" + ODDS_API_KEY)

    events = []
    for sport in ("americanfootball_nfl_preseason", "americanfootball_nfl"):
        url = base.format(sport=sport) + params
        try:
            data = _get(url)
            if data:
                events.extend(data)
        except urllib.error.HTTPError as e:
            print(f"  odds api {sport}: HTTP {e.code} ({e.reason})")
        except Exception as e:
            print(f"  odds api {sport}: {e}")

    out = []
    seen = set()
    for ev in events:
        eid = ev.get("id")
        if eid in seen:
            continue
        home, away = ev.get("home_team"), ev.get("away_team")
        book = _pick_book(ev.get("bookmakers", []))
        if not (home and away and book):
            continue
        g = _game_from_book(home, away, book)
        if g is None:
            continue
        seen.add(eid)
        out.append((g, ev.get("commence_time", ""), book["key"]))
    return _first_slate(out)

ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100"


def _spread_to_ml_pair(home_spread: float) -> tuple[int, int]:
    """Fallback when ESPN omits moneyline: derive it from the spread so the
    model still has a market win probability. Returns (home_ml, away_ml)."""
    p = 0.5 * (1 + math.erf((-home_spread) / (13.86 * math.sqrt(2))))

    def to_ml(prob):
        prob = min(max(prob, 0.03), 0.97)
        if prob >= 0.5:
            return -int(round(100 * prob / (1 - prob)))
        return int(round(100 * (1 - prob) / prob))

    return to_ml(p), to_ml(1 - p)


def fetch_espn() -> list[tuple[Game, str, str]]:
    """Free NFL slate + lines from ESPN's public scoreboard (no key). Returns
    upcoming games only; skips finals, in-progress, and games with no odds yet."""
    try:
        data = _get(ESPN_SCOREBOARD)
    except Exception as e:
        print(f"  espn: {e}")
        return []
    events = data.get("events", []) if isinstance(data, dict) else []
    out = []
    for ev in events:
        comp = (ev.get("competitions") or [{}])[0]
        state = (((comp.get("status") or {}).get("type") or {}).get("state"))
        if state and state != "pre":
            continue
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        home_name = (home.get("team") or {}).get("displayName")
        away_name = (away.get("team") or {}).get("displayName")
        odds_list = comp.get("odds") or []
        if not odds_list or not home_name or not away_name:
            continue
        od = odds_list[0]
        total = od.get("overUnder")
        if total is None:
            continue
        spread_mag = abs(od.get("spread") or 0)
        if (od.get("homeTeamOdds") or {}).get("favorite"):
            home_spread = -spread_mag
        elif (od.get("awayTeamOdds") or {}).get("favorite"):
            home_spread = spread_mag
        else:
            home_spread = float(od.get("spread") or 0)
        home_ml = (od.get("homeTeamOdds") or {}).get("moneyLine")
        away_ml = (od.get("awayTeamOdds") or {}).get("moneyLine")
        if not isinstance(home_ml, int) or not isinstance(away_ml, int) or home_ml == 0 or away_ml == 0:
            home_ml, away_ml = _spread_to_ml_pair(home_spread)
        try:
            g = Game(home_team=home_name, away_team=away_name,
                     home_ml=int(home_ml), away_ml=int(away_ml),
                     home_spread=float(home_spread), total_line=float(total))
        except Exception:
            continue
        out.append((g, ev.get("date", ""), "espn"))
    return out

def _pick_book(bookmakers: list) -> dict | None:
    by_key = {b.get("key"): b for b in bookmakers}
    for key in BOOK_PRIORITY:
        if key in by_key:
            return by_key[key]
    return bookmakers[0] if bookmakers else None


def _game_from_book(home: str, away: str, book: dict) -> Game | None:
    home_ml = away_ml = None
    home_spread = total_line = None
    for m in book.get("markets", []):
        key = m.get("key")
        outs = m.get("outcomes", [])
        if key == "h2h":
            for o in outs:
                if o["name"] == home:
                    home_ml = int(o["price"])
                elif o["name"] == away:
                    away_ml = int(o["price"])
        elif key == "spreads":
            for o in outs:
                if o["name"] == home:
                    home_spread = float(o["point"])
        elif key == "totals":
            for o in outs:
                if "point" in o:
                    total_line = float(o["point"])
    if None in (home_ml, away_ml, home_spread, total_line):
        return None
    return Game(home_team=home, away_team=away, home_ml=home_ml,
                away_ml=away_ml, home_spread=home_spread, total_line=total_line)


# ---------- CSV fallback ----------

def fetch_csv() -> list[tuple[Game, str, str]]:
    if not os.path.exists(SLATE_CSV):
        return []
    out = []
    with open(SLATE_CSV, newline="") as f:
        for row in csv.DictReader(f):
            if not row.get("home_team") or not row.get("home_ml"):
                continue
            try:
                g = game_from_row(row)
            except (ValueError, KeyError):
                continue
            out.append((g, row.get("kickoff", ""), "csv"))
    return out


# ---------- build one game's payload ----------

def build_game(g: Game, kickoff: str, book: str) -> dict:
    r = simulate_game(g, n_sims=N_SIMS, seed=None)

    ml_edge = r["sim_home_win_pct"] - r["market_home_win_prob"]
    spread_edge = r["sim_home_cover_pct"] - 50.0
    total_edge = r["sim_over_pct"] - 50.0

    candidates = [
        ("ML", g.home_team if ml_edge > 0 else g.away_team, abs(ml_edge)),
        ("Spread",
         f"{abbr(g.home_team)} {g.home_spread:+.1f}" if spread_edge > 0
         else f"{abbr(g.away_team)} {-g.home_spread:+.1f}",
         abs(spread_edge)),
        ("Total",
         f"Over {g.total_line}" if total_edge > 0 else f"Under {g.total_line}",
         abs(total_edge)),
    ]
    best = max(candidates, key=lambda c: c[2])

    return {
        "away": g.away_team, "home": g.home_team,
        "away_abbr": abbr(g.away_team), "home_abbr": abbr(g.home_team),
        "kickoff": kickoff, "slate": slate_label(kickoff), "book": book,
        "home_ml": g.home_ml, "away_ml": g.away_ml,
        "home_spread": g.home_spread, "total_line": g.total_line,
        "market_home_win_pct": r["market_home_win_prob"],
        "sim_home_win_pct": r["sim_home_win_pct"],
        "sim_away_win_pct": r["sim_away_win_pct"],
        "sim_home_cover_pct": r["sim_home_cover_pct"],
        "sim_away_cover_pct": r["sim_away_cover_pct"],
        "sim_over_pct": r["sim_over_pct"],
        "sim_under_pct": r["sim_under_pct"],
        "proj_home_score": r["avg_home_score"],
        "proj_away_score": r["avg_away_score"],
        "best_bet_market": best[0],
        "best_bet_pick": best[1],
        "best_bet_edge": round(best[2], 1),
        "edge_ml": round(ml_edge, 1),
        "variance_alpha": r["calibrated_variance_alpha"],
    }


def main():
    sources = [
        ("the-odds-api", fetch_odds_api),
        ("espn", fetch_espn),
        ("slate.csv", fetch_csv),
    ]
    slate, source = [], "none"
    for name, fn in sources:
        slate = fn()
        if slate:
            source = name
            break

    games = []
    for g, kickoff, book in slate:
        try:
            games.append(build_game(g, kickoff, book))
            print(f"  ran {g.away_team} @ {g.home_team}")
        except Exception as e:
            print(f"  skipped {g.away_team} @ {g.home_team}: {e}")

    games.sort(key=lambda x: x["best_bet_edge"], reverse=True)

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": source if games else "none",
        "n_sims": N_SIMS,
        "count": len(games),
        "games": games,
    }

    out_dir = os.path.dirname(OUT_PATH)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"\nWrote {OUT_PATH}: {len(games)} game(s), source={payload['source']}")


if __name__ == "__main__":
    main()
