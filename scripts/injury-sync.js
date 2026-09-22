import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const FP_API_KEY = process.env.FANTASYPROS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!FP_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required env vars: FANTASYPROS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

// --- Season / week resolution -------------------------------------------
// NFL_WEEK1_START = the Tuesday (or any fixed weekday) that Week 1 begins on,
// as a repo variable/secret, e.g. "2026-09-08". Update once per season.
// WEEK_OVERRIDE / SEASON_OVERRIDE let a manual run target a specific week.
function resolveSeasonWeek() {
  if (process.env.SEASON_OVERRIDE && process.env.WEEK_OVERRIDE) {
    return {
      season: parseInt(process.env.SEASON_OVERRIDE, 10),
      week: parseInt(process.env.WEEK_OVERRIDE, 10),
    };
  }

  const week1Start = process.env.NFL_WEEK1_START;
  if (!week1Start) {
    throw new Error("Set NFL_WEEK1_START (e.g. 2026-09-08) or pass SEASON_OVERRIDE/WEEK_OVERRIDE.");
  }

  const start = new Date(`${week1Start}T00:00:00Z`);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const week = Math.min(18, Math.max(1, Math.floor(diffDays / 7) + 1));
  const season = start.getUTCFullYear();

  return { season, week };
}

// --- FantasyPros fetch helpers -------------------------------------------
async function fpFetch(path) {
  const res = await fetch(`https://api.fantasypros.com/public/v2/json${path}`, {
    headers: { "x-api-key": FP_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`FantasyPros request failed (${res.status}): ${path}`);
  }
  return res.json();
}

// Builds a player_id -> { position, team } map, restricted to skill positions.
export async function fetchPlayerLookup() {
  const data = await fpFetch("/nfl/players");
  const lookup = new Map();
  for (const p of data.players ?? []) {
    if (FANTASY_POSITIONS.has(p.position_id)) {
      lookup.set(p.player_id, { position: p.position_id, team: p.team_id });
    }
  }
  return lookup;
}

export async function fetchInjuries(season, week) {
  const data = await fpFetch(`/nfl/injuries?year=${season}&week=${week}&include_probabilities=true`);
  return data.injuries ?? [];
}

// Fetches, filters, and inserts injury rows for a single week. Shared by the
// scheduled sync (current week) and the manual backfill script (past weeks).
export async function syncWeek(season, week, playerLookup) {
  const injuries = await fetchInjuries(season, week);

  const rows = [];
  for (const inj of injuries) {
    const player = playerLookup.get(inj.player_id);
    if (!player) continue; // not a fantasy-relevant (QB/RB/WR/TE) player

    rows.push({
      season,
      week,
      player_id: inj.player_id,
      name: inj.name,
      team: player.team,
      position: player.position,
      status: inj.status,
      status_short: inj.status_short,
      injury_type: inj.injury_type,
      comment: inj.comment,
      probability_of_playing: inj.probability_of_playing ?? null,
      injury_update_date: inj.injury_update_date ?? null,
    });
  }

  if (rows.length === 0) {
    console.log(`No fantasy-relevant injuries found for week ${week}.`);
    return 0;
  }

  const { error } = await supabase.from("injury_reports").insert(rows);
  if (error) throw error;

  console.log(`Inserted ${rows.length} injury rows for week ${week}.`);
  return rows.length;
}

// --- Main -----------------------------------------------------------------
async function main() {
  const { season, week } = resolveSeasonWeek();
  console.log(`Syncing injuries for season ${season}, week ${week}...`);

  const playerLookup = await fetchPlayerLookup();
  await syncWeek(season, week, playerLookup);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}