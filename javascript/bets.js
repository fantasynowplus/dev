/* bets.js — public bet tracker
   One call to bt_splits() gives every analyst's record by bet type;
   groupings are summed client-side so switching selections is instant. */
(function () {
  'use strict';

  /* the three who appear on the show board */
  var BTB = ['jozef hooson', 'paul redman', 'john byrne'];

  var TYPES = [
    ['prop',      'Player props'],
    ['spread',    'Spread'],
    ['total',     'Over / Under'],
    ['moneyline', 'Moneyline'],
    ['other',     'Other']
  ];

  var CFG = null;
  var S = { splits: [], recent: [], people: [], sel: 'btb' };

  /* ---------- plumbing ---------- */

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
  function initials(n) {
    return String(n || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function headshot(v) {
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return v.indexOf('/') >= 0 ? v.replace(/^\/+/, '') : 'assets/staff/' + v;
  }
  function units(n) { return (Number(n) || 0).toFixed(2).replace(/\.00$/, ''); }
  function signed(n, dp) {
    var v = Number(n) || 0;
    return (v > 0 ? '+' : '') + v.toFixed(dp === undefined ? 2 : dp);
  }
  function cls(n) { return Number(n) > 0 ? 'btx-up' : Number(n) < 0 ? 'btx-down' : ''; }
  function oddsTxt(n) { return n > 0 ? '+' + n : String(n); }
  function dayTxt(d) {
    if (!d) return '';
    var p = String(d).split('-');
    return p[1].replace(/^0/, '') + '/' + p[2].replace(/^0/, '');
  }
  function isBTB(name) { return BTB.indexOf(String(name || '').trim().toLowerCase()) > -1; }

  /* ---------- aggregation ---------- */

  function blank() {
    return { bets:0, pending:0, wins:0, losses:0, pushes:0, risked:0, net:0 };
  }
  function add(a, r) {
    a.bets += r.bets; a.pending += r.pending; a.wins += r.wins;
    a.losses += r.losses; a.pushes += r.pushes;
    a.risked += Number(r.risked || 0); a.net += Number(r.net || 0);
    return a;
  }
  function finish(a) {
    a.roi = a.risked > 0 ? a.net / a.risked * 100 : null;
    a.win_pct = (a.wins + a.losses) ? a.wins / (a.wins + a.losses) * 100 : null;
    return a;
  }
  function recordTxt(a) {
    return a.wins + '-' + a.losses + (a.pushes ? '-' + a.pushes : '');
  }

  /* rows matching the current selection */
  function rowsFor(sel) {
    if (sel === 'all') return S.splits;
    if (sel === 'btb') return S.splits.filter(function (r) { return isBTB(r.name); });
    return S.splits.filter(function (r) { return r.bettor_id === sel; });
  }

  function totalFor(sel) {
    return finish(rowsFor(sel).reduce(add, blank()));
  }

  function byType(sel) {
    var rows = rowsFor(sel);
    return TYPES.map(function (t) {
      var a = rows.filter(function (r) { return r.bet_type === t[0]; }).reduce(add, blank());
      a.key = t[0]; a.label = t[1];
      return finish(a);
    }).filter(function (a) { return a.bets > 0; });
  }

  function buildPeople() {
    var map = {};
    S.splits.forEach(function (r) {
      var p = map[r.bettor_id] || (map[r.bettor_id] = {
        id: r.bettor_id, name: r.name, headshot: r.headshot, t: blank()
      });
      add(p.t, r);
    });
    S.people = Object.keys(map).map(function (k) { return map[k]; });
    S.people.forEach(function (p) { finish(p.t); p.btb = isBTB(p.name); });
    S.people.sort(function (a, b) { return b.t.net - a.t.net; });
  }

  /* ---------- rail ---------- */

  function isOn(o) {
    if (S.sel === o.id) return true;
    if (o.group) return false;          // group cards only light up when picked directly
    if (S.sel === 'all') return true;   // All Picks lights everyone
    if (S.sel === 'btb') return !!o.btb;
    return false;
  }

  function avatarHtml(o) {
    var src = o.group ? o.logo : headshot(o.headshot);
    var fallback = o.group ? o.abbr : initials(o.name);
    if (!src) return '<div class="btx-anav">' + esc(fallback) + '</div>';
    return '<img class="btx-anav" src="' + esc(src) + '" alt="" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),' +
      '{className:\'btx-anav\',textContent:\'' + esc(fallback) + '\'}))">';
  }

  function analystHtml(o) {
    var on = isOn(o);
    return '<button class="btx-an' + (o.group ? ' grp' : '') + (on ? ' on' : ' dim') +
             '" data-sel="' + esc(o.id) + '">' +
      avatarHtml(o) +
      '<span class="btx-anb">' +
        '<span class="btx-ann">' + esc(o.name) + '</span>' +
        '<span class="btx-ans">' + recordTxt(o.t) +
          (o.t.roi == null ? '' : ' · ' + signed(o.t.roi, 1) + '%') + '</span>' +
      '</span>' +
      '<span class="btx-anu ' + cls(o.t.net) + '">' + signed(o.t.net) + '</span>' +
    '</button>';
  }

  function renderRail() {
    var groups = [
      { id: 'btb', name: 'Beat the Bookie', abbr: 'BTB', group: true,
        logo: 'assets/images/Beat-the-Bookie.png', t: totalFor('btb') },
      { id: 'all', name: 'All Picks', abbr: 'ALL', group: true,
        logo: 'assets/images/social-logo.png', t: totalFor('all') }
    ];
    document.getElementById('btxGroups').innerHTML = groups.map(analystHtml).join('');

    var main = S.people.filter(function (p) { return p.btb; });
    var rest = S.people.filter(function (p) { return !p.btb; });

    document.getElementById('btxMainPeople').innerHTML =
      main.map(function (p) {
        return analystHtml({ id:p.id, name:p.name, headshot:p.headshot, t:p.t, btb:p.btb });
      }).join('') ||
      '<p class="btx-state" style="padding:14px 0">No bets logged yet.</p>';

    document.getElementById('btxOtherLabel').hidden = !rest.length;
    document.getElementById('btxOtherPeople').innerHTML =
      rest.map(function (p) {
        return analystHtml({ id:p.id, name:p.name, headshot:p.headshot, t:p.t, btb:p.btb });
      }).join('');
  }

  /* ---------- left panel ---------- */
  function groupAvatar(src, fallback) {
    return '<img class="btx-whoav" src="' + esc(src) + '" alt="" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),' +
      '{className:\'btx-whoav\',textContent:\'' + fallback + '\'}))">';
  }
  function headerHtml() {
    var t = totalFor(S.sel);
    var name, sub, avatar;

    if (S.sel === 'all') {
      name = 'All Picks';
      sub = S.people.length + ' analyst' + (S.people.length === 1 ? '' : 's') + ' · every logged bet';
      avatar = groupAvatar('assets/images/social-logo.png', 'ALL');
    } else if (S.sel === 'btb') {
      var n = S.people.filter(function (p) { return p.btb; }).length;
      name = 'Beat the Bookie';
      sub = n + ' analyst' + (n === 1 ? '' : 's') + ' on the show board';
      avatar = groupAvatar('assets/images/Beat-the-Bookie.png', 'BTB');
    } else {
      var p = S.people.filter(function (x) { return x.id === S.sel; })[0] || { name: '—' };
      name = p.name;
      sub = t.bets + ' bet' + (t.bets === 1 ? '' : 's') + ' logged' + (t.pending ? ' · ' + t.pending + ' open' : '');
      avatar = headshot(p.headshot)
        ? '<img class="btx-whoav" src="' + esc(headshot(p.headshot)) + '" alt="">'
        : '<div class="btx-whoav">' + esc(initials(p.name)) + '</div>';
    }

    return '<div class="btx-who">' + avatar +
      '<div><div class="btx-whon">' + esc(name) + '</div>' +
      '<div class="btx-whos">' + esc(sub) + '</div></div></div>';
  }

  function stripHtml() {
    var t = totalFor(S.sel);
    function c(l, v, s) {
      return '<div class="btx-card"><div class="l">' + l + '</div><div class="v">' + v +
             '</div><div class="s">' + esc(s) + '</div></div>';
    }
    return '<div class="btx-strip">' +
      c('Units', '<span class="' + cls(t.net) + '">' + signed(t.net) + '</span>', units(t.risked) + 'u risked') +
      c('ROI', '<span class="' + cls(t.roi) + '">' + (t.roi == null ? '—' : signed(t.roi, 1) + '%') + '</span>', 'return on risk') +
      c('Record', recordTxt(t), (t.win_pct == null ? '—' : t.win_pct.toFixed(0) + '%') + ' win rate') +
      c('Open', String(t.pending), 'bets still live') +
      '</div>';
  }

  function splitsHtml() {
    var rows = byType(S.sel);
    if (!rows.length) return '';

    var peak = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.net); }).concat([1]));

    return '<div class="btx-sec">By bet type</div><div class="btx-panel"><table><thead><tr>' +
      '<th>Type</th><th class="r">Record</th><th class="r">Win %</th>' +
      '<th class="r">Risked</th><th class="r">Units</th><th class="r">ROI</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var w = Math.abs(r.net) / peak * 100;
        return '<tr>' +
          '<td><div class="btx-type">' + esc(r.label) + '</div>' +
            '<div class="btx-bar"><i style="width:' + w.toFixed(0) + '%;background:' +
            (r.net >= 0 ? '#56d364' : '#ff7b72') + '"></i></div></td>' +
          '<td class="r">' + recordTxt(r) + (r.pending ? ' <span class="btx-dim">(' + r.pending + ')</span>' : '') + '</td>' +
          '<td class="r">' + (r.win_pct == null ? '—' : r.win_pct.toFixed(0) + '%') + '</td>' +
          '<td class="r">' + units(r.risked) + 'u</td>' +
          '<td class="r ' + cls(r.net) + '"><b>' + signed(r.net) + '</b></td>' +
          '<td class="r ' + cls(r.roi) + '">' + (r.roi == null ? '—' : signed(r.roi, 1) + '%') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function recentHtml() {
    var list = S.recent.filter(function (b) {
      if (S.sel === 'all') return true;
      if (S.sel === 'btb') return isBTB(b.bettor_name);
      return b.bettor_id === S.sel;
    }).slice(0, 15);

    if (!list.length) return '';

    return '<div class="btx-sec">Recent bets</div><div class="btx-panel"><table><thead><tr>' +
      '<th>Bet</th><th class="r">Odds</th><th class="r">Result</th><th class="r">Net</th>' +
      '</tr></thead><tbody>' +
      list.map(function (b) {
        return '<tr>' +
          '<td><div class="btx-bd">' + esc(b.description) + '</div>' +
            '<div class="btx-bs">' + dayTxt(b.placed_on) + ' · ' + esc(b.bettor_name) +
            ' · ' + units(b.units) + 'u' + (b.sportsbook ? ' · ' + esc(b.sportsbook) : '') + '</div></td>' +
          '<td class="r">' + oddsTxt(b.odds) + '</td>' +
          '<td class="r"><span class="btx-pill btx-p-' + b.result + '">' + b.result + '</span></td>' +
          '<td class="r ' + cls(b.net) + '">' + (b.result === 'pending' ? '—' : signed(b.net)) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function render() {
    if (!S.splits.length) {
      document.getElementById('btxMain').innerHTML =
        '<p class="btx-state">No bets logged yet this season.</p>';
      renderRail();
      return;
    }
    document.getElementById('btxMain').innerHTML =
      headerHtml() + stripHtml() + splitsHtml() + recentHtml();
    renderRail();
  }

  /* ---------- boot ---------- */

  async function start() {
    CFG = sbCfg();
    if (!CFG) {
      document.getElementById('btxMain').innerHTML = '<p class="btx-state">Config not loaded.</p>';
      return;
    }

    var season = Number(new URLSearchParams(location.search).get('season')) || null;

    try {
      var res = await Promise.all([
        rpc('bt_splits', { p_season: season }),
        rpc('bt_recent', { p_season: season, p_limit: 60 })
      ]);
      S.splits = res[0] || [];
      S.recent = res[1] || [];
    } catch (e) {
      document.getElementById('btxMain').innerHTML =
        '<p class="btx-state">Couldn\'t load the tracker. ' + esc(e.message || e) + '</p>';
      return;
    }

    buildPeople();
    render();

    document.querySelector('.btx-wrap').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sel]');
      if (!b) return;
      S.sel = b.dataset.sel;
      render();
      if (window.innerWidth <= 900) {
        document.getElementById('btxMain').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();