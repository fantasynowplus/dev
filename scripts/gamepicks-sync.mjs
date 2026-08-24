const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ODDS_KEY = process.env.ODDS_API_KEY;
const FORCE_DISPLAY = process.env.FORCE_DISPLAY === '1';

if (!SB_URL || !SB_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const GAMES_CSV =
  'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const ODDS_URL =
  'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds';
// Postseason rounds already carry weeks 19-22 in games.csv.
const KEEP_TYPES = new Set(['REG', 'WC', 'DIV', 'CON', 'SB']);

const BOOKS = ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us'];

// ------------------------------------------------------------- team codes

const ALIAS = {
  LA: 'LAR', STL: 'LAR', OAK: 'LV', SD: 'LAC', WSH: 'WAS', ARZ: 'ARI',
  BLT: 'BAL', CLV: 'CLE', HST: 'HOU', JAC: 'JAX',
};

const NAME_TO_ABBR = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE',
  'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

const norm = (t) => {
  if (!t) return null;
  const up = String(t).trim().toUpperCase();
  return ALIAS[up] || up;
};

function weekLabel(w) {
  if (w === 19) return 'Wild Card';
  if (w === 20) return 'Divisional';
  if (w === 21) return 'Conference';
  if (w === 22) return 'Super Bowl';
  return 'Week ' + w;
}

// ------------------------------------------------------------- utilities

// Some hosts reject default datacenter user-agents, so outbound requests
// carry a browser-ish UA.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${body.slice(0, 400)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function sb(path, opts = {}) {
  return getJson(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

const sbGet = (path) => sb(path, { headers: { Accept: 'application/json' } });

const sbPost = (path, body, prefer) =>
  sb(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Prefer: prefer || 'return=representation' },
  });

const sbPatch = (path, body) =>
  sb(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { Prefer: 'return=representation' },
  });

function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function tzOffsetMs(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).map((x) => [x.type, x.value])
  );
  const asUTC = Date.UTC(
    +p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second
  );
  return asUTC - date.getTime();
}

function etToUtc(day, time) {
  if (!day) return null;
  const [Y, M, D] = day.split('-').map(Number);
  const [h, m] = (time && time.includes(':') ? time : '13:00')
    .split(':').map(Number);
  const naive = Date.UTC(Y, M - 1, D, h, m);
  let ms = naive;
  for (let i = 0; i < 2; i++) {
    ms = naive - tzOffsetMs('America/New_York', new Date(ms));
  }
  return new Date(ms).toISOString();
}

// ---------------------------------------------- nflverse (regular + playoffs)

async function loadNflverse(season) {
  const res = await fetch(GAMES_CSV);
  if (!res.ok) throw new Error(`nflverse games.csv ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  const head = splitCsv(lines[0]).map((h) => h.trim());
  const idx = (name) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`games.csv missing column "${name}"`);
    return i;
  };
  const C = {
    season: idx('season'), type: idx('game_type'), week: idx('week'),
    day: idx('gameday'), time: idx('gametime'),
    away: idx('away_team'), home: idx('home_team'),
    ascore: idx('away_score'), hscore: idx('home_score'),
  };

  const games = [];
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsv(lines[i]);
    if (+f[C.season] !== season) continue;
    if (!KEEP_TYPES.has(f[C.type])) continue;
    games.push({
      week: +f[C.week],
      away: norm(f[C.away]),
      home: norm(f[C.home]),
      kickoff: etToUtc(f[C.day], f[C.time]),
      away_score: f[C.ascore] === '' ? null : +f[C.ascore],
      home_score: f[C.hscore] === '' ? null : +f[C.hscore],
    });
  }
  return games;
}

async function loadSchedule(season) {
  const all = await loadNflverse(season);
  if (!all.length) throw new Error(`no games found for ${season}`);
  console.log(`Schedule: ${all.length} regular/playoff games`);
  return all;
}

// -------------------------------------------------------------- odds

function bestBook(bookmakers) {
  for (const key of BOOKS) {
    const b = bookmakers.find((x) => x.key === key);
    if (b) return b;
  }
  return bookmakers[0] || null;
}

async function loadOdds(weekEndIso) {
  if (!ODDS_KEY) {
    console.warn('No ODDS_API_KEY — skipping line freeze this run.');
    return new Map();
  }
  const qs = new URLSearchParams({
    apiKey: ODDS_KEY,
    regions: 'us',
    markets: 'h2h,spreads,totals',
    oddsFormat: 'american',
    commenceTimeTo: weekEndIso.replace(/\.\d{3}Z$/, 'Z'),
  });
  const events = await getJson(`${ODDS_URL}?${qs}`);
  const map = new Map();

  for (const ev of events || []) {
    const home = NAME_TO_ABBR[ev.home_team];
    const away = NAME_TO_ABBR[ev.away_team];
    if (!home || !away) {
      console.warn(`Unmapped team name: ${ev.away_team} @ ${ev.home_team}`);
      continue;
    }
    const book = bestBook(ev.bookmakers || []);
    if (!book) continue;

    const out = {
      spread_home: null, total: null, ml_home: null, ml_away: null,
      book: book.key,
    };
    for (const m of book.markets || []) {
      if (m.key === 'h2h') {
        for (const o of m.outcomes) {
          if (o.name === ev.home_team) out.ml_home = o.price;
          if (o.name === ev.away_team) out.ml_away = o.price;
        }
      } else if (m.key === 'spreads') {
        const h = m.outcomes.find((o) => o.name === ev.home_team);
        if (h) out.spread_home = h.point;
      } else if (m.key === 'totals') {
        const o = m.outcomes.find((x) => x.name === 'Over');
        if (o) out.total = o.point;
      }
    }
    map.set(`${away}@${home}`, out);
  }
  return map;
}

// -------------------------------------------------------------- week helpers

async function ensureWeek(season, week) {
  const found = await sbGet(
    `gp_weeks?season=eq.${season}&week=eq.${week}&select=*`
  );
  if (found.length) return found[0];
  await sbPost('gp_weeks', [{ season, week }],
    'resolution=ignore-duplicates,return=minimal');
  const again = await sbGet(
    `gp_weeks?season=eq.${season}&week=eq.${week}&select=*`
  );
  return again[0];
}

async function seedGames(weekRow, schedule) {
  const rows = schedule
    .filter((g) => g.week === weekRow.week && g.kickoff && g.away && g.home)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .map((g, i) => ({
      week_id: weekRow.id,
      game_key: `${weekRow.season}_${weekRow.week}_${g.away}_${g.home}`,
      away_team: g.away,
      home_team: g.home,
      kickoff: g.kickoff,
      sort_order: i,
    }));
  if (!rows.length) return [];
  await sbPost(
    'gp_games?on_conflict=week_id,away_team,home_team',
    rows,
    'resolution=merge-duplicates,return=minimal'
  );
  return sbGet(`gp_games?week_id=eq.${weekRow.id}&select=*`);
}

async function freezeLines(games, odds) {
  let frozen = 0;
  for (const g of games) {
    if (g.line_taken) continue;
    const o = odds.get(`${g.away_team}@${g.home_team}`);
    if (!o) continue;
    if (o.spread_home == null && o.total == null && o.ml_home == null) continue;
    await sbPatch(`gp_games?id=eq.${g.id}`, {
      spread_home: o.spread_home,
      total: o.total,
      ml_home: o.ml_home,
      ml_away: o.ml_away,
      line_taken: new Date().toISOString(),
    });
    frozen++;
  }
  return frozen;
}

// ------------------------------------------------------------- score writeback

async function writeScores(season, schedule) {
  const byKey = new Map();
  for (const g of schedule) {
    if (g.home_score == null || g.away_score == null) continue;
    byKey.set(`${g.week}_${g.away}_${g.home}`, g);
  }

  const weeks = await sbGet(
    `gp_weeks?season=eq.${season}&status=neq.scored&select=*`
  );
  let updated = 0;

  for (const w of weeks) {
    const games = await sbGet(`gp_games?week_id=eq.${w.id}&select=*`);
    if (!games.length) continue;

    for (const g of games) {
      const fin = byKey.get(`${w.week}_${g.away_team}_${g.home_team}`);
      if (!fin) continue;
      if (g.home_score === fin.home_score && g.away_score === fin.away_score) continue;
      await sbPatch(`gp_games?id=eq.${g.id}`, {
        home_score: fin.home_score,
        away_score: fin.away_score,
      });
      updated++;
    }

    const done = games.every((g) =>
      byKey.has(`${w.week}_${g.away_team}_${g.home_team}`)
    );
    if (done && w.status !== 'scored') {
      await sbPatch(`gp_weeks?id=eq.${w.id}`, { status: 'scored' });
      console.log(`${weekLabel(w.week)} complete -> scored`);
    }
  }
  return updated;
}

// ------------------------------------------------------------- display week

async function advanceDisplay(weekRow, games) {
  const withLines = games.filter((g) => g.line_taken).length;
  const enough = games.length && withLines >= Math.ceil(games.length / 2);
  const isWednesdayOrLater = new Date().getUTCDay() >= 3;

  if (!FORCE_DISPLAY && !(enough && isWednesdayOrLater)) {
    console.log(
      `Display week held: ${withLines}/${games.length} lines, ` +
      `UTC day ${new Date().getUTCDay()}`
    );
    return false;
  }

  const current = await sbGet('gp_weeks?is_display=eq.true&select=*');
  const cur = current[0];
  if (!FORCE_DISPLAY && cur && cur.season === weekRow.season
      && cur.week > weekRow.week) {
    console.log(`Display week manually set ahead (${weekLabel(cur.week)}) — leaving it.`);
    return false;
  }
  if (cur && cur.id === weekRow.id) return false;

  if (cur) await sbPatch(`gp_weeks?id=eq.${cur.id}`, { is_display: false });
  await sbPatch(`gp_weeks?id=eq.${weekRow.id}`, { is_display: true });
  console.log(`Display week -> ${weekRow.season} ${weekLabel(weekRow.week)}`);
  return true;
}

// -------------------------------------------------------------------- main

async function main() {
  const now = new Date();
  const season = process.env.SEASON
    ? +process.env.SEASON
    : (now.getUTCMonth() + 1 >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);

  console.log(`Season ${season}, now ${now.toISOString()}`);
  const schedule = await loadSchedule(season);

  const upcoming = schedule
    .filter((g) => g.kickoff && new Date(g.kickoff) > now)
    .sort((a, b) => a.week - b.week || a.kickoff.localeCompare(b.kickoff));

  if (!upcoming.length) {
    console.log('No upcoming games — writing scores only.');
    const n = await writeScores(season, schedule);
    console.log(`Scores updated: ${n}`);
    return;
  }

  const targetWeek = upcoming[0].week;
  console.log(`Target: ${weekLabel(targetWeek)} (week ${targetWeek})`);

  const weekRow = await ensureWeek(season, targetWeek);
  const games = await seedGames(weekRow, schedule);
  console.log(`${weekLabel(targetWeek)}: ${games.length} games seeded`);

  const weekGames = schedule.filter((g) => g.week === targetWeek && g.kickoff);
  const lastKick = weekGames.map((g) => g.kickoff).sort().slice(-1)[0];
  const weekEnd = new Date(new Date(lastKick).getTime() + 6 * 3600 * 1000)
    .toISOString();

  const odds = await loadOdds(weekEnd);
  const frozen = await freezeLines(games, odds);
  console.log(`Lines frozen this run: ${frozen}`);

  const fresh = await sbGet(`gp_games?week_id=eq.${weekRow.id}&select=*`);
  await advanceDisplay(weekRow, fresh);

  const n = await writeScores(season, schedule);
  console.log(`Scores updated: ${n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
