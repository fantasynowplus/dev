const GP = {
  season: null,
  week: null,
  weekRow: null,
  weeks: [],
  games: [],
  staff: [],
  picks: {},
  who: null,
  tab: 'games',
  standWeek: '',
  busy: {},
};


function gpMyProfileId() {
  if (typeof ME !== 'undefined' && ME && ME.id) return ME.id;
  return (typeof auth !== 'undefined' && auth.user && auth.user.sub) || null;
}

const gpCan = (a) => (typeof can === 'function' ? can('gamepicks', a) : true);

async function gpRpc(fn, args) {
  const cfg = sbCfg();
  const tok = localStorage.getItem('sb-auth-token');
  const res = await fetch(cfg.url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + (tok || cfg.key),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  if (!res.ok) throw new Error(fn + ' ' + res.status + ' ' + (await res.text()));
  return res.json();
}

async function gpUpsertPick(row) {
  const cfg = sbCfg();
  const tok = localStorage.getItem('sb-auth-token');
  const res = await fetch(
    cfg.url + '/rest/v1/gp_picks?on_conflict=game_id,profile_id',
    {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + (tok || cfg.key),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([row]),
    }
  );
  if (!res.ok) throw new Error('pick save ' + res.status + ' ' + (await res.text()));
  return res.json();
}

// ------------------------------------------------------------- formatting

const gpEsc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function gpKick(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function gpFallbackLabel(w) {
  if (w === -4) return 'Hall of Fame';
  if (w < 0) return 'Preseason ' + (w + 4);
  if (w === 19) return 'Wild Card';
  if (w === 20) return 'Divisional';
  if (w === 21) return 'Conference';
  if (w === 22) return 'Super Bowl';
  return 'Week ' + w;
}

const gpNum = (n) => (n == null || n === '' ? '' : Number(n));
const gpSigned = (n) => (n == null ? '—' : (n > 0 ? '+' + n : String(n)));
const gpLocked = (g) => !GP.weekRow || GP.weekRow.status !== 'open' || new Date(g.kickoff) <= new Date();

function gpSpreadLabel(g, side) {
  if (g.spread_home == null) return '';
  const v = side === 'home' ? g.spread_home : -g.spread_home;
  return gpSigned(v);
}

// ------------------------------------------------------------- data

async function loadGamePicks() {
  document.getElementById('content').innerHTML =
    '<div class="panel"><div id="gp-root"></div></div>';
  const host = document.getElementById('gp-root');
  host.innerHTML = '<div class="gp-pad">Loading game picks…</div>';

  try {
    if (GP.season == null) {
      let target = [];
      try { target = await gpRpc('gp_display_target', {}); } catch (e) {}
      const now = new Date();
      GP.season = target[0] ? target[0].season
        : (now.getMonth() + 1 >= 3 ? now.getFullYear() : now.getFullYear() - 1);
      GP.week = target[0] ? target[0].week : 1;
    }
    if (!GP.staff.length) {
      GP.staff = await dbGet('staff?select=id,name,profile_id,headshot&order=name');
    }
    await gpLoadWeek();
    gpRender();
  } catch (err) {
    host.innerHTML = '<div class="gp-pad gp-err">Could not load game picks: '
      + gpEsc(err.message) + '</div>';
  }
}

async function gpLoadWeek() {
  GP.weeks = await gpRpc('gp_weeks_public', { p_season: GP.season });

  const rows = await dbGet(
    `gp_weeks?season=eq.${GP.season}&week=eq.${GP.week}&select=*`
  );
  GP.weekRow = rows[0] || null;
  GP.games = [];
  GP.picks = {};
  if (!GP.weekRow) return;

  GP.games = await dbGet(
    `gp_games?week_id=eq.${GP.weekRow.id}&select=*&order=kickoff,sort_order`
  );

  const who = GP.who || gpMyProfileId();
  if (who && GP.games.length) {
    const ids = GP.games.map((g) => g.id).join(',');
    const picks = await dbGet(
      `gp_picks?game_id=in.(${ids})&profile_id=eq.${who}&select=*`
    );
    picks.forEach((p) => { GP.picks[p.game_id] = p; });
  }
}

// ------------------------------------------------------------- render

function gpRender() {
  const host = document.getElementById('gp-root');
  if (!host) return;

  const tabs = [
    { k: 'games', label: 'Games & lines', need: 'u' },
    { k: 'picks', label: 'Picks', need: 'r' },
    { k: 'standings', label: 'Standings', need: 'r' },
  ].filter((t) => gpCan(t.need));

  if (!tabs.some((t) => t.k === GP.tab)) GP.tab = tabs.length ? tabs[0].k : null;
  if (!GP.tab) {
    host.innerHTML = '<div class="gp-pad">You do not have access to game picks.</div>';
    return;
  }

  const weekOpts = GP.weeks.length
    ? GP.weeks.map((w) =>
        `<option value="${w.week}"${w.week === GP.week ? ' selected' : ''}>${gpEsc(w.label || gpFallbackLabel(w.week))}${w.is_display ? ' • on site' : ''}</option>`
      ).join('')
    : `<option value="${GP.week}" selected>${gpEsc(gpFallbackLabel(GP.week))}</option>`;

  host.innerHTML = `
    <div class="gp-bar">
      <label>Season
        <input id="gp-season" class="gp-in gp-in-sm" value="${GP.season}">
      </label>
      <label>Week
        <select id="gp-week" class="gp-in gp-in-sm">${weekOpts}</select>
      </label>
      ${gpStatusHtml()}
      <span class="gp-spacer"></span>
      <div class="gp-tabs">
        ${tabs.map((t) =>
          `<button class="gp-tab${GP.tab === t.k ? ' on' : ''}" data-tab="${t.k}">${t.label}</button>`
        ).join('')}
      </div>
    </div>
    <div id="gp-body"></div>
  `;

  document.getElementById('gp-season').addEventListener('change', async (e) => {
    const v = parseInt(e.target.value, 10);
    if (!v) return;
    GP.season = v;
    await gpLoadWeek();
    gpRender();
  });
  document.getElementById('gp-week').addEventListener('change', async (e) => {
    GP.week = parseInt(e.target.value, 10);
    await gpLoadWeek();
    gpRender();
  });
  host.querySelectorAll('.gp-tab').forEach((b) =>
    b.addEventListener('click', () => { GP.tab = b.dataset.tab; gpRender(); })
  );
  gpWireStatus();
  gpRenderTab();
}

function gpStatusHtml() {
  if (!GP.weekRow) return '<span class="gp-chip gp-muted">No week row yet</span>';
  const s = GP.weekRow.status;
  const canEdit = gpCan('u');
  return `
    <button class="gp-chip gp-status gp-${s}"${canEdit ? '' : ' disabled'} id="gp-status">${s}</button>
    <button class="gp-chip${GP.weekRow.is_display ? ' on' : ''}"${canEdit ? '' : ' disabled'} id="gp-display">
      ${GP.weekRow.is_display ? 'On site' : 'Show on site'}
    </button>`;
}

function gpWireStatus() {
  const st = document.getElementById('gp-status');
  if (st) st.addEventListener('click', async () => {
    const order = ['open', 'locked', 'scored'];
    const next = order[(order.indexOf(GP.weekRow.status) + 1) % order.length];
    await dbPatch(`gp_weeks?id=eq.${GP.weekRow.id}`, { status: next });
    GP.weekRow.status = next;
    gpRender();
  });

  const dp = document.getElementById('gp-display');
  if (dp) dp.addEventListener('click', async () => {
    if (GP.weekRow.is_display) return;
    await gpRpc('gp_set_display_week', { p_week_id: GP.weekRow.id });
    await gpLoadWeek();
    gpRender();
  });
}

function gpRenderTab() {
  if (GP.tab === 'games') return gpRenderGames();
  if (GP.tab === 'picks') return gpRenderPicks();
  if (GP.tab === 'standings') return gpRenderStandings();
}

// --------------------------------------------------------- games & lines

function gpRenderGames() {
  const body = document.getElementById('gp-body');
  if (!GP.weekRow) {
    body.innerHTML = `<div class="gp-pad">No week ${GP.week} yet. The sync creates it — or run the workflow manually.</div>`;
    return;
  }
  if (!GP.games.length) {
    body.innerHTML = '<div class="gp-pad">No games seeded for this week yet.</div>';
    return;
  }

  const rows = GP.games.map((g) => `
    <tr data-id="${g.id}">
      <td class="gp-kick">${gpEsc(gpKick(g.kickoff))}</td>
      <td class="gp-match"><b>${gpEsc(g.away_team)}</b> @ <b>${gpEsc(g.home_team)}</b></td>
      <td><input class="gp-in gp-in-xs" data-f="spread_home" value="${gpNum(g.spread_home)}"></td>
      <td><input class="gp-in gp-in-xs" data-f="total" value="${gpNum(g.total)}"></td>
      <td><input class="gp-in gp-in-xs" data-f="ml_away" value="${gpNum(g.ml_away)}"></td>
      <td><input class="gp-in gp-in-xs" data-f="ml_home" value="${gpNum(g.ml_home)}"></td>
      <td><input class="gp-in gp-in-xs" data-f="away_score" value="${gpNum(g.away_score)}"></td>
      <td><input class="gp-in gp-in-xs" data-f="home_score" value="${gpNum(g.home_score)}"></td>
      <td class="gp-frozen">${g.line_taken ? '<span class="gp-lock" title="Line frozen ' + gpEsc(gpKick(g.line_taken)) + '">frozen</span>' : '<span class="gp-muted">open</span>'}</td>
      <td><button class="gp-btn gp-save" data-id="${g.id}">Save</button></td>
    </tr>`).join('');

  body.innerHTML = `
    <div class="gp-card">
      <div class="gp-note">
        Spread is the <b>home</b> line. Editing a frozen line changes what
        every pick is graded against, including picks already made.
      </div>
      <table class="gp-table">
        <thead>
          <tr>
            <th>Kickoff</th><th>Matchup</th><th>Spread</th><th>Total</th>
            <th>ML away</th><th>ML home</th><th>Away</th><th>Home</th>
            <th>Line</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  body.querySelectorAll('.gp-save').forEach((b) =>
    b.addEventListener('click', () => gpSaveGame(b.dataset.id, b))
  );
}

async function gpSaveGame(id, btn) {
  const tr = btn.closest('tr');
  const patch = {};
  tr.querySelectorAll('[data-f]').forEach((inp) => {
    const v = inp.value.trim();
    patch[inp.dataset.f] = v === '' ? null : Number(v);
  });
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await dbPatch(`gp_games?id=eq.${id}`, patch);
    const g = GP.games.find((x) => String(x.id) === String(id));
    if (g) Object.assign(g, patch);
    btn.textContent = 'Saved';
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1200);
  } catch (err) {
    btn.textContent = 'Failed';
    btn.disabled = false;
    alert('Could not save: ' + err.message);
  }
}

// --------------------------------------------------------------- picks

function gpRenderPicks() {
  const body = document.getElementById('gp-body');
  if (!GP.games.length) {
    body.innerHTML = '<div class="gp-pad">No games seeded for this week yet.</div>';
    return;
  }

  const admin = gpCan('u');
  const mine = gpMyProfileId();
  const who = GP.who || mine;
  const target = GP.staff.find((s) => s.profile_id === who);
  const isSelf = who === mine;

  const picker = admin
    ? `<label>Entering for
         <select id="gp-who" class="gp-in">
           ${GP.staff.filter((s) => s.profile_id).map((s) =>
             `<option value="${s.profile_id}"${s.profile_id === who ? ' selected' : ''}>${gpEsc(s.name)}${s.profile_id === mine ? ' (me)' : ''}</option>`
           ).join('')}
         </select>
       </label>`
    : `<span class="gp-chip gp-muted">${gpEsc(target ? target.name : 'My picks')}</span>`;

  const locked = GP.weekRow && GP.weekRow.status !== 'open';

  const rows = GP.games.map((g) => {
    const p = GP.picks[g.id] || {};
    const off = gpLocked(g) && !admin;
    return `
      <div class="gp-pickrow${off ? ' off' : ''}" data-game="${g.id}">
        <div class="gp-when">
          <div>${gpEsc(gpKick(g.kickoff))}</div>
          ${gpLocked(g) ? '<span class="gp-lock">locked</span>' : ''}
        </div>
        <div class="gp-teams">
          <span class="gp-team">${gpEsc(g.away_team)}</span>
          <span class="gp-at">@</span>
          <span class="gp-team">${gpEsc(g.home_team)}</span>
        </div>
        <div class="gp-markets">
          ${gpMarket(g, p, 'ml_pick', [
            ['away', g.away_team + (g.ml_away != null ? ' ' + gpSigned(g.ml_away) : '')],
            ['home', g.home_team + (g.ml_home != null ? ' ' + gpSigned(g.ml_home) : '')],
          ], 'ML', off)}
          ${gpMarket(g, p, 'ats_pick', [
            ['away', g.away_team + ' ' + gpSpreadLabel(g, 'away')],
            ['home', g.home_team + ' ' + gpSpreadLabel(g, 'home')],
          ], 'Spread', off || g.spread_home == null)}
          ${gpMarket(g, p, 'ou_pick', [
            ['over', 'O ' + (g.total == null ? '' : g.total)],
            ['under', 'U ' + (g.total == null ? '' : g.total)],
          ], 'Total', off || g.total == null)}
        </div>
      </div>`;
  }).join('');

  const made = GP.games.filter((g) => {
    const p = GP.picks[g.id];
    return p && (p.ml_pick || p.ats_pick || p.ou_pick);
  }).length;

  body.innerHTML = `
    <div class="gp-card">
      <div class="gp-bar gp-bar-in">
        ${picker}
        <span class="gp-spacer"></span>
        <span class="gp-count">${made} of ${GP.games.length} games started</span>
      </div>
      ${locked && !admin ? '<div class="gp-note">This week is ' + gpEsc(GP.weekRow.status) + ' — picks are closed.</div>' : ''}
      ${!isSelf && admin ? '<div class="gp-note">You are entering picks on behalf of another staff member.</div>' : ''}
      <div class="gp-picklist">${rows}</div>
    </div>`;

  const sel = document.getElementById('gp-who');
  if (sel) sel.addEventListener('change', async (e) => {
    GP.who = e.target.value;
    await gpLoadWeek();
    gpRender();
  });

  body.querySelectorAll('.gp-opt').forEach((b) =>
    b.addEventListener('click', () => gpSetPick(b))
  );
}

function gpMarket(g, p, field, opts, label, disabled) {
  const cur = p[field] || null;
  return `
    <div class="gp-mkt${disabled ? ' off' : ''}">
      <span class="gp-mlabel">${label}</span>
      ${opts.map(([val, text]) =>
        `<button class="gp-opt${cur === val ? ' on' : ''}"
           data-game="${g.id}" data-field="${field}" data-val="${val}"
           ${disabled ? 'disabled' : ''}>${gpEsc(text)}</button>`
      ).join('')}
    </div>`;
}

async function gpSetPick(btn) {
  const gameId = btn.dataset.game;
  const field = btn.dataset.field;
  const val = btn.dataset.val;
  const key = gameId + ':' + field;
  if (GP.busy[key]) return;
  GP.busy[key] = true;

  const who = GP.who || gpMyProfileId();
  const prev = GP.picks[gameId] || {};
  const next = { ...prev };
  next[field] = prev[field] === val ? null : val;

  GP.picks[gameId] = next;
  const group = btn.parentElement;
  group.querySelectorAll('.gp-opt').forEach((b) =>
    b.classList.toggle('on', b.dataset.val === next[field])
  );

  try {
    const row = {
      game_id: Number(gameId),
      profile_id: who,
      ml_pick: next.ml_pick || null,
      ats_pick: next.ats_pick || null,
      ou_pick: next.ou_pick || null,
      updated_at: new Date().toISOString(),
    };
    const saved = await gpUpsertPick(row);
    if (saved && saved[0]) GP.picks[gameId] = saved[0];
  } catch (err) {
    GP.picks[gameId] = prev;
    group.querySelectorAll('.gp-opt').forEach((b) =>
      b.classList.toggle('on', b.dataset.val === (prev[field] || null))
    );
    alert('Pick did not save: ' + err.message);
  } finally {
    GP.busy[key] = false;
  }
}

// ------------------------------------------------------------ standings

async function gpRenderStandings() {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="gp-pad">Loading standings…</div>';

  try {
    const args = { p_season: GP.season };
    if (GP.standWeek) args.p_week = Number(GP.standWeek);
    const rows = await gpRpc('gp_standings', args);

    const weekOpts = ['<option value="">Full season</option>']
      .concat(GP.weeks.map((w) =>
        `<option value="${w.week}"${String(w.week) === String(GP.standWeek) ? ' selected' : ''}>${gpEsc(w.label || ('Week ' + w.week))}</option>`
      )).join('');

    const trs = rows.length
      ? rows.map((r, i) => `
        <tr class="${r.is_fan ? 'gp-fan' : ''}">
          <td class="gp-rank">${i + 1}</td>
          <td class="gp-who">${gpEsc(r.name)}${r.is_fan ? '<span class="gp-tag">crowd</span>' : ''}</td>
          <td>${r.ml_w}-${r.ml_l}${r.ml_t ? '-' + r.ml_t : ''}</td>
          <td>${r.ats_w}-${r.ats_l}${r.ats_p ? '-' + r.ats_p : ''}</td>
          <td>${r.ou_w}-${r.ou_l}${r.ou_p ? '-' + r.ou_p : ''}</td>
          <td><b>${r.tot_w}-${r.tot_l}</b></td>
          <td>${(Number(r.pct) * 100).toFixed(1)}%</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="gp-pad">Nothing graded yet.</td></tr>';

    body.innerHTML = `
      <div class="gp-card">
        <div class="gp-bar gp-bar-in">
          <label>Show
            <select id="gp-standweek" class="gp-in">${weekOpts}</select>
          </label>
          <span class="gp-spacer"></span>
          <span class="gp-count">Ranked by combined win pct across all three markets</span>
        </div>
        <table class="gp-table">
          <thead>
            <tr><th>#</th><th>Name</th><th>ML</th><th>Spread</th><th>Total</th>
                <th>Overall</th><th>Pct</th></tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>
        <div class="gp-note">
          Fan Picks is the majority pick of all non-staff accounts, one line for
          the whole crowd. Ties fall to the favorite.
        </div>
      </div>`;

    document.getElementById('gp-standweek')
      .addEventListener('change', (e) => {
        GP.standWeek = e.target.value;
        gpRenderStandings();
      });
  } catch (err) {
    body.innerHTML = '<div class="gp-pad gp-err">Could not load standings: '
      + gpEsc(err.message) + '</div>';
  }
}
