import os
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

# How much an injury designation should suppress a player's own ownership share.
# Full-word statuses confirmed from Sleeper's /v1/players/nfl (see my-leagues.js INJ_TAG).
INJURY_MULTIPLIER = {
    "Questionable": 0.85,
    "Doubtful": 0.35,
    "Out": 0.05,
    "IR": 0.02,
    "PUP": 0.02,
    "Sus": 0.02,
    "COV": 0.30,
    "NA": 1.0,
}

# Target sum of ownership % within a position group for a Classic slate, reflecting
# how many roster slots of that type get filled per lineup (including a rough share
# of the flexible FLEX spot for RB/WR/TE). Showdown has no position slots at all -
# every player competes for the same 6 spots (1 CPT + 5 UTIL) from the combined pool.
CLASSIC_TARGETS = {"QB": 100, "RB": 250, "WR": 340, "TE": 110, "DST": 100}
SHOWDOWN_TARGET = 600
MAX_OWNERSHIP = 95.0


def score(player):
    pts = max(player.get("projected_points") or 0, 0)
    salary = max(player.get("salary") or 0, 100)
    mult = INJURY_MULTIPLIER.get(player.get("injury_status"), 1.0)
    return (pts ** 2) / salary * mult


def fetch_slates():
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/dfs_slates?select=draft_group_id,contest_type",
        headers=HEADERS, timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_players(draft_group_id):
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/dfs_players"
        f"?draft_group_id=eq.{draft_group_id}"
        "&select=dk_player_id,position,salary,projected_points,injury_status",
        headers=HEADERS, timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def compute_ownership(players, contest_type):
    scored = [(p, score(p)) for p in players]

    if contest_type == "showdown":
        total = sum(s for _, s in scored) or 1
        return {
            p["dk_player_id"]: round(min(SHOWDOWN_TARGET * s / total, MAX_OWNERSHIP), 1)
            for p, s in scored
        }

    result = {}
    for pos, target in CLASSIC_TARGETS.items():
        group = [(p, s) for p, s in scored if p["position"] == pos]
        total = sum(s for _, s in group) or 1
        for p, s in group:
            result[p["dk_player_id"]] = round(min(target * s / total, MAX_OWNERSHIP), 1)
    return result


def upsert_ownership(draft_group_id, ownership):
    rows = [
        {"draft_group_id": draft_group_id, "dk_player_id": pid, "ownership_pct": pct}
        for pid, pct in ownership.items()
    ]
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
    print(f"Computing ownership for {len(slates)} slates")

    for slate in slates:
        gid = slate["draft_group_id"]
        players = fetch_players(gid)
        ownership = compute_ownership(players, slate["contest_type"])
        upsert_ownership(gid, ownership)
        print(f"  slate {gid} ({slate['contest_type']}): {len(ownership)} players")


if __name__ == "__main__":
    main()