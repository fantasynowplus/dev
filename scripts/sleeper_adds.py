#!/usr/bin/env python3
"""Fetch Sleeper trending waiver adds and write data/sleeper-adds.json.

Two Sleeper endpoints are used:
  1. /v1/players/nfl          - full player map. Large (~5MB) and Sleeper asks
                                that it be pulled at most once a day, so a
                                trimmed copy is cached in data/ and only
                                refreshed when it goes stale.
  2. /v1/players/nfl/trending/add - list of {player_id, count}.

Output is keyed by Sleeper player_id, which waiver-wire.html already carries in the
sleeperId column of Web_Data. A by_name map is included as a fallback for rows
where that column is empty.
"""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
TRENDING_URL = "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours={hours}&limit={limit}"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
CACHE_PATH = os.path.join(DATA_DIR, "sleeper-players.json")
OUT_PATH = os.path.join(DATA_DIR, "sleeper-adds.json")

POSITIONS = {"QB", "RB", "WR", "TE"}
LOOKBACK_HOURS = int(os.environ.get("SLEEPER_LOOKBACK_HOURS", "48"))
TRENDING_LIMIT = int(os.environ.get("SLEEPER_TRENDING_LIMIT", "300"))
CACHE_MAX_AGE_HOURS = 20

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def norm_name(name):
    """Must stay in sync with normName() in waiver-wire.html."""
    s = (name or "").lower()
    s = s.replace("\u2019", "").replace("'", "").replace("`", "").replace(".", "")
    s = re.sub(r"[^a-z\s-]", "", s)
    parts = [p for p in s.split() if p not in SUFFIXES]
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def join_key(name, pos):
    return "{}|{}".format(norm_name(name), (pos or "").upper())


def fetch_json(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "fantasynowplus-waivers/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - retry on any transport error
            if attempt == 2:
                raise
            print("  retrying after error: {}".format(exc), file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return None


def cache_is_fresh():
    if not os.path.exists(CACHE_PATH):
        return False
    age_hours = (time.time() - os.path.getmtime(CACHE_PATH)) / 3600.0
    return age_hours < CACHE_MAX_AGE_HOURS


def load_players():
    """Return {player_id: {name, pos, team}} for skill-position players."""
    if cache_is_fresh():
        print("Using cached player map")
        with open(CACHE_PATH, encoding="utf-8") as fh:
            return json.load(fh)

    print("Fetching Sleeper player map")
    raw = fetch_json(PLAYERS_URL)
    trimmed = {}
    for pid, p in (raw or {}).items():
        if not isinstance(p, dict):
            continue
        pos = p.get("position")
        if pos not in POSITIONS:
            continue
        name = p.get("full_name") or " ".join(
            x for x in [p.get("first_name"), p.get("last_name")] if x
        )
        if not name:
            continue
        trimmed[pid] = {
            "name": name,
            "pos": pos,
            "team": p.get("team") or "",
        }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as fh:
        json.dump(trimmed, fh, separators=(",", ":"), sort_keys=True)
    print("Cached {} skill-position players".format(len(trimmed)))
    return trimmed


def main():
    players = load_players()
    if not players:
        print("No player map available", file=sys.stderr)
        return 1

    url = TRENDING_URL.format(hours=LOOKBACK_HOURS, limit=TRENDING_LIMIT)
    print("Fetching trending adds ({}h lookback)".format(LOOKBACK_HOURS))
    trending = fetch_json(url) or []

    players_out = {}
    by_name = {}
    unmatched = 0
    for entry in trending:
        pid = str(entry.get("player_id", ""))
        count = int(entry.get("count") or 0)
        p = players.get(pid)
        if not p:
            unmatched += 1
            continue
        players_out[pid] = {
            "name": p["name"],
            "team": p["team"],
            "pos": p["pos"],
            "adds": count,
        }
        key = join_key(p["name"], p["pos"])
        if key.strip("|"):
            by_name[key] = pid

    ranked = sorted(players_out.items(), key=lambda kv: kv[1]["adds"], reverse=True)
    for i, (pid, row) in enumerate(ranked, start=1):
        players_out[pid]["add_rank"] = i

    payload = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lookback_hours": LOOKBACK_HOURS,
        "count": len(players_out),
        "players": players_out,
        "by_name": by_name,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, sort_keys=True)

    print("Wrote {} players to {}".format(len(players_out), OUT_PATH))
    if unmatched:
        print("{} trending ids were not skill-position players (ignored)".format(unmatched))
    for pid, row in ranked[:10]:
        print("  {:>7,}  {} {} ({})  id={}".format(row["adds"], row["pos"], row["name"], row["team"], pid))
    return 0


if __name__ == "__main__":
    sys.exit(main())