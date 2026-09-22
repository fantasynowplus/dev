// One-off backfill of past weeks' injury data. Unlike the scheduled sync
// (which always appends), this DELETES any existing rows for each
// season/week it touches first, so it's safe to re-run without duplicating
// history.
//
// Usage:
//   FANTASYPROS_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/injury-backfill.js <season> <startWeek> <endWeek>
//
// Example: backfill weeks 1-3 of the 2026 season
//   node scripts/injury-backfill.js 2026 1 3

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { fetchPlayerLookup, fetchSleeperInjuryLookup, syncWeek } from "./injury-sync.js";

const FP_API_KEY = process.env.FANTASYPROS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!FP_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required env vars: FANTASYPROS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const [season, startWeek, endWeek] = process.argv.slice(2).map(Number);

if (!season || !startWeek || !endWeek || startWeek > endWeek) {
  console.error("Usage: node scripts/injury-backfill.js <season> <startWeek> <endWeek>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});
const DELAY_MS = 1000; // be polite to the FantasyPros API between weeks

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`Backfilling season ${season}, weeks ${startWeek}-${endWeek}...`);

  const [playerLookup, sleeperLookup] = await Promise.all([
    fetchPlayerLookup(),
    fetchSleeperInjuryLookup(),
  ]);

  for (let week = startWeek; week <= endWeek; week++) {
    // Clear any existing rows for this season/week so re-runs don't duplicate.
    const { error: deleteError } = await supabase
      .from("injury_reports")
      .delete()
      .eq("season", season)
      .eq("week", week);
    if (deleteError) throw deleteError;

    await syncWeek(season, week, playerLookup, sleeperLookup);

    if (week < endWeek) await sleep(DELAY_MS);
  }

  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
