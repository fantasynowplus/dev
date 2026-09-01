/* bets.js — public NFL bet tracker (tools page)
   Reads bt_target / bt_board / bt_leaderboard / bt_house / bt_daily. */
(function () {
  'use strict';

  var CFG = null;
  var S = { season: null, week: null, tab: 'board', bets: [], board: [], house: null, daily: [] };

  function sbCfg() {
    var url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : window.SUPABASE_URL;
    var key = (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : window.SUPABASE_ANON_KEY;
    return (url && key) ? { url: url, key: key } : null;
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('timeout')); }, ms || 12000);
    })]);
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

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function oddsTxt(n) { return n > 0 ? '+' + n : String(n); }
  function units(n) { return (Number(n) || 0).toFixed(2).replace(/\.00$/, ''); }
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

  function strip() {
    var h = S.house || {};
    var el = document.getElementById('btxStrip');
    function c(l, v, s) {
      return '<div class="btx-card"><div class="l">' + l + '</div><div class="v">' + v +
             '</div><div class="s">' + esc(s) + '</div></div>';
    }
    el.innerHTML =
      c('Units', '<span class="' + cls(h.units_net) + '">' + signed(h.units_net) + '</span>',
        units(h.units_risked) + 'u risked') +
      c('ROI', '<span class="' + cls(h.roi) + '">' + (h.roi == null ? '—' : signed(h.roi, 1) + '%') + '</span>',
        'return on risk') +
      c('Record', (h.wins || 0) + '-' + (h.losses || 0) + (h.pushes ? '-' + h.pushes : ''),
        (h.win_pct == null ? '—' : h.win_pct + '%') + ' win rate') +
      c('Bets', String(h.bets || 0), (h.pending || 0) + ' still open');
  }

  function trend() {
    var el = document.getElementById('btxTrend');
    var d = S.daily || [];
    if (d.length < 2) { el.innerHTML = ''; return; }

    var W = 900, H = 130, pad = 6;
    var vals = d.map(function (r) { return Number(r.running); });
    var lo = Math.min(0, Math.min.apply(null, vals));
    var hi = Math.max(0, Math.max.apply(null, vals));
    if (hi === lo) hi = lo + 1;
    var x = function (i) { return pad + i * (W - pad * 2) / (d.length - 1); };
    var y = function (v) { return pad + (hi - v) * (H - pad * 2) / (hi - lo); };

    var line = d.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(vals[i]).toFixed(1); }).join(' ');
    var area = line + ' L' + x(d.length - 1).toFixed(1) + ' ' + y(0).toFixed(1) +
               ' L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';
    var end = vals[vals.length - 1];
    var stroke = end >= 0 ? '#12a06a' : '#d2382a';

    el.innerHTML = '<div class="btx-trend"><div class="t">Running units — ' + S.season + ' season</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
        '<path d="' + area + '" fill="' + stroke + '" opacity=".10"/>' +
        '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) +
          '" stroke="#ddd" stroke-width="1"/>' +
        '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2.5" ' +
          'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
        '<circle cx="' + x(d.length - 1).toFixed(1) + '" cy="' + y(end).toFixed(1) + '" r="4" fill="' + stroke + '"/>' +
      '</svg></div>';
  }

  function boardHtml() {
    if (!S.board.length) return '<p class="btx-state">No graded bets yet.</p>';
    return '<table><thead><tr><th></th><th>Analyst</th>' +
      '<th class="r">Bets</th><th class="r">Record</th><th class="r hide-sm">Win %</th>' +
      '<th class="r hide-sm">Risked</th><th class="r">Units</th><th class="r">ROI</th>' +
      '</tr></thead><tbody>' +
      S.board.map(function (r, i) {
        return '<tr>' +
          '<td class="rank">' + (i + 1) + '</td>' +
          '<td class="nm">' + esc(r.name) + '</td>' +
          '<td class="r">' + r.bets + '</td>' +
          '<td class="r">' + r.wins + '-' + r.losses + (r.pushes ? '-' + r.pushes : '') + '</td>' +
          '<td class="r hide-sm">' + (r.win_pct == null ? '—' : r.win_pct + '%') + '</td>' +
          '<td class="r hide-sm">' + units(r.units_risked) + 'u</td>' +
          '<td class="r big ' + cls(r.units_net) + '">' + signed(r.units_net) + '</td>' +
          '<td class="r ' + cls(r.roi) + '">' + (r.roi == null ? '—' : signed(r.roi, 1) + '%') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function betsHtml() {
    if (!S.bets.length) return '<p class="btx-state">No bets logged for this stretch.</p>';
    return '<table><thead><tr><th>Bet</th><th class="hide-sm">Analyst</th>' +
      '<th class="r">Odds</th><th class="r hide-sm">Units</th><th class="r">Result</th><th class="r">Net</th>' +
      '</tr></thead><tbody>' +
      S.bets.map(function (b) {
        return '<tr>' +
          '<td><div class="desc">' + esc(b.description) + '</div>' +
            '<div class="sub">' + dayTxt(b.placed_on) +
              (b.matchup ? ' · ' + esc(b.matchup) : '') +
              (b.sportsbook ? ' · ' + esc(b.sportsbook) : '') + '</div></td>' +
          '<td class="hide-sm">' + esc(b.bettor_name) + '</td>' +
          '<td class="r">' + oddsTxt(b.odds) + '</td>' +
          '<td class="r hide-sm">' + units(b.units) + 'u</td>' +
          '<td class="r"><span class="pill p-' + b.result + '">' + b.result + '</span></td>' +
          '<td class="r ' + cls(b.net) + '">' + (b.result === 'pending' ? '—' : signed(b.net)) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function render() {
    strip();
    trend();
    document.getElementById('btxStage').innerHTML = S.tab === 'board' ? boardHtml() : betsHtml();
  }

  /* ---------- data ---------- */

  async function load() {
    try {
      var res = await Promise.all([
        rpc('bt_leaderboard', { p_season: S.season, p_week: S.week }),
        rpc('bt_house', { p_season: S.season, p_week: S.week }),
        rpc('bt_board', { p_season: S.season, p_week: S.week }),
        rpc('bt_daily', { p_season: S.season, p_bettor: null })
      ]);
      S.board = res[0] || [];
      S.house = (res[1] || [])[0] || {};
      S.bets = res[2] || [];
      S.daily = res[3] || [];
      render();
    } catch (e) {
      document.getElementById('btxStage').innerHTML =
        '<p class="btx-state">Couldn\'t load the tracker. ' + esc(e.message || e) + '</p>';
    }
  }

  async function start() {
    CFG = sbCfg();
    if (!CFG) {
      document.getElementById('btxStage').innerHTML = '<p class="btx-state">Config not loaded.</p>';
      return;
    }

    var q = new URLSearchParams(location.search);
    var t = [];
    try { t = await rpc('bt_target', {}); } catch (e) { t = []; }
    S.season = Number(q.get('season')) || (t[0] && t[0].season) || new Date().getFullYear();
    S.week = q.get('week') ? Number(q.get('week')) : null;

    var sel = document.getElementById('btxWeek');
    for (var w = 1; w <= 22; w++) {
      var o = document.createElement('option');
      o.value = w; o.textContent = weekLabel(w);
      if (S.week === w) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = function () { S.week = this.value ? Number(this.value) : null; load(); };

    document.getElementById('btxTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      S.tab = b.dataset.tab;
      [].forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
      render();
    });

    await load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
