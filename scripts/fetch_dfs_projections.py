import os
import re
from datetime import datetime, timezone
from urllib.parse import quote

import requests
import pandas as pd
from io import StringIO

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

SCRAPE_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; FantasyNowPlusBot/1.0)"}

SEASON_START = datetime(2026, 9, 9, tzinfo=timezone.utc)

TEAM_ALIASES = {
    "JAC": "JAX", "WSH": "WAS", "LA": "LAR",
    "GNB": "GB", "KAN": "KC", "NWE": "NE",
    "NOR": "NO", "SFO": "SF", "TAM": "TB",
}

TEAM_NAME_TO_ABBR = {
    "arizona cardinals": "ARI", "atlanta falcons": "ATL", "baltimore ravens": "BAL",
    "buffalo bills": "BUF", "carolina panthers": "CAR", "chicago bears": "CHI",
    "cincinnati bengals": "CIN", "cleveland browns": "CLE", "dallas cowboys": "DAL",
    "denver broncos": "DEN", "detroit lions": "DET", "green bay packers": "GB",
    "houston texans": "HOU", "indianapolis colts": "IND", "jacksonville jaguars": "JAX",
    "kansas city chiefs": "KC", "las vegas raiders": "LV", "los angeles chargers": "LAC",
    "los angeles rams": "LAR", "miami dolphins": "MIA", "minnesota vikings": "MIN",
    "new england patriots": "NE", "new orleans saints": "NO", "new york giants": "NYG",
    "new york jets": "NYJ", "philadelphia eagles": "PHI", "pittsburgh steelers": "PIT",
    "san francisco 49ers": "SF", "seattle seahawks": "SEA", "tampa bay buccaneers": "TB",
    "tennessee titans": "TEN", "washington commanders": "WAS",
}


def current_week():
    delta = (datetime.now(timezone.utc) - SEASON_START).days
    return max(1, delta // 7 + 1)


def norm_team(t):
    t = (t or "").strip().upper()
    return TEAM_ALIASES.get(t, t)


def norm_name(s):
    s = (s or "").lower()
    s = re.sub(r"[.']", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def fetch_table(url):
    resp = requests.get(url, headers=SCRAPE_HEADERS, timeout=20)
    resp.raise_for_status()
    tables = pd.read_html(StringIO(resp.text))
    return max(tables, key=len)


def flatten_columns(df):
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [" ".join(str(x) for x in col if "Unnamed" not in str(x)).strip()
                      for col in df.columns]
    return df


def player_projections(pos, week):
    url = f"https://www.fantasypros.com/nfl/projections/{pos}.php?week={week}"
    df = flatten_columns(fetch_table(url))
    df = df[df.iloc[:, 0].astype(str).str.strip() != ""]

    name_col = df.columns[0]
    fpts_col = df.columns[-1]
    rec_col = next((c for c in df.columns if "REC" in c.upper()), None)

    out = {}
    for _, row in df.iterrows():
        raw = str(row[name_col])
        m = re.match(r"^(.*?)\s*([A-Z]{2,3})$", raw.strip())
        if not m:
            continue
        name, team = m.group(1), norm_team(m.group(2))
        try:
            fpts = float(row[fpts_col])
        except (TypeError, ValueError):
            continue
        if rec_col is not None:
            try:
                fpts += float(row[rec_col])
            except (TypeError, ValueError):
                pass
        out[(norm_name(name), team)] = round(fpts, 1)
    return out


def dst_projections(week):
    url = f"https://www.fantasypros.com/nfl/projections/dst.php?week={week}"
    df = flatten_columns(fetch_table(url))
    df = df[df.iloc[:, 0].astype(str).str.strip() != ""]

    name_col = df.columns[0]
    fpts_col = df.columns[-1]

    out = {}
    for _, row in df.iterrows():
        raw = str(row[name_col]).strip().lower()
        abbr = None
        for full, code in TEAM_NAME_TO_ABBR.items():
            if raw.endswith(full.split()[-1]):
                abbr = code
                break
        if not abbr:
            continue
        try:
            out[abbr] = round(float(row[fpts_col]), 1)
        except (TypeError, ValueError):
            continue
    return out


def fetch_dk_players():
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/dfs_players?select=name,team,position",
        headers=HEADERS, timeout=20,
    )
    resp.raise_for_status()
    seen = {}
    for row in resp.json():
        seen[(row["name"], row["team"], row["position"])] = True
    return list(seen.keys())


def patch_projection(name, team, points):
    url = f"{SUPABASE_URL}/rest/v1/dfs_players?name=eq.{quote(name)}&team=eq.{quote(team)}"
    resp = requests.patch(url, headers=HEADERS, json={"projected_points": points}, timeout=20)
    resp.raise_for_status()


def main():
    week = current_week()
    print(f"Fetching FantasyPros projections for week {week}")

    proj = {}
    for pos in ("qb", "rb", "wr", "te"):
        proj[pos] = player_projections(pos, week)
        print(f"  {pos}: {len(proj[pos])} players")
    dst = dst_projections(week)
    print(f"  dst: {len(dst)} teams")

    dk_players = fetch_dk_players()
    print(f"Matching against {len(dk_players)} DK players")

    matched, unmatched = 0, []
    for name, team, position in dk_players:
        pos_key = position.lower()
        team_n = norm_team(team)

        if pos_key == "dst":
            points = dst.get(team_n)
        else:
            points = proj.get(pos_key, {}).get((norm_name(name), team_n))

        if points is None:
            unmatched.append(f"{name} ({position}, {team})")
            continue

        patch_projection(name, team, points)
        matched += 1

    print(f"Matched {matched} players, {len(unmatched)} unmatched")
    if unmatched:
        print("Sample unmatched:", unmatched[:15])


if __name__ == "__main__":
    main()
