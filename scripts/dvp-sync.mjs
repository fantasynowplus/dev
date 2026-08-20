import { writeFile, mkdir } from 'node:fs/promises';

const POS = ['QB', 'RB', 'WR', 'TE'];
const OUT = 'data/dvp.json';
const L3  = 3;

/* ESPN and Sleeper disagree on a few abbreviations */
const ALIAS = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', SD: 'LAC', OAK: 'LV', ARZ: 'ARI' };
const norm = (t) => ALIAS[String(t || '').toUpperCase()] || String(t || '').toUpperCase();

const UA = 'fantasynowplus-dvp-sync (+https://fantasynowplus.com)';

async function j(url, { raw = false } = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  });
  const body = await r.text();
  if (!r.ok) {
    throw new Error(`${r.status} ${url}\n  body: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`Bad JSON from ${url}\n  body: ${body.slice(0, 300)}`);
  }
}

/* ------------------------------------------------------------
   Season schedule -> { week: { TEAM: OPPONENT } }

   ESPN's scoreboard 403s from CI (Akamai blocks datacenter IPs),
   so the primary source is nflverse's games.csv on raw.github,
   which is reachable from Actions and covers every season at once.
   ESPN stays as a per-week fallback for local runs.
   ------------------------------------------------------------ */

const NFLVERSE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function scheduleFromNflverse(season) {
  const r = await fetch(NFLVERSE, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} nflverse games.csv`);
  const rows = parseCsv(await r.text());
  if (!rows.length) throw new Error('empty games.csv');

  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const cSeason = col('season');
  const cWeek   = col('week');
  const cType   = col('game_type', 'season_type', 'type');
  const cHome   = col('home_team', 'home');
  const cAway   = col('away_team', 'away');

  if ([cSeason, cWeek, cHome, cAway].some((i) => i < 0)) {
    throw new Error(`games.csv columns not recognised: ${head.slice(0, 12).join(',')}`);
  }

  const byWeek = {};
  let games = 0;
  for (let i = 1; i < rows.length; i++) {
    const r2 = rows[i];
    if (!r2 || r2.length < head.length - 2) continue;
    if (Number(r2[cSeason]) !== season) continue;
    if (cType >= 0 && !/^(reg|regular)$/i.test(String(r2[cType]).trim())) continue;
    const w = Number(r2[cWeek]);
    if (!w || w > 18) continue;
    const h = norm(r2[cHome]), a = norm(r2[cAway]);
    if (!h || !a) continue;
    byWeek[w] ??= {};
    byWeek[w][h] = a;
    byWeek[w][a] = h;
    games++;
  }
  if (!games) throw new Error(`no ${season} regular-season games in games.csv`);
  console.log(`  nflverse: ${games} games across ${Object.keys(byWeek).length} weeks`);
  return byWeek;
}

/* per-week ESPN fallback */
async function scheduleFromEspn(season, week) {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' +
              `?dates=${season}&seasontype=2&week=${week}`;
  const map = {};
  try {
    const data = await j(url);
    for (const ev of data.events || []) {
      const c = ev.competitions?.[0];
      const home = c?.competitors?.find((x) => x.homeAway === 'home');
      const away = c?.competitors?.find((x) => x.homeAway === 'away');
      if (!home || !away) continue;
      const h = norm(home.team.abbreviation);
      const a = norm(away.team.abbreviation);
      map[h] = a; map[a] = h;
    }
  } catch (e) {
    console.warn(`  week ${week} ESPN schedule unavailable: ${e.message.split('\n')[0]}`);
  }
  return map;
}

async function loadSchedule(season, through) {
  try {
    return await scheduleFromNflverse(season);
  } catch (e) {
    console.warn(`  nflverse unavailable (${e.message}); falling back to ESPN`);
    const byWeek = {};
    for (let w = 1; w <= through; w++) byWeek[w] = await scheduleFromEspn(season, w);
    return byWeek;
  }
}

async function main() {
  const state = await j('https://api.sleeper.app/v1/state/nfl');
  const liveSeason = Number(state.season);
  const season = Number(process.env.SEASON) || liveSeason;

  /* a past season is complete; only the live season is capped by the current week */
  const through = season < liveSeason
    ? 18
    : Math.max(0, Number(state.week || state.display_week || 1) - 1);

  if (through < 1) {
    console.log(`No completed weeks in ${season} yet — nothing to build.`);
    return;
  }
  console.log(`Season ${season} (live season ${liveSeason}), weeks 1-${through}`);

  console.log('Fetching player index…');
  const players = await j('https://api.sleeper.app/v1/players/nfl');
  const totalKeys = Object.keys(players || {}).length;
  console.log(`  ${totalKeys} entries in the players payload`);

  if (totalKeys < 100) {
    console.error('Players payload looks wrong. First keys:',
      Object.keys(players || {}).slice(0, 10));
    console.error('Sample value:', JSON.stringify(Object.values(players || {})[0] || null).slice(0, 400));
    throw new Error('Sleeper players endpoint did not return the full index.');
  }

  const idx = new Map();
  let noPos = 0, noTeam = 0;
  for (const [id, p] of Object.entries(players)) {
    if (!p?.position || !POS.includes(p.position)) { noPos++; continue; }
    if (!p.team) { noTeam++; continue; }
    idx.set(id, { pos: p.position, team: norm(p.team) });
  }
  console.log(`  ${idx.size} skill players (${noPos} other/none, ${noTeam} free agents)`);

  if (!idx.size) {
    console.error('Sample entry:', JSON.stringify(Object.values(players)[0]).slice(0, 400));
    throw new Error('No rostered skill players found — player shape unexpected.');
  }

  const acc = {};
  const games = {};
  const bump = (team, pos, pts, recent) => {
    acc[team] ??= {};
    acc[team][pos] ??= { total: 0, l3: 0 };
    acc[team][pos].total += pts;
    if (recent) acc[team][pos].l3 += pts;
  };

  console.log('Fetching schedule…');
  const schedule = await loadSchedule(season, through);

  for (let w = 1; w <= through; w++) {
    const recent = w > through - L3;
    const sched = schedule[w] || {};
    const stats = await j(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${w}`)
      .catch((e) => {
        console.warn(`  week ${w} stats unavailable: ${e.message.split('\n')[0]}`);
        return {};
      });

    for (const team of Object.keys(sched)) {
      games[team] ??= { all: 0, l3: 0 };
      games[team].all++;
      if (recent) games[team].l3++;
    }

    let counted = 0, noOpp = 0;
    for (const [pid, st] of Object.entries(stats)) {
      const meta = idx.get(pid);
      if (!meta || st?.pts_ppr == null) continue;
      const opp = sched[meta.team];
      if (!opp) { noOpp++; continue; }
      bump(opp, meta.pos, Number(st.pts_ppr), recent);
      counted++;
    }
    console.log(`  week ${w}: ${counted} performances` +
      (noOpp ? ` (${noOpp} skipped, no opponent)` : '') +
      ` across ${Object.keys(sched).length / 2} games`);
  }

  const defense = {};
  for (const [team, byPos] of Object.entries(acc)) {
    const g = games[team] || { all: 0, l3: 0 };
    defense[team] = {};
    for (const pos of POS) {
      const a = byPos[pos];
      if (!a) continue;
      defense[team][pos] = {
        ppg:    g.all ? +(a.total / g.all).toFixed(2) : null,
        l3_ppg: g.l3  ? +(a.l3   / g.l3 ).toFixed(2) : null
      };
    }
  }

  /* rank 1 = allows the most */
  for (const pos of POS) {
    for (const [key, rankKey] of [['ppg', 'rank'], ['l3_ppg', 'l3_rank']]) {
      Object.entries(defense)
        .filter(([, d]) => d[pos]?.[key] != null)
        .sort((x, y) => y[1][pos][key] - x[1][pos][key])
        .forEach(([, d], i) => { d[pos][rankKey] = i + 1; });
    }
  }

  if (!Object.keys(defense).length) {
    throw new Error('No performances found — refusing to write an empty file.');
  }

  await mkdir('data', { recursive: true });
  await writeFile(OUT, JSON.stringify({
    season, through_week: through, last_n: L3,
    updated: new Date().toISOString(), defense
  }, null, 2) + '\n');

  console.log(`Wrote ${OUT} — ${Object.keys(defense).length} defenses`);
  const sample = defense.WAS?.QB || defense.CHI?.QB;
  if (sample) console.log('  sample (WAS/CHI QB):', JSON.stringify(sample));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
