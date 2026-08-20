/* ---------- My picks ---------- */

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
          ['a', 'b'].map(function (s, i) {
            var on = mine && mine.pick === s;
            return (i === 1 ? '' : '') +
              '<button class="btn' + (on ? ' btn-primary' : ' btn-ghost') + '"' +
              (locked ? ' disabled' : '') +
              ' onclick="ssMyPick(\'' + m.id + '\',\'' + s + '\')">' + esc(m[s + '_name']) + '</button>';
          }).join('<span class="ss-or">or</span>') +
        '</div>';
      }).join('') +
    '</div></div>';
}

/* ---------- Pickers ---------- */

function ssRenderPickers(b) {
  if (!SS.pickers) {
    b.innerHTML = '<div class="ss-pad"><div class="empty">SS.pickers isn\u2019t loaded.</div></div>';
    return;
  }
  var canAdd = can('startsit', 'c');

  var staffOpts = SS.staff
    .filter(function (s) { return !SS.pickers.some(function (p) { return p.staff_id === s.id; }); })
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
          '<span style="width:10px"></span>' +
          '<input id="ssAddGuest" placeholder="Guest name" style="width:180px">' +
          '<button class="btn btn-sm btn-primary" onclick="ssAddGuestPicker()">Add guest</button>' +
          '<span class="grow"></span>' +
          '<button class="btn btn-sm btn-ghost" onclick="ssCopyPickers()">Copy from Week ' + (SS.week - 1) + '</button>' +
        '</div>'
      : '') +
    (SS.pickers.length
      ? '<div class="table-wrap"><table><thead><tr>' +
          '<th>Picker</th><th style="width:110px">Type</th><th style="width:170px">Role</th>' +
          (canAdd ? '<th style="width:220px"></th>' : '<th></th>') +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="ss-pad"><div class="empty">No pickers set for Week ' + SS.week +
        (canAdd ? ' yet. Add staff or a guest above.' : '.') + '</div></div>') +
    '<p class="ss-note">On-air pickers appear under the VS on the stream page and pick live. ' +
      'Everyone else submits in advance. All guests share one line in the season standings.</p>';
}

/* ---------- Scoring ---------- */

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

/* ---------- pick grid (headshots in the first column) ---------- */

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

/* ---------- Standings (padding + headshots) ---------- */

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