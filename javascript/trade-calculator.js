(function () {
  var SHEET_URL = {
    draft: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0RwIKqubfB3GVgr2hFzH5VqjemlPqpOHeJFRaFYtIdeW4wYaOol2HJq6mqB6pNUXj9ztP-4mDGzOk/pub?gid=0&single=true&output=csv',
    dynasty: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0RwIKqubfB3GVgr2hFzH5VqjemlPqpOHeJFRaFYtIdeW4wYaOol2HJq6mqB6pNUXj9ztP-4mDGzOk/pub?gid=102395833&single=true&output=csv'
  };
  var WORKER = 'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/rankings';
  var RANK_POS = ['QB', 'RB', 'WR', 'TE'];
  var POS_COL = { QB: '#e5578a', RB: '#3fb98a', WR: '#4b8fe0', TE: '#e08a4b' };
  var TIERS = {
    QB: [[8, 200, 160], [12, 100, 80], [24, 55, 42], [36, 30, 20]],
    RB: [[12, 200, 160], [24, 100, 80], [36, 55, 42], [60, 30, 20], [100, 12, 7], [200, 5, 2]],
    WR: [[12, 200, 160], [24, 100, 80], [36, 55, 42], [60, 30, 20], [100, 12, 7], [200, 5, 2]],
    TE: [[4, 200, 160], [10, 100, 80], [16, 55, 42], [28, 30, 20], [50, 12, 7]]
  };
  var PICK_BASE = { 1: 90, 2: 45, 3: 20 };
  var YEAR_DISCOUNT = [1.0, 0.7, 0.5];

  var rankCache = {}, CUR = null;
  var state = { format: 'dynasty', pool: [], sides: { A: [], B: [] } };

  function el(id) { return document.getElementById(id); }
  function comma(v) { return Math.round(v).toLocaleString(); }
  function normName(s) { return (s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv|v)$/, ''); }
  function matchKey(name, pos) { return normName(name) + '|' + (pos || '').toUpperCase(); }
  function draftYears() { var y = new Date().getFullYear() + 1; return [y, y + 1, y + 2]; }
  function ordRound(r) { return r === 1 ? '1st' : r === 2 ? '2nd' : '3rd'; }

  function playerValue(pos, rank) {
    var tiers = TIERS[pos];
    if (!tiers || !rank) return 0;
    var minRank = 1;
    for (var i = 0; i < tiers.length; i++) {
      var maxRank = tiers[i][0], hi = tiers[i][1], lo = tiers[i][2];
      if (rank <= maxRank) {
        if (maxRank === minRank) return hi;
        var frac = (rank - minRank) / (maxRank - minRank);
        return Math.round(hi - frac * (hi - lo));
      }
      minRank = maxRank + 1;
    }
    return 0;
  }
  function pickValue(a) { return Math.round((PICK_BASE[a.round] || 0) * (YEAR_DISCOUNT[a.yearIdx] || 0)); }

  async function rankingsFor(format) {
    var key = format === 'dynasty' ? 'dynasty' : 'draft';
    if (rankCache[key]) return rankCache[key];
    var fnMap = {}, ecrMap = {}, lists = {};
    try {
      var res = await fetch(SHEET_URL[key]);
      var text = await res.text();
      var rows = text.split(/\r?\n/);
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i]) continue;
        var cols = rows[i].split(',');
        var posRank = parseInt(String(cols[0] || '').replace(/[^0-9]/g, ''), 10);
        var name = (cols[2] || '').replace(/^"|"$/g, '').trim();
        var pos = (cols[4] || '').replace(/^"|"$/g, '').trim().toUpperCase();
        var team = (cols[3] || '').replace(/^"|"$/g, '').trim();
        if (!name || !pos || !posRank) continue;
        var k = matchKey(name, pos);
        if (fnMap[k] == null) fnMap[k] = posRank;
        (lists[pos] = lists[pos] || []).push({ name: name, team: team, pos: pos, rank: posRank });
      }
    } catch (e) {}
    for (var pi = 0; pi < RANK_POS.length; pi++) {
      var pos2 = RANK_POS[pi];
      try {
        var r2 = await fetch(WORKER + '?format=' + key + '&position=' + pos2 + '&limit=200');
        if (!r2.ok) continue;
        var d2 = await r2.json();
        var arr2 = Array.isArray(d2) ? d2 : (d2.players || []);
        for (var j = 0; j < arr2.length; j++) {
          var kk = matchKey(arr2[j].name, arr2[j].position || pos2);
          if (ecrMap[kk] == null) ecrMap[kk] = j + 1;
        }
      } catch (e) {}
    }
    rankCache[key] = { map: Object.assign({}, ecrMap, fnMap), lists: lists };
    return rankCache[key];
  }

  function buildPool(rankData) {
    var pool = [], seen = {};
    RANK_POS.forEach(function (pos) {
      (rankData.lists[pos] || []).forEach(function (p) {
        var k = matchKey(p.name, pos);
        if (seen[k]) return; seen[k] = true;
        pool.push({ name: p.name, pos: pos, team: p.team, value: playerValue(pos, p.rank) });
      });
    });
    pool.sort(function (a, b) { return b.value - a.value; });
    return pool;
  }

  function assetValue(a) {
    if (a.kind === 'pick') return pickValue(a);
    return playerValue(a.pos, CUR ? CUR.map[matchKey(a.name, a.pos)] : null);
  }
  function sideTotal(side) { return state.sides[side].reduce(function (s, a) { return s + assetValue(a); }, 0); }

  function renderSide(side) {
    var assets = state.sides[side];
    el('tc-list-' + side).innerHTML = assets.map(function (a, i) {
      var v = assetValue(a), label, sub, color;
      if (a.kind === 'pick') { label = a.year + ' ' + ordRound(a.round); sub = 'Rookie Pick'; color = '#8a97b3'; }
      else { label = a.name; sub = a.pos + (a.team ? ' · ' + a.team : ''); color = POS_COL[a.pos] || '#5a6a85'; }
      return '<div class="tc-asset"><span class="tc-dot" style="background:' + color + '"></span>' +
        '<div class="tc-asset-main"><div class="tc-asset-name">' + label + '</div><div class="tc-asset-sub">' + sub + '</div></div>' +
        '<span class="tc-asset-val">' + comma(v) + '</span>' +
        '<button class="tc-remove" data-side="' + side + '" data-idx="' + i + '">&times;</button></div>';
    }).join('') || '<div class="tc-empty">No players or picks added yet.</div>';
    el('tc-total-' + side).textContent = comma(sideTotal(side));
  }

  function renderVerdict() {
    var ta = sideTotal('A'), tb = sideTotal('B'), v = el('tc-verdict');
    if (!ta && !tb) { v.innerHTML = '<div class="tc-verdict-msg" style="color:#8a97b3;font-size:15px;font-weight:600">Add players or picks to each side to evaluate.</div>'; return; }
    var diff = ta - tb, ad = Math.abs(diff), fair = ad <= Math.max(10, Math.max(ta, tb) * 0.10);
    var cls = fair ? 'tc-fair' : diff > 0 ? 'tc-winA' : 'tc-winB';
    var msg = fair ? 'Fair trade' : diff > 0 ? 'Side A wins by ' + comma(ad) : 'Side B wins by ' + comma(ad);
    v.innerHTML = '<div class="tc-vrow"><span>Side A</span><b>' + comma(ta) + '</b></div>' +
      '<div class="tc-vbar"><div class="tc-vbar-a" style="flex:' + (ta || 0.0001) + '"></div><div class="tc-vbar-b" style="flex:' + (tb || 0.0001) + '"></div></div>' +
      '<div class="tc-vrow"><span>Side B</span><b>' + comma(tb) + '</b></div>' +
      '<div class="tc-verdict-msg ' + cls + '">' + msg + '</div>';
  }

  function renderAll() { renderSide('A'); renderSide('B'); renderVerdict(); }

  function renderPickAdders() {
    var show = state.format === 'dynasty', years = draftYears();
    ['A', 'B'].forEach(function (side) {
      var c = el('tc-pickadd-' + side);
      if (!show) { c.innerHTML = ''; c.style.display = 'none'; return; }
      c.style.display = 'flex';
      var yo = years.map(function (y, idx) { return '<option value="' + idx + '">' + y + '</option>'; }).join('');
      c.innerHTML = '<select class="tc-sel" id="tc-year-' + side + '">' + yo + '</select>' +
        '<select class="tc-sel" id="tc-round-' + side + '"><option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option></select>' +
        '<button class="tc-pickbtn" data-side="' + side + '">+ Pick</button>';
    });
  }

  function hideResults() { ['A', 'B'].forEach(function (s) { el('tc-results-' + s).style.display = 'none'; }); }

  function onSearch(side, q) {
    var box = el('tc-results-' + side);
    q = (q || '').trim().toLowerCase();
    if (!q) { box.style.display = 'none'; return; }
    var matches = state.pool.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
    box.innerHTML = matches.map(function (p) {
      return '<div class="tc-result" data-side="' + side + '" data-name="' + encodeURIComponent(p.name) + '" data-pos="' + p.pos + '" data-team="' + (p.team || '') + '">' +
        '<span class="tc-dot" style="background:' + (POS_COL[p.pos] || '#5a6a85') + '"></span>' + p.name +
        '<span class="tc-result-meta">' + p.pos + (p.team ? ' · ' + p.team : '') + ' · ' + comma(p.value) + '</span></div>';
    }).join('') || '<div class="tc-result tc-empty">No match</div>';
    box.style.display = 'block';
  }

  function addPlayer(side, name, pos, team) {
    state.sides[side].push({ kind: 'player', name: name, pos: pos, team: team });
    el('tc-search-' + side).value = ''; hideResults(); renderAll();
  }
  function addPick(side) {
    var yi = parseInt(el('tc-year-' + side).value, 10), rd = parseInt(el('tc-round-' + side).value, 10);
    state.sides[side].push({ kind: 'pick', yearIdx: yi, round: rd, year: draftYears()[yi] });
    renderAll();
  }
  function removeAsset(side, idx) { state.sides[side].splice(idx, 1); renderAll(); }

  async function setFormat(fmt) {
    state.format = fmt;
    if (fmt !== 'dynasty') { state.sides.A = state.sides.A.filter(function (a) { return a.kind !== 'pick'; }); state.sides.B = state.sides.B.filter(function (a) { return a.kind !== 'pick'; }); }
    Array.prototype.forEach.call(document.querySelectorAll('.tc-fmt-btn'), function (b) { b.classList.toggle('active', b.getAttribute('data-fmt') === fmt); });
    el('tc-status').style.display = 'block';
    el('tc-status').textContent = 'Loading ' + fmt + ' rankings…';
    CUR = await rankingsFor(fmt);
    state.pool = buildPool(CUR);
    el('tc-status').style.display = 'none';
    renderPickAdders();
    renderAll();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('.tc-fmt-btn'), function (b) { b.addEventListener('click', function () { setFormat(b.getAttribute('data-fmt')); }); });
    ['A', 'B'].forEach(function (side) {
      var inp = el('tc-search-' + side);
      inp.addEventListener('input', function () { onSearch(side, this.value); });
      inp.addEventListener('focus', function () { onSearch(side, this.value); });
    });
    document.addEventListener('click', function (e) {
      var t = e.target;
      var res = t.closest && t.closest('.tc-result');
      if (res && res.getAttribute('data-name')) { addPlayer(res.getAttribute('data-side'), decodeURIComponent(res.getAttribute('data-name')), res.getAttribute('data-pos'), res.getAttribute('data-team')); return; }
      var rm = t.closest && t.closest('.tc-remove');
      if (rm) { removeAsset(rm.getAttribute('data-side'), parseInt(rm.getAttribute('data-idx'), 10)); return; }
      var pk = t.closest && t.closest('.tc-pickbtn');
      if (pk) { addPick(pk.getAttribute('data-side')); return; }
      if (!(t.closest && t.closest('.tc-searchwrap'))) hideResults();
    });
    setFormat('dynasty');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();