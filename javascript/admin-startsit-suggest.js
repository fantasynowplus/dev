var SSG_ALLOWED = false;
var SSG = { key: null, data: null, sel: {} };

function ssgCan() {
  return rpc('ss_suggest_can', {})
    .then(function (r) { return r === true; })
    .catch(function () { return false; });
}

function ssgOrd(n) {
  if (n % 10 === 1 && n !== 11) return 'st';
  if (n % 10 === 2 && n !== 12) return 'nd';
  if (n % 10 === 3 && n !== 13) return 'rd';
  return 'th';
}

function ssgOpp(p) { return (p.home ? 'vs ' : '@ ') + p.opp; }

/* teams already spoken for this week: saved matchups at other positions,
   plus anything selected but not yet saved */
function ssgTeamsInUse(skipPos) {
  var used = {};
  SS.matchups.forEach(function (m) {
    if (m.pos === skipPos) return;
    if (m.a_team) used[m.a_team] = m.a_name;
    if (m.b_team) used[m.b_team] = m.b_name;
  });
  Object.keys(SSG.sel).forEach(function (pos) {
    if (pos === skipPos) return;
    SSG.sel[pos].forEach(function (p) { used[p.team] = p.name; });
  });
  return used;
}

function ssgFind(pos, id) {
  var g = SSG.data.payload.positions[pos];
  return g.tough.concat(g.soft).filter(function (p) {
    return String(p.sleeper_id) === String(id);
  })[0];
}

function ssgCard(p, pos) {
  var sel = SSG.sel[pos] || [];
  var on = sel.some(function (x) { return x.sleeper_id === p.sleeper_id; });
  var clash = ssgTeamsInUse(pos)[p.team];
  var l3 = p.dvpPpgL3 != null
    ? ' <span class="ssg-l3">L3 ' + p.dvpPpgL3.toFixed(1) + '</span>' : '';
  return '<button class="ssg-card' + (on ? ' on' : '') + (clash ? ' clash' : '') + '"' +
    ' onclick="ssgToggle(\'' + pos + '\',\'' + p.sleeper_id + '\')">' +
    '<span class="ssg-rk">' + pos + p.rank + '</span>' +
    '<span class="ssg-nm">' + esc(p.name) + '</span>' +
    '<span class="ssg-mt">' + esc(p.team + ' ' + ssgOpp(p)) + '</span>' +
    '<span class="ssg-dv">' + p.dvpPpg.toFixed(1) + ' FPA \u00b7 ' +
      p.dvpRank + ssgOrd(p.dvpRank) + ' most' + l3 +
      (clash ? ' \u00b7 <b>' + esc(p.team) + ' used by ' + esc(clash) + '</b>' : '') +
    '</span></button>';
}

function ssgInit() {
  var b = document.getElementById('ssBody');
  var key = SS.season + '-' + SS.week;
  if (SSG.key === key && SSG.data !== null) { ssgRender(b); return; }
  b.innerHTML = '<div class="ss-pad"><div class="empty">Loading suggestions\u2026</div></div>';
  SSG.key = key;
  SSG.sel = {};
  rpc('ss_suggestions_get', { p_season: SS.season, p_week: SS.week })
    .then(function (rows) { SSG.data = (rows && rows[0]) || false; ssgRender(b); })
    .catch(function () {
      SSG.key = null;
      b.innerHTML = '<div class="ss-pad"><div class="empty">Suggestions unavailable.</div></div>';
    });
}

function ssgRender(b) {
  if (!SSG.data) {
    b.innerHTML = '<div class="ss-pad"><div class="empty">No snapshot for ' + SS.season +
      ' Week ' + SS.week + '.<br>Run the <b>Start/Sit suggestions</b> workflow with week ' +
      SS.week + ' to build one.</div></div>';
    return;
  }
  var d = SSG.data;
  var body = ssPosList().map(function (pos) {
    var g = (d.payload.positions || {})[pos] || { tough: [], soft: [] };
    var sel = SSG.sel[pos] || [];
    var exists = SS.matchups.filter(function (m) { return m.pos === pos; })[0];
    var action = sel.length === 2
      ? '<button class="btn btn-sm btn-primary" onclick="ssgCreate(\'' + pos + '\')">' +
        (exists ? 'Replace' : 'Create') + ' ' + pos + ' matchup</button>'
      : '<span class="muted">Choose two</span>';
    return '<div class="ss-card">' +
      '<div class="ss-cardhead"><b>' + pos + '</b>' + action + '</div>' +
      '<div class="ssg-grid">' +
        '<div><div class="ssg-hd">Higher rank \u00b7 tough defense</div>' +
          g.tough.map(function (p) { return ssgCard(p, pos); }).join('') + '</div>' +
        '<div><div class="ssg-hd">Lower rank \u00b7 soft defense</div>' +
          g.soft.map(function (p) { return ssgCard(p, pos); }).join('') + '</div>' +
      '</div></div>';
  }).join('');
  b.innerHTML =
    '<div class="ss-bar"><span class="muted">Generated ' +
      fmtDate(d.generated_at) + ' \u00b7 ' + esc(d.source) + ' \u00b7 DvP through week ' +
      (d.payload.dvp_through == null ? '\u2014' : d.payload.dvp_through) + '</span></div>' +
    '<div class="ss-pad">' + body + '</div>' +
    '<p class="ss-note">Orange cards share a team with a player already used this week. ' +
      'Season and week follow the selectors above.</p>';
}

function ssgToggle(pos, id) {
  var p = ssgFind(pos, id);
  if (!p) return;
  var cur = SSG.sel[pos] || [];
  var at = -1;
  cur.forEach(function (x, i) { if (x.sleeper_id === p.sleeper_id) at = i; });
  if (at >= 0) cur.splice(at, 1);
  else if (cur.length < 2) cur.push(p);
  else { toast('Two per position \u2014 deselect one first', true); return; }
  SSG.sel[pos] = cur;
  ssgRender(document.getElementById('ssBody'));
}

function ssgCreate(pos) {
  if (!SS.weekRow) { toast('Create Week ' + SS.week + ' first', true); return; }
  var sel = SSG.sel[pos] || [];
  if (sel.length !== 2) return;
  var used = ssgTeamsInUse(pos);
  var bad = sel.filter(function (p) { return used[p.team]; })[0];
  if (bad) { toast(bad.team + ' is already used this week (' + used[bad.team] + ')', true); return; }
  if (sel[0].team === sel[1].team) { toast('Both players are on ' + sel[0].team, true); return; }

  var a = sel[0], bb = sel[1];
  var payload = {
    week_id: SS.weekRow.id, pos: pos, sort_order: ssPosList().indexOf(pos),
    a_player_id: a.sleeper_id, a_espn_id: a.espn_id || null,
    a_name: a.name, a_team: a.team, a_opp: ssgOpp(a),
    b_player_id: bb.sleeper_id, b_espn_id: bb.espn_id || null,
    b_name: bb.name, b_team: bb.team, b_opp: ssgOpp(bb)
  };
  var exists = SS.matchups.filter(function (m) { return m.pos === pos; })[0];
  var job = exists ? dbPatch('ss_matchups?id=eq.' + exists.id, payload)
                   : dbPost('ss_matchups', payload);
  job.then(function () {
    SSG.sel[pos] = [];
    toast(pos + ' matchup saved');
    return ssLoadWeek();
  }).catch(function () { toast('Couldn\u2019t save that matchup', true); });
}