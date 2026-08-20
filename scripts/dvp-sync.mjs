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

/* team -> opponent for one week */
async function schedule(season, week) {
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
    console.warn(`  week ${week} schedule unavailable: ${e.message}`);
  }
  return map;
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

  for (let w = 1; w <= through; w++) {
    const recent = w > through - L3;
    const [sched, stats] = await Promise.all([
      schedule(season, w),
      j(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${w}`).catch((e) => {
        console.warn(`  week ${w} stats unavailable: ${e.message}`);
        return {};
      })
    ]);

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
