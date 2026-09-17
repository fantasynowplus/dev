import os
import time
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


def fetch_slates():
    resp = requests.get(CONTESTS_URL, timeout=20)
    resp.raise_for_status()
    data = resp.json()

    game_type_names = {}
    for gt in data.get("GameTypes", []):
        style = gt.get("GameStyle") or {}
        name = (style.get("Name") or gt.get("Name") or "").lower()
        game_type_names[gt["GameTypeId"]] = "showdown" if "showdown" in name else "classic"

    slates = []
    seen = set()
    for dg in data.get("DraftGroups", []):
        if dg.get("Sport") != "NFL":
            continue
        gid = dg["DraftGroupId"]
        if gid in seen:
            continue
        seen.add(gid)
        slates.append({
            "draft_group_id": gid,
            "slate_name": dg.get("DraftGroupTag") or f"Slate {gid}",
            "contest_type": game_type_names.get(dg.get("GameTypeId"), "classic"),
            "start_time": dg.get("StartDate"),
        })
    return slates


def upsert_slates(slates):
    if not slates:
        return
    resp = requests.post(f"{SUPABASE_URL}/rest/v1/dfs_slates", headers=HEADERS, json=slates, timeout=20)
    resp.raise_for_status()


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


def parse_projection(draft_stat_attributes):
    for attr in draft_stat_attributes or []:
        if attr.get("id") == 90:
            try:
                return float(attr.get("value"))
            except (TypeError, ValueError):
                return None
    return None


def fetch_draftables(draft_group_id):
    resp = requests.get(DRAFTABLES_URL.format(draft_group_id), timeout=20)
    resp.raise_for_status()
    return resp.json().get("draftables", [])


def upsert_players(draft_group_id, draftables):
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
            "projected_points": parse_projection(d.get("draftStatAttributes")),
        }

    rows = list(by_player.values())
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
    slates = fetch_slates()
    upsert_slates(slates)
    print(f"Upserted {len(slates)} slates")

    for slate in slates:
        gid = slate["draft_group_id"]
        draftables = fetch_draftables(gid)
        upsert_players(gid, draftables)
        print(f"Slate {gid}: {len(draftables)} draftable rows")
        time.sleep(0.5)


if __name__ == "__main__":
    main()
