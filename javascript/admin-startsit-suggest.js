(function () {
  const SSG = { season: null, week: null, data: null, sel: {}, ok: false };
  const POS = ['QB', 'RB', 'WR', 'TE'];

  async function rpc(fn, body) {
    const cfg = sbCfg();
    const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${sbToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) throw new Error(`${fn}: ${r.status}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  async function ssgCan() {
    try { SSG.ok = !!(await rpc('ss_suggest_can')); }
    catch { SSG.ok = false; }
    return SSG.ok;
  }

  async function ssgLoad() {
    SSG.data = null;
    SSG.sel = {};
    const rows = await rpc('ss_suggestions_get', {
      p_season: SSG.season,
      p_week: SSG.week
    });
    SSG.data = (rows && rows[0]) || null;
  }

  function collisions() {
    const byTeam = {};
    for (const p of Object.values(SSG.sel).flat()) {
      (byTeam[p.team] ||= []).push(p.name);
    }
    return Object.entries(byTeam).filter(([, v]) => v.length > 1);
  }

  function cardHtml(p, pos, side) {
    const picked = (SSG.sel[pos] || []).some(x => x.sleeper_id === p.sleeper_id);
    const l3 = p.dvpPpgL3 != null
      ? `<span class="ssg-l3">L3 ${p.dvpPpgL3.toFixed(1)}</span>` : '';
    return `
      <button class="ssg-card ${side} ${picked ? 'on' : ''}"
              data-pos="${pos}" data-id="${p.sleeper_id}">
        <span class="ssg-rk">${pos}${p.rank}</span>
        <span class="ssg-nm">${p.name}</span>
        <span class="ssg-mt">${p.home ? 'vs' : '@'} ${p.opp}</span>
        <span class="ssg-dv">${p.dvpPpg.toFixed(1)} FPA &middot; ${p.dvpRank}${ord(p.dvpRank)} most ${l3}</span>
      </button>`;
  }

  const ord = n => (n % 10 === 1 && n !== 11) ? 'st'
    : (n % 10 === 2 && n !== 12) ? 'nd'
    : (n % 10 === 3 && n !== 13) ? 'rd' : 'th';

  function ssgRender() {
    const el = document.getElementById('ss-body');
    if (!SSG.ok) {
      el.innerHTML = `<div class="ss-pad">Not available for your account.</div>`;
      return;
    }

    const weeks = Array.from({ length: 18 }, (_, i) =>
      `<option value="${i + 1}" ${SSG.week === i + 1 ? 'selected' : ''}>Week ${i + 1}</option>`
    ).join('');

    const bar = `
      <div class="ss-bar">
        <input id="ssg-season" type="text" value="${SSG.season}" size="5">
        <select id="ssg-week">${weeks}</select>
        <button id="ssg-reload" class="btn">Load</button>
        <span class="ss-note">${SSG.data
          ? `Generated ${new Date(SSG.data.generated_at).toLocaleString()} &middot; ${SSG.data.source}`
          : ''}</span>
      </div>`;

    if (!SSG.data) {
      el.innerHTML = bar + `<div class="ss-pad">
        No snapshot for ${SSG.season} week ${SSG.week}.
        Run the <strong>Start/Sit suggestions</strong> workflow with week ${SSG.week}
        to build one.</div>`;
      wire();
      return;
    }

    const cols = collisions();
    const warn = cols.length
      ? `<div class="ssg-warn">Same team selected twice: ${
          cols.map(([t, v]) => `${t} (${v.join(', ')})`).join('; ')}</div>`
      : '';

    const body = POS.map(pos => {
      const g = SSG.data.payload.positions[pos] || { tough: [], soft: [] };
      const sel = SSG.sel[pos] || [];
      const btn = sel.length === 2
        ? `<button class="btn ssg-make" data-pos="${pos}">Create ${pos} matchup</button>`
        : `<span class="ss-note">Pick two</span>`;
      return `
        <div class="ss-card ssg-pos">
          <div class="ss-bar"><strong>${pos}</strong>${btn}</div>
          <div class="ssg-grid">
            <div><div class="ssg-hd">Higher rank &middot; tough defense</div>
              ${g.tough.map(p => cardHtml(p, pos, 'tough')).join('')}</div>
            <div><div class="ssg-hd">Lower rank &middot; soft defense</div>
              ${g.soft.map(p => cardHtml(p, pos, 'soft')).join('')}</div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = bar + warn + body;
    wire();
  }

  function findPlayer(pos, id) {
    const g = SSG.data.payload.positions[pos];
    return [...g.tough, ...g.soft].find(p => p.sleeper_id === id);
  }

  function wire() {
    const q = s => document.querySelectorAll(s);

    document.getElementById('ssg-reload')?.addEventListener('click', async () => {
      SSG.season = Number(document.getElementById('ssg-season').value) || SSG.season;
      SSG.week = Number(document.getElementById('ssg-week').value);
      await ssgLoad();
      ssgRender();
    });

    q('.ssg-card').forEach(b => b.addEventListener('click', () => {
      const pos = b.dataset.pos;
      const p = findPlayer(pos, b.dataset.id);
      const cur = SSG.sel[pos] || [];
      const at = cur.findIndex(x => x.sleeper_id === p.sleeper_id);
      if (at >= 0) cur.splice(at, 1);
      else if (cur.length < 2) cur.push(p);
      SSG.sel[pos] = cur;
      ssgRender();
    }));

    q('.ssg-make').forEach(b => b.addEventListener('click', () => ssgCreate(b.dataset.pos)));
  }

  async function ssgCreate(pos) {
    const [a, b] = SSG.sel[pos];
    const wk = await dbGet(
      `ss_weeks?season=eq.${SSG.season}&week=eq.${SSG.week}&select=id`
    );
    if (!wk || !wk.length) {
      alert(`Open ${SSG.season} week ${SSG.week} in the Matchups tab first.`);
      return;
    }
    const opp = p => `${p.home ? 'vs' : '@'} ${p.opp}`;
    await dbPost('ss_matchups', {
      week_id: wk[0].id, pos,
      a_player_id: a.sleeper_id, a_name: a.name, a_team: a.team,
      a_opp: opp(a), a_espn_id: a.espn_id,
      b_player_id: b.sleeper_id, b_name: b.name, b_team: b.team,
      b_opp: opp(b), b_espn_id: b.espn_id
    });
    SSG.sel[pos] = [];
    alert(`${pos} matchup created.`);
    ssgRender();
  }

  window.ssgInit = async function () {
    SSG.season = SSG.season || SS.season;
    SSG.week = SSG.week || SS.week;
    await ssgCan();
    if (SSG.ok) await ssgLoad();
    ssgRender();
  };
  window.ssgCan = ssgCan;
})();