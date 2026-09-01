/* bets-board.js — FantasyNow+ bet card, stream display
   Reads bt_target / bt_board / bt_leaderboard / bt_house.
   Self-contained: own sbCfg() copy, resolved as the first line of start(). */
(function () {
  'use strict';

  var CFG = null;
  var STATE = { season: null, week: null, tab: 'card', bets: [], board: [], house: null };
  var POLL_MS = 20000;
  var timer = null;

  /* ---------- config + fetch ---------- */

  function sbCfg() {
    var url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : window.SUPABASE_URL;
    var key = (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : window.SUPABASE_ANON_KEY;
    return (url && key) ? { url: url, key: key } : null;
  }

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms || 12000); })
    ]);
  }

  function rpc(fn, body) {
    return withTimeout(fetch(CFG.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.key, Authorization: 'Bearer ' + CFG.key },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      if (!r.ok) throw new Error(fn + ' ' + r.status);
      return r.json();
    }));
  }

  /* ---------- format ---------- */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function oddsTxt(n) { return n > 0 ? '+' + n : String(n); }
  function units(n) { return (Number(n) || 0).toFixed(2).replace(/\.00$/, '').replace(/0$/, ''); }
  function signed(n, dp) {
    var v = Number(n) || 0;
    return (v > 0 ? '+' : '') + v.toFixed(dp === undefined ? 2 : dp);
  }
  function cls(n) { return Number(n) > 0 ? 'up' : Number(n) < 0 ? 'down' : ''; }
  function weekLabel(w) {
    var pl = { 19: 'Wild Card', 20: 'Divisional', 21: 'Conference', 22: 'Super Bowl' };
    return pl[w] || ('Week ' + w);
  }
  function dayTxt(d) {
    if (!d) return '';
    var p = String(d).split('-');
    return p[1].replace(/^0/, '') + '/' + p[2].replace(/^0/, '');
  }

  /* ---------- render ---------- */

  function render() {
    var stage = document.getElementById('stage');
    var sub = document.getElementById('subtitle');

    if (STATE.tab === 'board') {
      sub.textContent = STATE.season + ' season leaderboard';
      stage.innerHTML = boardHtml();
      return;
    }

    var scope = STATE.tab === 'season'
      ? STATE.season + ' season'
      : weekLabel(STATE.week) + ' \u2022 ' + STATE.season;
    sub.textContent = scope + ' bet card';
    stage.innerHTML = stripHtml() + betsHtml();
  }

  function stripHtml() {
    var h = STATE.house || {};
    var rec = (h.wins || 0) + '-' + (h.losses || 0) + (h.pushes ? '-' + h.pushes : '');
    return '<div class="strip">' +
      card('Units', '<span class="' + cls(h.units_net) + '">' + signed(h.units_net) + '</span>',
           units(h.units_risked) + 'u risked') +
      card('ROI', '<span class="' + cls(h.roi) + '">' + (h.roi == null ? '—' : signed(h.roi, 1) + '%') + '</span>',
           'return on risk') +
      card('Record', rec, (h.win_pct == null ? '—' : h.win_pct + '%') + ' win rate') +
      card('Open', String(h.pending || 0), (h.bettors || 0) + ' analysts') +
      '</div>';
  }

  function card(l, v, s) {
    return '<div class="scard"><div class="l">' + l + '</div><div class="v">' + v +
           '</div><div class="s">' + esc(s) + '</div></div>';
  }

  function betsHtml() {
    if (!STATE.bets.length) return '<div class="state">No bets on the card yet.</div>';

    // open bets first, then most recent
    var rows = STATE.bets.slice().sort(function (a, b) {
      if ((a.result === 'pending') !== (b.result === 'pending')) return a.result === 'pending' ? -1 : 1;
      return String(b.placed_on).localeCompare(String(a.placed_on));
    });

    return '<div class="bets">' + rows.map(function (b) {
      var net = b.result === 'pending' ? '' :
        '<div class="net ' + cls(b.net) + '">' + signed(b.net) + 'u</div>';
      return '<div class="bet ' + b.result + '">' +
        '<div>' +
          '<div class="who">' + esc(b.bettor_name) + '</div>' +
          '<div class="desc">' + esc(b.description) + '</div>' +
          '<div class="sub">' +
            (b.matchup ? '<span>' + esc(b.matchup) + '</span><span class="dot"></span>' : '') +
            '<span><b>' + units(b.units) + 'u</b></span>' +
            (b.sportsbook ? '<span class="dot"></span><span>' + esc(b.sportsbook) + '</span>' : '') +
            '<span class="dot"></span><span>' + dayTxt(b.placed_on) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="right">' +
          '<div class="odds">' + oddsTxt(b.odds) + '</div>' + net +
          '<div class="tag ' + b.result + '">' + b.result + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function boardHtml() {
    if (!STATE.board.length) return '<div class="state">No graded bets yet this season.</div>';
    return '<table class="lb"><thead><tr>' +
      '<th></th><th>Analyst</th><th class="r">Record</th><th class="r">Win %</th>' +
      '<th class="r">Risked</th><th class="r">Units</th><th class="r">ROI</th>' +
      '</tr></thead><tbody>' +
      STATE.board.map(function (r, i) {
        return '<tr>' +
          '<td class="rank">' + (i + 1) + '</td>' +
          '<td class="nm">' + esc(r.name) + '</td>' +
          '<td class="r">' + r.wins + '-' + r.losses + (r.pushes ? '-' + r.pushes : '') + '</td>' +
          '<td class="r">' + (r.win_pct == null ? '—' : r.win_pct + '%') + '</td>' +
          '<td class="r">' + units(r.units_risked) + 'u</td>' +
          '<td class="r big ' + cls(r.units_net) + '">' + signed(r.units_net) + '</td>' +
          '<td class="r ' + cls(r.roi) + '">' + (r.roi == null ? '—' : signed(r.roi, 1) + '%') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- data ---------- */

  async function load() {
    var wk = STATE.tab === 'season' ? null : STATE.week;
    try {
      var res = await Promise.all([
        rpc('bt_board', { p_season: STATE.season, p_week: wk }),
        rpc('bt_house', { p_season: STATE.season, p_week: wk }),
        rpc('bt_leaderboard', { p_season: STATE.season, p_week: null })
      ]);
      STATE.bets = res[0] || [];
      STATE.house = (res[1] || [])[0] || {};
      STATE.board = res[2] || [];
      document.getElementById('updated').textContent =
        'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      render();
    } catch (e) {
      document.getElementById('stage').innerHTML =
        '<div class="state">Couldn\'t load the bet card. ' + esc(e.message || e) + '</div>';
    }
  }

  function poll() {
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) load(); }, POLL_MS);
  }

  /* ---------- boot ---------- */

  async function start() {
    CFG = sbCfg();
    if (!CFG) {
      document.getElementById('stage').innerHTML =
        '<div class="state">Supabase config not loaded.</div>';
      return;
    }

    var q = new URLSearchParams(location.search);
    var t = [];
    try { t = await rpc('bt_target', {}); } catch (e) { t = []; }
    var tgt = t[0] || {};
    STATE.season = Number(q.get('season')) || tgt.season || new Date().getFullYear();
    STATE.week = Number(q.get('week')) || tgt.week || 1;
    if (q.get('tab')) STATE.tab = q.get('tab');

    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      STATE.tab = b.dataset.tab;
      [].forEach.call(this.querySelectorAll('button'), function (x) {
        x.classList.toggle('on', x === b);
      });
      load();
    });
    document.getElementById('refresh').onclick = load;

    document.addEventListener('keydown', function (e) {
      var map = { '1': 'card', '2': 'season', '3': 'board' };
      if (map[e.key]) document.querySelector('[data-tab="' + map[e.key] + '"]').click();
    });

    await load();
    poll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
