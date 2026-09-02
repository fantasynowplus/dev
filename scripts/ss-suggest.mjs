import { readFile } from 'node:fs/promises';
import { buildSuggestions, normTeam } from '../javascript/ss-suggest-core.js';

const FP_KEY  = process.env.FP_API_KEY;
const SB_URL  = process.env.SUPABASE_URL;
const SB_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;

if (!FP_KEY || !SB_URL || !SB_KEY) {
  console.error('Missing FP_API_KEY, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const nameKey = s => String(s || '')
  .toLowerCase()
  .replace(/[.'`’]/g, '')
  .replace(SUFFIX, '')
  .replace(/[^a-z ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function getJson(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const body = await r.text();
  return body ? JSON.parse(body) : null;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const head = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    head.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

async function loadSchedule(season) {
  const text = await fetch(
    'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
  ).then(r => r.text());

  return parseCsv(text).filter(
    g => Number(g.season) === season && g.game_type === 'REG'
  );
}

function upcomingWeek(games) {
  const now = Date.now();
  const weeks = [...new Set(games.map(g => Number(g.week)))].sort((a, b) => a - b);
  for (const w of weeks) {
    const kicks = games
      .filter(g => Number(g.week) === w)
      .map(g => Date.parse(`${g.gameday}T${g.gametime || '13:00'}:00-05:00`))
      .filter(Number.isFinite);
    if (kicks.length && Math.max(...kicks) > now) return w;
  }
  return weeks[weeks.length - 1] || 1;
}

function weekMap(games, week) {
  const map = {};
  for (const g of games.filter(x => Number(x.week) === week)) {
    const home = normTeam(g.home_team);
    const away = normTeam(g.away_team);
    map[home] = { opp: away, home: true };
    map[away] = { opp: home, home: false };
  }
  return map;
}

async function loadSleeper() {
  const all = await getJson('https://api.sleeper.app/v1/players/nfl');
  const byKey = new Map();
  for (const p of Object.values(all)) {
    if (!POSITIONS.includes(p.position) || !p.team) continue;
    const k = nameKey(p.full_name || `${p.first_name} ${p.last_name}`);
    const rec = {
      sleeper_id: p.player_id,
      espn_id: p.espn_id || null,
      pos: p.position,
      team: normTeam(p.team),
      status: p.status || null,
      injury_status: p.injury_status || null
    };
    byKey.set(`${k}|${rec.pos}|${rec.team}`, rec);
    if (!byKey.has(`${k}|${rec.pos}`)) byKey.set(`${k}|${rec.pos}`, rec);
  }
  return byKey;
}

async function loadRankings(season, week, rk) {
  const type = rk.type || 'draft';
  const out = [];

  for (const pos of POSITIONS) {
    const qs = new URLSearchParams({
      position: pos,
      type,
      scoring: rk.scoring || 'PPR'
    });
    if (type === 'weekly') qs.set('week', String(week));

    const url =
      `https://api.fantasypros.com/public/v2/json/nfl/${season}/consensus-rankings?${qs}`;

    let data;
    try {
      data = await getJson(url, { headers: { 'x-api-key': FP_KEY } });
    } catch (err) {
      console.error(`FantasyPros ${pos} (${type}) failed: ${err.message}`);
      continue;
    }

    const players = data.players || data.rankings || [];
    players.forEach((p, i) => {
      const posRank = String(p.pos_rank || '').match(/\d+/);
      out.push({
        name: p.player_name || p.name,
        team: normTeam(p.player_team_id || p.team),
        pos,
        rank: posRank ? Number(posRank[0]) : i + 1
      });
    });
    console.log(`  ${pos}: ${players.length} ranked`);
  }
  return out;
}

function enrich(rankings, sleeper, config) {
  const badStatus = new Set(config.excludeStatuses || []);
  const badInjury = new Set(config.excludeInjury || []);
  const dropped = [];

  const kept = rankings.map(r => {
    const k = nameKey(r.name);
    const hit = sleeper.get(`${k}|${r.pos}|${r.team}`) || sleeper.get(`${k}|${r.pos}`);
    if (!hit) { dropped.push(`${r.name} (no Sleeper match)`); return null; }
    if (badStatus.has(hit.status) || badInjury.has(hit.injury_status)) {
      const why = badStatus.has(hit.status) ? hit.status : hit.injury_status;
      dropped.push(`${r.name} (${why})`);
      return null;
    }
    return { ...r, team: hit.team, sleeper_id: hit.sleeper_id, espn_id: hit.espn_id };
  }).filter(Boolean);

  if (dropped.length) console.log(`  excluded ${dropped.length}: ${dropped.join(', ')}`);
  return kept;
}

const season = Number(process.env.SEASON) || new Date().getFullYear();
const games  = await loadSchedule(season);
if (!games.length) throw new Error(`No REG games found for ${season}`);

const week = Number(process.env.WEEK) || upcomingWeek(games);
console.log(`Building suggestions for ${season} week ${week}`);

const [cfgRows] = await sb('ss_suggest_config?id=eq.1&select=config');
const config = cfgRows.config;

const dvp = JSON.parse(await readFile(new URL('../data/dvp.json', import.meta.url), 'utf8'));
if (!dvp.defense || !Object.keys(dvp.defense).length) {
  throw new Error('data/dvp.json has no defense data — is the DvP sync healthy?');
}

const sleeper  = await loadSleeper();
const rankings = enrich(await loadRankings(season, week, config.rankings || {}), sleeper, config);
if (!rankings.length) throw new Error('No usable rankings — refusing to write an empty payload');

const suggestions = buildSuggestions({
  rankings,
  dvp,
  schedule: weekMap(games, week),
  config
});

const counts = POSITIONS.map(
  p => `${p} ${suggestions[p].tough.length}+${suggestions[p].soft.length}`
).join('  ');
console.log(`Result: ${counts}`);

await sb('ss_suggestions?on_conflict=season,week', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({
    season,
    week,
    source: `${config.rankings?.source || 'fantasypros'}:${config.rankings?.type || 'draft'}`,
    payload: {
      generated: new Date().toISOString(),
      dvp_through: dvp.through_week ?? null,
      bands: config.bands,
      positions: suggestions
    }
  })
});

console.log('Saved.');