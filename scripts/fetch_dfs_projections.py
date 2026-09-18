import os
import re
from urllib.parse import quote

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

TEAM_ALIASES = {"JAC": "JAX", "WSH": "WAS", "ARZ": "ARI", "LA": "LAR"}


def team_code(t):
    u = (t or "").upper()
    return TEAM_ALIASES.get(u, u)


def norm_name(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z]", "", s)
    s = re.sub(r"(jr|sr|ii|iii|iv|v)$", "", s)
    return s


def sleeper_state():
    resp = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=20)
    resp.raise_for_status()
    return resp.json()


def sleeper_projections(season, week):
    url = (
        f"https://api.sleeper.app/projections/nfl/{season}/{week}"
        "?season_type=regular&position[]=QB&position[]=RB&position[]=WR"
        "&position[]=TE&position[]=DEF"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json() or []


def build_projection_maps(rows):
    by_name = {}
    by_def_team = {}
    for row in rows:
        if not row or not row.get("stats") or not row.get("player"):
            continue
        pts = row["stats"].get("pts_ppr")
        if pts is None:
            continue
        pts = round(pts, 1)
        sleeper_id = row.get("player_id")

        player = row["player"]
        pos = (player.get("fantasy_positions") or [player.get("position")])[0]

        if pos == "DEF":
            team = team_code(row.get("team") or player.get("team"))
            if team:
                by_def_team[team] = {"points": pts, "sleeper_id": sleeper_id}
            continue

        full_name = f"{player.get('first_name', '')} {player.get('last_name', '')}".strip()
        if full_name:
            by_name[norm_name(full_name)] = {"points": pts, "sleeper_id": sleeper_id}

    return by_name, by_def_team


def fetch_injury_map():
    resp = requests.get("https://api.sleeper.app/v1/players/nfl", timeout=60)
    resp.raise_for_status()
    players = resp.json() or {}
    by_name = {}
    for p in players.values():
        status = p.get("injury_status")
        if not status:
            continue
        full_name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        if full_name:
            by_name[norm_name(full_name)] = status
    return by_name


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


def patch_player(name, team, fields):
    url = f"{SUPABASE_URL}/rest/v1/dfs_players?name=eq.{quote(name)}&team=eq.{quote(team)}"
    resp = requests.patch(url, headers=HEADERS, json=fields, timeout=20)
    resp.raise_for_status()


def main():
    state = sleeper_state()
    season, week = state["season"], state["week"]
    print(f"Sleeper reports season {season}, week {week}")

    rows = sleeper_projections(season, week)
    print(f"Fetched {len(rows)} projection rows from Sleeper")

    by_name, by_def_team = build_projection_maps(rows)
    print(f"  {len(by_name)} skill-position players, {len(by_def_team)} defenses")

    injuries = fetch_injury_map()
    print(f"  {len(injuries)} players with an active injury designation")

    dk_players = fetch_dk_players()
    print(f"Matching against {len(dk_players)} DK players")

    matched, unmatched = 0, []
    for name, team, position in dk_players:
        if position == "DST":
            entry = by_def_team.get(team_code(team))
        else:
            entry = by_name.get(norm_name(name))

        if entry is None:
            unmatched.append(f"{name} ({position}, {team})")
            continue

        fields = {"projected_points": entry["points"], "sleeper_id": entry["sleeper_id"]}
        fields["injury_status"] = injuries.get(norm_name(name))

        patch_player(name, team, fields)
        matched += 1

    print(f"Matched {matched} players, {len(unmatched)} unmatched")
    if unmatched:
        print("Sample unmatched:", unmatched[:20])


if __name__ == "__main__":
    main()