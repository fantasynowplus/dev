var SS = { season: null, week: null, weekRow: null, matchups: [], tab: 'matchups',
           staff: [], players: null, sched: null, pickers: [] };

/* ---------- small helpers ---------- */

function ssPosList() { return ['QB', 'RB', 'WR', 'TE']; }
function ssVal(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

function ssUpsertPick(matchupId, pickerId, side) {
  return api('ss_picks?on_conflict=matchup_id,picker_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ matchup_id: matchupId, picker_id: pickerId, pick: side,
                           updated_at: new Date().toISOString() })
  });
}

function ssFetchState() {
  if (SS.season) return Promise.resolve();
  return fetch('https://api.sleeper.app/v1/state/nfl')
    .then(function (r) { return r.json(); })
    .catch(function () { return {}; })
    .then(function (s) {
      SS.season = Number(s.season) || new Date().getFullYear();
      SS.week = Number(s.display_week || s.week) || 1;
    });
}

/* trimmed player index, cached per session (~200KB vs the 5MB source) */
function ssPlayers() {
  if (SS.players) return Promise.resolve(SS.players);
  try {
    var cached = sessionStorage.getItem('ss_players');
    if (cached) { SS.players = JSON.parse(cached); return Promise.resolve(SS.players); }
  } catch (e) {}
  return fetch('https://api.sleeper.app/v1/players/nfl')
    .then(function (r) { return r.json(); })
    .then(function (all) {
      var out = [];
      Object.keys(all).forEach(function (id) {
        var p = all[id];
        if (!p || !p.position || ssPosList().indexOf(p.position) < 0 || !p.team) return;
        out.push({ id: id, n: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
                   t: p.team, p: p.position, e: p.espn_id || '' });
      });
      out.sort(function (a, b) { return a.n.localeCompare(b.n); });
      SS.players = out;
      try { sessionStorage.setItem('ss_players', JSON.stringify(out)); } catch (e) {}
      return out;
    });
}

/* team -> opponent for the selected week */
function ssSchedule() {
  var key = SS.season + '-' + SS.week;
  if (SS.sched && SS.sched.key === key) return Promise.resolve(SS.sched.map);
  return fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=' +
               SS.season + '&seasontype=2&week=' + SS.week)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var map = {};
      ((j && j.events) || []).forEach(function (ev) {
        var c = ev.competitions && ev.competitions[0];
        if (!c || !c.competitors || c.competitors.length < 2) return;
        var home = c.competitors.filter(function (x) { return x.homeAway === 'home'; })[0];
        var away = c.competitors.filter(function (x) { return x.homeAway === 'away'; })[0];
        if (!home || !away) return;
        var h = (home.team.abbreviation || '').toUpperCase();
        var a = (away.team.abbreviation || '').toUpperCase();
        map[h] = 'vs ' + a; map[a] = '@ ' + h;
      });
      SS.sched = { key: key, map: map };
      return map;
    })
    .catch(function () { return {}; });
}

/* full-PPR points for one player in one week */
function ssPlayerWeekPts(playerId, season, week) {
  return fetch('https://api.sleeper.app/stats/nfl/player/' + playerId +
               '?season_type=regular&season=' + season + '&grouping=week')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var row = j && j[String(week)];
      var st = row && (row.stats || row);
      return st && st.pts_ppr != null ? Number(st.pts_ppr) : null;
    })
    .catch(function () { return null; });
}

/* ---------- load ---------- */

function loadStartsit() {
  return ssgCan()
    .then(function (ok) { SSG_ALLOWED = ok; })
    .then(ssFetchState)
    .then(ssLoadWeek);
}

function ssLoadWeek() {
  return dbGet('ss_weeks?select=*&season=eq.' + SS.season + '&week=eq.' + SS.week)
    .then(function (rows) {
      SS.weekRow = (rows && rows[0]) || null;
      if (!SS.weekRow) { SS.matchups = []; SS.pickers = []; return; }
      return dbGet('ss_matchups?select=*,picks:ss_picks(id,picker_id,pick)&week_id=eq.' +
                   SS.weekRow.id + '&order=sort_order.asc')
        .then(function (m) {
          SS.matchups = m || [];
          return dbGet('ss_week_pickers?select=*,staff(id,name)&week_id=eq.' +
                       SS.weekRow.id + '&order=sort_order.asc');
        })
        .then(function (p) { SS.pickers = p || []; });
    })
    .then(function () { return ssLoadStaff(); })
    .then(renderStartsit)
    .catch(function (e) { console.error(e); toast('Couldn\u2019t load Start/Sit data', true); });
}

function ssLoadStaff() {
  if (SS.staff.length) return Promise.resolve();
  return dbGet('staff?select=id,name,is_showdown_analyst&order=name.asc')
    .then(function (r) { SS.staff = r || []; })
    .catch(function () { SS.staff = []; });
}

/* ---------- shell ---------- */

/* Add a year here when the time comes. */
var SS_SEASONS = [2025, 2026];

function renderStartsit() {
  var canManage = can('startsit', 'u');
  var tabs = [];
  if (canManage) tabs.push(['matchups', 'Matchups']);
  tabs.push(['pickers', 'Pickers'], ['picks', 'My picks']);
  if (canManage) tabs.push(['scoring', 'Scoring']);
  tabs.push(['standings', 'Standings']);
  if (SSG_ALLOWED) tabs.push(['suggest', 'Suggestions']);
  if (!tabs.some(function (t) { return t[0] === SS.tab; })) SS.tab = 'picks';

  var seasons = SS_SEASONS.slice();
  if (seasons.indexOf(SS.season) < 0) seasons.push(SS.season);
  seasons.sort(function (a, b) { return b - a; });

  var weeks = [];
  for (var w = 1; w <= 18; w++) {
    weeks.push('<option value="' + w + '"' + (w === SS.week ? ' selected' : '') + '>Week ' + w + '</option>');
  }

  document.getElementById('content').innerHTML = '<div class="panel">' +
    '<div class="panel-head ss-head">' +
      '<div class="ss-tabs">' +
        '<button class="btn btn-ghost btn-sm" onclick="go(\'tools\')">&larr; Tools</button>' +
        tabs.map(function (t) {
          return '<button class="btn btn-sm' + (SS.tab === t[0] ? ' btn-primary' : ' btn-ghost') +
                 '" onclick="ssTab(\'' + t[0] + '\')">' + t[1] + '</button>';
        }).join('') +
      '</div>' +
      '<div class="ss-when">' +
        '<select id="ssSeason" onchange="ssJump()">' +
          seasons.map(function (y) {
            return '<option value="' + y + '"' + (y === SS.season ? ' selected' : '') + '>' + y + '</option>';
          }).join('') +
        '</select>' +
        '<select id="ssWeekSel" onchange="ssJump()">' + weeks.join('') + '</select>' +
        (SS.weekRow ? ssStatusPill() : '') +
      '</div>' +
    '</div>' +
    '<div id="ssBody"></div>' +
  '</div>';

  ssRenderTab();
}

function ssStatusPill() {
  var s = SS.weekRow.status;
  var color = s === 'scored' ? 'var(--green)' : (s === 'locked' ? 'var(--orange)' : 'var(--navy)');
  var next = s === 'open' ? 'locked' : (s === 'locked' ? 'scored' : 'open');
  return badge(s, color) +
    ifCan('startsit', 'u', '<button class="btn btn-sm btn-ghost" onclick="ssSetStatus(\'' + next +
      '\')">Set ' + next + '</button>') +
    (SS.weekRow.is_display
      ? badge('On site', 'var(--green)')
      : ifCan('startsit', 'u', '<button class="btn btn-sm btn-ghost" onclick="ssSetDisplay()">Show on site</button>'));
}

function ssSetDisplay() {
  rpc('ss_set_display_week', { p_week_id: SS.weekRow.id })
    .then(function () { toast('Week ' + SS.week + ' is now live on the site'); return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t set the display week', true); });
}

function ssTab(t) { SS.tab = t; renderStartsit(); }

function ssJump() {
  SS.season = Number(document.getElementById('ssSeason').value) || SS.season;
  SS.week = Number(document.getElementById('ssWeekSel').value) || SS.week;
  SS.sched = null;
  SSG.key = null;
  ssLoadWeek();
}

function ssRenderTab() {
  var b = document.getElementById('ssBody');
  if (SS.tab === 'suggest') return ssgInit();
  if (!SS.weekRow) {
    b.innerHTML = '<div class="empty">No Week ' + SS.week + ' yet. ' +
      ifCan('startsit', 'c', '<button class="btn btn-primary" onclick="ssCreateWeek()">Create Week ' +
        SS.week + '</button>') + '</div>';
    return;
  }
  if ((SS.tab === 'matchups' || SS.tab === 'scoring') && !can('startsit', 'u')) {
    b.innerHTML = '<div class="empty">You don\u2019t have access to this tab.</div>';
    return;
  }
  if (SS.tab === 'matchups')  return ssRenderMatchups(b);
  if (SS.tab === 'pickers')   return ssRenderPickers(b);
  if (SS.tab === 'picks')     return ssRenderMyPicks(b);
  if (SS.tab === 'scoring')   return ssRenderScoring(b);
  if (SS.tab === 'standings') return ssRenderStandings(b);
}

function ssCreateWeek() {
  dbPost('ss_weeks', { season: SS.season, week: SS.week, status: 'open' })
    .then(function () { toast('Week created'); return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t create the week', true); });
}

function ssSetStatus(next) {
  dbPatch('ss_weeks?id=eq.' + SS.weekRow.id, { status: next })
    .then(function () { toast('Week set to ' + next); return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t change the status', true); });
}

/* ---------- tab: matchups ---------- */

function ssRenderMatchups(b) {
  var rows = ssPosList().map(function (pos) {
    var m = SS.matchups.filter(function (x) { return x.pos === pos; })[0];
    if (!m) {
      return '<tr><td><b>' + pos + '</b></td><td colspan="3" class="muted">Not set</td>' +
        '<td class="row-actions">' + ifCan('startsit', 'c',
          '<button class="btn btn-sm btn-primary" onclick="ssMatchupForm(\'' + pos + '\')">Add</button>') +
        '</td></tr>';
    }
    return '<tr>' +
      '<td><b>' + pos + '</b></td>' +
      '<td>' + esc(m.a_name) + ' <span class="muted">' + esc(m.a_team || '') + ' ' + esc(m.a_opp || '') + '</span></td>' +
      '<td class="ss-vs">vs</td>' +
      '<td>' + esc(m.b_name) + ' <span class="muted">' + esc(m.b_team || '') + ' ' + esc(m.b_opp || '') + '</span></td>' +
      '<td class="row-actions">' +
        ifCan('startsit', 'u', '<button class="btn btn-sm btn-ghost" onclick="ssMatchupForm(\'' + pos + '\',\'' + m.id + '\')">Edit</button>') +
        ifCan('startsit', 'd', '<button class="btn btn-sm btn-danger" onclick="ssMatchupDelete(\'' + m.id + '\')">Delete</button>') +
      '</td></tr>';
  }).join('');

  b.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
    '<th style="width:70px">Pos</th><th>Player A</th><th style="width:44px"></th>' +
    '<th>Player B</th><th style="width:170px"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function ssMatchupForm(pos, id) {
  var m = id ? SS.matchups.filter(function (x) { return x.id === id; })[0] : null;

  function sideFields(side, label) {
    return '<div class="field">' +
      '<label>' + label + '</label>' +
      '<input id="ss_' + side + '_q" class="ss-search" autocomplete="off" placeholder="Search players\u2026" value="' +
        (m ? esc(m[side + '_name']) : '') + '">' +
      '<div class="ss-results" id="ss_' + side + '_res"></div>' +
      '<input type="hidden" id="ss_' + side + '_id" value="' + (m ? esc(m[side + '_player_id'] || '') : '') + '">' +
      '<input type="hidden" id="ss_' + side + '_espn" value="' + (m ? esc(m[side + '_espn_id'] || '') : '') + '">' +
      '<input type="hidden" id="ss_' + side + '_team" value="' + (m ? esc(m[side + '_team'] || '') : '') + '">' +
      '<div class="ss-picked muted" id="ss_' + side + '_meta">' +
        (m ? esc((m[side + '_team'] || '') + ' ' + (m[side + '_opp'] || '')) : '') + '</div>' +
      '<input id="ss_' + side + '_opp" placeholder="Opponent (auto)" value="' + (m ? esc(m[side + '_opp'] || '') : '') + '">' +
    '</div>';
  }

  modal({
    title: (m ? 'Edit ' : 'Add ') + pos + ' matchup \u00b7 Week ' + SS.week,
    wide: true,
    saveLabel: 'Save matchup',
    body: '<div class="form-grid">' + sideFields('a', 'Player A') + sideFields('b', 'Player B') + '</div>' +
          '<p class="muted" id="ssPlayerLoad">Loading player list\u2026</p>',
    onReady: function () {
      Promise.all([ssPlayers(), ssSchedule()]).then(function (res) {
        var elLoad = document.getElementById('ssPlayerLoad');
        if (elLoad) elLoad.remove();
        ['a', 'b'].forEach(function (side) { ssBindSearch(side, pos, res[0], res[1]); });
      });
    },
    onSave: function () {
      var payload = {
        week_id: SS.weekRow.id, pos: pos, sort_order: ssPosList().indexOf(pos),
        a_player_id: ssVal('ss_a_id') || null, a_espn_id: ssVal('ss_a_espn') || null,
        a_name: ssVal('ss_a_q'), a_team: ssVal('ss_a_team') || null, a_opp: ssVal('ss_a_opp') || null,
        b_player_id: ssVal('ss_b_id') || null, b_espn_id: ssVal('ss_b_espn') || null,
        b_name: ssVal('ss_b_q'), b_team: ssVal('ss_b_team') || null, b_opp: ssVal('ss_b_opp') || null
      };
      if (!payload.a_name || !payload.b_name) throw new Error('Pick both players first.');
      var p = m ? dbPatch('ss_matchups?id=eq.' + m.id, payload) : dbPost('ss_matchups', payload);
      return p.then(function () { toast('Matchup saved'); return ssLoadWeek(); });
    }
  });
}

function ssBindSearch(side, pos, list, sched) {
  var q = document.getElementById('ss_' + side + '_q');
  var res = document.getElementById('ss_' + side + '_res');
  if (!q || !res) return;

  q.addEventListener('input', function () {
    var term = q.value.trim().toLowerCase();
    if (term.length < 2) { res.innerHTML = ''; return; }
    res.innerHTML = list.filter(function (p) {
      return p.p === pos && p.n.toLowerCase().indexOf(term) >= 0;
    }).slice(0, 8).map(function (p) {
      return '<button type="button" class="ss-hit" data-id="' + p.id + '" data-espn="' + p.e +
        '" data-team="' + p.t + '" data-name="' + esc(p.n) + '">' + esc(p.n) +
        ' <span class="muted">' + p.t + '</span></button>';
    }).join('');
  });

  res.addEventListener('click', function (e) {
    var btn = e.target.closest('.ss-hit');
    if (!btn) return;
    q.value = btn.dataset.name;
    document.getElementById('ss_' + side + '_id').value = btn.dataset.id;
    document.getElementById('ss_' + side + '_espn').value = btn.dataset.espn;
    document.getElementById('ss_' + side + '_team').value = btn.dataset.team;
    document.getElementById('ss_' + side + '_opp').value = sched[btn.dataset.team] || '';
    document.getElementById('ss_' + side + '_meta').textContent =
      btn.dataset.team + ' ' + (sched[btn.dataset.team] || '');
    res.innerHTML = '';
  });
}

function ssMatchupDelete(id) {
  confirmDelete('this matchup and every pick on it', function () {
    return dbDel('ss_matchups?id=eq.' + id).then(function () { toast('Matchup deleted'); return ssLoadWeek(); });
  });
}

/* ---------- tab: pickers ---------- */

function ssRenderPickers(b) {
  if (!SS.pickers) {
    b.innerHTML = '<div class="ss-pad"><div class="empty">SS.pickers isn\u2019t loaded.</div></div>';
    return;
  }
  var canAdd = can('startsit', 'c');
  var missing = SS.staff.filter(function (s) {
    return !SS.pickers.some(function (p) { return p.staff_id === s.id; });
  });

  var staffOpts = missing
    .map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; })
    .join('');

  var rows = SS.pickers.map(function (p) {
    var person = p.staff || { name: p.guest_name };
    return '<tr>' +
      '<td><div class="ss-who">' + avatarHtml(person, 'ss-av') +
        '<b>' + esc(person.name) + '</b></div></td>' +
      '<td>' + (p.staff_id ? badge('Staff', 'var(--navy)') : badge('Guest', 'var(--orange)')) + '</td>' +
      '<td>' + (p.on_air ? badge('On air', 'var(--green)') : '<span class="muted">Submits picks</span>') + '</td>' +
      '<td class="row-actions">' +
        ifCan('startsit', 'u', '<button class="btn btn-sm btn-ghost" onclick="ssTogglePickerAir(\'' + p.id + '\',' +
          (p.on_air ? 'false' : 'true') + ')">' + (p.on_air ? 'Take off air' : 'Put on air') + '</button>') +
        ifCan('startsit', 'd', '<button class="btn btn-sm btn-danger" onclick="ssRemovePicker(\'' + p.id + '\')">Remove</button>') +
      '</td></tr>';
  }).join('');

  b.innerHTML =
    (canAdd
      ? '<div class="ss-bar">' +
          '<select id="ssAddStaff"><option value="">Add staff picker\u2026</option>' + staffOpts + '</select>' +
          '<button class="btn btn-sm btn-primary" onclick="ssAddStaffPicker()">Add</button>' +
          '<button class="btn btn-sm btn-ghost" onclick="ssAddAllPickers()"' +
            (missing.length ? '' : ' disabled') + '>Add all' +
            (missing.length ? ' (' + missing.length + ')' : '') + '</button>' +
          '<span class="ss-sep"></span>' +
          '<input id="ssAddGuest" placeholder="Guest name" style="width:180px">' +
          '<button class="btn btn-sm btn-primary" onclick="ssAddGuestPicker()">Add guest</button>' +
          '<span class="grow"></span>' +
          '<button class="btn btn-sm btn-ghost" onclick="ssCopyPickers()">Copy from Week ' + (SS.week - 1) + '</button>' +
        '</div>'
      : '') +
    (SS.pickers.length
      ? '<div class="table-wrap"><table><thead><tr>' +
          '<th>Picker</th><th style="width:110px">Type</th><th style="width:170px">Role</th>' +
          '<th style="width:240px"></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="ss-pad"><div class="empty">No pickers set for Week ' + SS.week +
        (canAdd ? ' yet. Add staff or a guest above.' : '.') + '</div></div>') +
    '<p class="ss-note">On-air pickers appear under the VS on the stream page and pick live. ' +
      'Everyone else submits in advance. All guests share one line in the season standings.</p>';
}

function ssAddAllPickers() {
  var missing = SS.staff.filter(function (s) {
    return !SS.pickers.some(function (p) { return p.staff_id === s.id; });
  });
  if (!missing.length) { toast('Everyone is already a picker'); return; }
  var base = SS.pickers.length;
  dbPost('ss_week_pickers', missing.map(function (s, i) {
    return { week_id: SS.weekRow.id, staff_id: s.id, sort_order: base + i };
  }))
    .then(function () { toast(missing.length + ' pickers added'); return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t add everyone', true); });
}

function ssAddStaffPicker() {
  var id = document.getElementById('ssAddStaff').value;
  if (!id) { toast('Choose a staff member first', true); return; }
  dbPost('ss_week_pickers', { week_id: SS.weekRow.id, staff_id: id, sort_order: SS.pickers.length })
    .then(function () { return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t add that picker', true); });
}

function ssAddGuestPicker() {
  var nm = ssVal('ssAddGuest');
  if (!nm) { toast('Enter the guest\u2019s name', true); return; }
  dbPost('ss_week_pickers', { week_id: SS.weekRow.id, guest_name: nm, on_air: true, sort_order: SS.pickers.length })
    .then(function () { return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t add that guest', true); });
}

function ssTogglePickerAir(id, on) {
  dbPatch('ss_week_pickers?id=eq.' + id, { on_air: on })
    .then(function () { return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t change that', true); });
}

function ssRemovePicker(id) {
  confirmDelete('this picker and their picks for the week', function () {
    return dbDel('ss_week_pickers?id=eq.' + id).then(function () { return ssLoadWeek(); });
  });
}

function ssCopyPickers() {
  dbGet('ss_weeks?select=id&season=eq.' + SS.season + '&week=eq.' + (SS.week - 1))
    .then(function (rows) {
      if (!rows || !rows.length) throw new Error('no previous week');
      return rpc('ss_copy_pickers', { p_from_week: rows[0].id, p_to_week: SS.weekRow.id });
    })
    .then(function () { toast('Pickers copied'); return ssLoadWeek(); })
    .catch(function () { toast('Nothing to copy from Week ' + (SS.week - 1), true); });
}

/* ---------- tab: my picks ---------- */

function ssMyPicker() {
  return SS.pickers.filter(function (p) { return p.staff_id === MY_STAFF_ID; })[0] || null;
}

function ssRenderMyPicks(b) {
  if (!MY_STAFF_ID) {
    b.innerHTML = '<div class="ss-pad"><div class="empty">Your login isn\u2019t linked to a staff record yet.</div></div>';
    return;
  }
  var me = ssMyPicker();
  if (!me) {
    b.innerHTML = '<div class="ss-pad"><div class="empty">You\u2019re not on the picker list for Week ' +
      SS.week + '. Ask an admin to add you in the Pickers tab.</div></div>';
    return;
  }
  if (!SS.matchups.length) {
    b.innerHTML = '<div class="ss-pad"><div class="empty">No matchups set for this week yet.</div></div>';
    return;
  }
  var locked = SS.weekRow.status !== 'open';
  var made = SS.matchups.filter(function (m) {
    return (m.picks || []).some(function (p) { return p.picker_id === me.id; });
  }).length;

  b.innerHTML =
    '<div class="ss-bar">' +
      '<b style="font-size:13px;color:var(--navy)">' + made + ' of ' + SS.matchups.length + ' picks made</b>' +
      '<span class="grow"></span>' +
      (locked ? badge('Picks closed', 'var(--muted)') : badge('Open', 'var(--green)')) +
    '</div>' +
    '<div class="ss-pad"><div class="ss-picks">' +
      SS.matchups.map(function (m) {
        var mine = (m.picks || []).filter(function (p) { return p.picker_id === me.id; })[0];
        return '<div class="ss-pickrow">' +
          '<span class="ss-pickpos">' + esc(m.pos) + '</span>' +
          ['a', 'b'].map(function (s) {
            var on = mine && mine.pick === s;
            return '<button class="btn btn-sm' + (on ? ' btn-primary' : ' btn-ghost') + '"' +
              (locked ? ' disabled' : '') +
              ' onclick="ssMyPick(\'' + m.id + '\',\'' + s + '\')">' + esc(m[s + '_name']) + '</button>';
          }).join('<span class="ss-or">or</span>') +
        '</div>';
      }).join('') +
    '</div></div>';
}

function ssMyPick(matchupId, side) {
  var me = ssMyPicker();
  if (!me) { toast('You\u2019re not a picker this week', true); return; }
  ssUpsertPick(matchupId, me.id, side)
    .then(function () { return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t save that pick', true); });
}

/* ---------- tab: scoring ---------- */

function ssRenderScoring(b) {
  if (!SS.matchups.length) {
    b.innerHTML = '<div class="ss-pad"><div class="empty">No matchups set for this week yet.</div></div>';
    return;
  }

  var cards = SS.matchups.map(function (m) {
    return '<div class="ss-card">' +
      '<div class="ss-cardhead"><b>' + esc(m.pos) + '</b>' +
        '<button class="btn btn-sm btn-ghost" onclick="ssPullPoints(\'' + m.id + '\')">Pull points</button></div>' +
      '<div class="ss-scorerow">' +
        ['a', 'b'].map(function (s) {
          return '<label class="ss-scoreside' + (m.winner === s ? ' win' : '') + '">' +
            '<input type="radio" name="w_' + m.id + '" value="' + s + '"' + (m.winner === s ? ' checked' : '') + '>' +
            '<span class="ss-scorename">' + esc(m[s + '_name']) + '</span>' +
            '<input class="ss-scorepts" id="pts_' + m.id + '_' + s + '" value="' +
              (m[s + '_points'] == null ? '' : m[s + '_points']) + '" placeholder="0.0">' +
          '</label>';
        }).join('<span class="ss-vs">vs</span>') +
        '<label class="ss-scoreside tie-opt"><input type="radio" name="w_' + m.id + '" value="tie"' +
          (m.winner === 'tie' ? ' checked' : '') + '><span class="muted">Tie</span></label>' +
      '</div></div>';
  }).join('');

  b.innerHTML =
    '<div class="ss-bar">' +
      '<button class="btn btn-sm btn-ghost" onclick="ssPullAll()">Pull all points from Sleeper</button>' +
      '<span class="grow"></span>' +
      ifCan('startsit', 'u', '<button class="btn btn-sm btn-primary" onclick="ssSaveScores()">Save results</button>') +
    '</div>' +
    '<div class="ss-pad">' + cards +
      '<h3 class="ss-sub">Everyone\u2019s picks</h3><div id="ssGrid"></div>' +
    '</div>';

  ssRenderPickGrid();
}

function ssPullPoints(id) {
  var m = SS.matchups.filter(function (x) { return x.id === id; })[0];
  if (!m) return Promise.resolve();
  return Promise.all([
    m.a_player_id ? ssPlayerWeekPts(m.a_player_id, SS.season, SS.week) : null,
    m.b_player_id ? ssPlayerWeekPts(m.b_player_id, SS.season, SS.week) : null
  ]).then(function (r) {
    if (r[0] != null) document.getElementById('pts_' + id + '_a').value = r[0].toFixed(2);
    if (r[1] != null) document.getElementById('pts_' + id + '_b').value = r[1].toFixed(2);
    var a = Number(document.getElementById('pts_' + id + '_a').value);
    var bb = Number(document.getElementById('pts_' + id + '_b').value);
    if (isFinite(a) && isFinite(bb)) {
      var pick = a === bb ? 'tie' : (a > bb ? 'a' : 'b');
      var radio = document.querySelector('input[name="w_' + id + '"][value="' + pick + '"]');
      if (radio) radio.checked = true;
    }
  });
}

function ssPullAll() {
  toast('Pulling full-PPR points\u2026');
  Promise.all(SS.matchups.map(function (m) { return ssPullPoints(m.id); }))
    .then(function () { toast('Points pulled \u2014 review, then Save results'); });
}

function ssSaveScores() {
  var jobs = SS.matchups.map(function (m) {
    var sel = document.querySelector('input[name="w_' + m.id + '"]:checked');
    var a = document.getElementById('pts_' + m.id + '_a').value;
    var b = document.getElementById('pts_' + m.id + '_b').value;
    return dbPatch('ss_matchups?id=eq.' + m.id, {
      a_points: a === '' ? null : Number(a),
      b_points: b === '' ? null : Number(b),
      winner: sel ? sel.value : null,
      scored_at: sel ? new Date().toISOString() : null,
      scored_by: MY_STAFF_ID || null
    });
  });
  Promise.all(jobs)
    .then(function () { return dbPatch('ss_weeks?id=eq.' + SS.weekRow.id, { status: 'scored' }); })
    .then(function () { toast('Results saved'); return ssLoadWeek(); })
    .catch(function () { toast('Couldn\u2019t save the results', true); });
}

/* every picker x every matchup — mirrors the old spreadsheet */
function ssRenderPickGrid() {
  var g = document.getElementById('ssGrid');
  if (!g) return;
  if (!SS.pickers.length) {
    g.innerHTML = '<div class="empty">No pickers set for this week.</div>';
    return;
  }
  var editable = can('startsit', 'u');
  var head = '<tr><th>Picker</th>' + SS.matchups.map(function (m) {
    return '<th>' + esc(m.pos) + '</th>';
  }).join('') + '<th style="width:80px">W-L</th></tr>';

  var rows = SS.pickers.map(function (s) {
    var w = 0, l = 0;
    var person = s.staff || { name: s.guest_name };
    var cells = SS.matchups.map(function (m) {
      var p = (m.picks || []).filter(function (x) { return x.picker_id === s.id; })[0];
      if (p && m.winner && m.winner !== 'tie') { if (m.winner === p.pick) w++; else l++; }
      if (!editable) {
        return '<td>' + (p ? esc(m[p.pick + '_name']) : '<span class="muted">\u2014</span>') + '</td>';
      }
      return '<td><select onchange="ssGridPick(\'' + m.id + '\',\'' + s.id + '\',this.value)">' +
        '<option value=""' + (p ? '' : ' selected') + '>\u2014</option>' +
        '<option value="a"' + (p && p.pick === 'a' ? ' selected' : '') + '>' + esc(m.a_name) + '</option>' +
        '<option value="b"' + (p && p.pick === 'b' ? ' selected' : '') + '>' + esc(m.b_name) + '</option>' +
        '</select></td>';
    }).join('');
    return '<tr' + (s.on_air ? ' class="analyst"' : '') + '>' +
      '<td><div class="ss-who">' + avatarHtml(person, 'ss-av') + esc(person.name) + '</div></td>' +
      cells + '<td class="mono">' + w + ' - ' + l + '</td></tr>';
  }).join('');

  g.innerHTML = '<div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
}

function ssGridPick(matchupId, pickerId, side) {
  var p = side
    ? ssUpsertPick(matchupId, pickerId, side)
    : dbDel('ss_picks?matchup_id=eq.' + matchupId + '&picker_id=eq.' + pickerId);
  p.then(function () { return ssLoadWeek(); })
   .catch(function () { toast('Couldn\u2019t save that pick', true); });
}

/* ---------- tab: standings ---------- */

function ssRenderStandings(b) {
  b.innerHTML = '<div class="ss-pad"><div class="empty">Loading standings\u2026</div></div>';
  rpc('ss_standings', { p_season: SS.season }).then(function (rows) {
    if (!rows || !rows.length) {
      b.innerHTML = '<div class="ss-pad"><div class="empty">No scored picks yet this season.</div></div>';
      return;
    }
    b.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      '<th style="width:56px">#</th><th>Name</th><th style="width:70px">W</th>' +
      '<th style="width:70px">L</th><th style="width:90px">Win %</th>' +
      '</tr></thead><tbody>' + rows.map(function (r, i) {
        var person = SS.staff.filter(function (s) { return s.id === r.key; })[0] || { name: r.name };
        return '<tr' + (r.analyst ? ' class="analyst"' : '') + '>' +
          '<td class="mono">' + (i + 1) + '</td>' +
          '<td><div class="ss-who">' + avatarHtml(person, 'ss-av') + esc(r.name) + '</div></td>' +
          '<td class="mono">' + r.wins + '</td><td class="mono">' + r.losses + '</td>' +
          '<td class="mono">' + (r.pct == null ? '\u2014' : Number(r.pct).toFixed(3)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }).catch(function () {
    b.innerHTML = '<div class="ss-pad"><div class="empty">Standings unavailable.</div></div>';
  });
}
