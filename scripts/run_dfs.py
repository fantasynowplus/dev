import os
import time
from datetime import datetime, timezone
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

CONTESTS_URL = "https://www.draftkings.com/lobby/getcontests?sport=NFL"
DRAFTABLES_URL = "https://api.draftkings.com/draftgroups/v1/draftgroups/{}/draftables"

SEASON_START = datetime(2026, 9, 9, tzinfo=timezone.utc)


def week_number(start_time):
    if not start_time:
        return None
    try:
        dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
    except ValueError:
        return None
    delta = (dt - SEASON_START).days
    if delta < 0:
        return None
    return delta // 7 + 1


def classify(style_name):
    name = (style_name or "").strip().lower()
    if name == "classic":
        return "classic"
    if "showdown" in name:
        return "showdown"
    return None


def fetch_raw_groups():
    resp = requests.get(CONTESTS_URL, timeout=20)
    resp.raise_for_status()
    data = resp.json()

    type_map = {}
    for gt in data.get("GameTypes", []):
        style = gt.get("GameStyle") or {}
        type_map[gt["GameTypeId"]] = classify(style.get("Name") or gt.get("Name"))

    groups = []
    seen = set()
    for dg in data.get("DraftGroups", []):
        if dg.get("Sport") != "NFL":
            continue
        gid = dg["DraftGroupId"]
        if gid in seen:
            continue
        contest_type = type_map.get(dg.get("GameTypeId"))
        if contest_type is None:
            continue
        seen.add(gid)
        groups.append({
            "draft_group_id": gid,
            "tag": dg.get("DraftGroupTag"),
            "contest_type": contest_type,
            "start_time": dg.get("StartDate"),
            "game_count": dg.get("GameCount"),
        })
    return groups


def parse_opponent(competition, team_abbr):
    name = (competition or {}).get("name") or ""
    parts = name.split(" @ ")
    if len(parts) != 2:
        return name or None
    away, home = parts
    if team_abbr == away:
        return f"@ {home}"
    if team_abbr == home:
        return f"vs {away}"
    return name


def fetch_draftables(draft_group_id):
    resp = requests.get(DRAFTABLES_URL.format(draft_group_id), timeout=20)
    resp.raise_for_status()
    return resp.json().get("draftables", [])


def build_player_rows(draft_group_id, draftables):
    by_player = {}
    for d in draftables:
        if d.get("isDisabled"):
            continue
        pdk_id = d.get("playerDkId")
        if pdk_id is None or d.get("salary") is None or pdk_id in by_player:
            continue
        team = d.get("teamAbbreviation")
        by_player[pdk_id] = {
            "draft_group_id": draft_group_id,
            "dk_player_id": pdk_id,
            "name": d.get("displayName"),
            "position": d.get("position"),
            "team": team,
            "opponent": parse_opponent(d.get("competition"), team),
            "salary": d.get("salary"),
            "projected_points": None,
        }
    return list(by_player.values())


def fallback_name(rows, game_count):
    teams = {}
    for r in rows:
        teams.setdefault(r["team"], r["opponent"])
    if len(teams) == 2:
        for team, opp in teams.items():
            if opp and opp.startswith("@"):
                return f"{team} @ {opp[2:]}"
    if game_count:
        return f"{game_count}-Game Slate"
    return "Slate"


def dedupe(enriched):
    best = {}
    for e in enriched:
        key = (e["contest_type"], e["start_time"], e["team_key"])
        score = (1 if e["tag"] == "Featured" else 0, -e["draft_group_id"])
        if key not in best or score > best[key][0]:
            best[key] = (score, e)
    return [v[1] for v in best.values()]


def upsert_slate(slate):
    resp = requests.post(f"{SUPABASE_URL}/rest/v1/dfs_slates", headers=HEADERS, json=slate, timeout=20)
    resp.raise_for_status()


def upsert_players(rows):
    if not rows:
        return
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/dfs_players?on_conflict=draft_group_id,dk_player_id",
        headers=HEADERS, json=rows, timeout=30,
    )
    if not resp.ok:
        print(resp.text)
    resp.raise_for_status()


def main():
    groups = fetch_raw_groups()
    print(f"Found {len(groups)} classic/showdown NFL draft groups, fetching players for each\u2026")

    enriched = []
    for g in groups:
        draftables = fetch_draftables(g["draft_group_id"])
        rows = build_player_rows(g["draft_group_id"], draftables)
        g["rows"] = rows
        g["team_key"] = frozenset(r["team"] for r in rows if r["team"])
        enriched.append(g)
        time.sleep(0.3)

    kept = dedupe(enriched)
    print(f"Keeping {len(kept)} distinct slates after de-duping same-game variants")

    for g in kept:
        slate_name = g["tag"] or fallback_name(g["rows"], g["game_count"])
        upsert_slate({
            "draft_group_id": g["draft_group_id"],
            "slate_name": slate_name,
            "contest_type": g["contest_type"],
            "start_time": g["start_time"],
            "game_count": g["game_count"],
            "week": week_number(g["start_time"]),
        })
        upsert_players(g["rows"])
        print(f"{g['contest_type']:8} {slate_name!r:30} {len(g['rows'])} players")


if __name__ == "__main__":
    main()