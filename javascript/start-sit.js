/* ============================================================
   Start/Sit Showdown — public stream board
   Reads ss_board / ss_standings / ss_week_results (anon RPCs).
   Staff who can write get an operator bar for picking live.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- tunables ---------- */
  var POLL_MS      = 15000;   // board refresh cadence during a stream
  var RECENT_GAMES = 3;       // stat chips per player
  var DVP_URL      = 'data/dvp.json';

  var SB_URL = window.SUPABASE_URL || '';
  var SB_KEY = window.SUPABASE_ANON_KEY || '';

  var STATE   = { season: null, week: null };
  var BOARD   = { week: null, matchups: [] };
  var ANALYSTS = [];          // [{id,name}]
  var DVP     = null;
  var STATS   = {};           // player_id -> [{week, pts}]
  var CAN_EDIT = false;
  var TAB     = 'board';
  var timer   = null;

  /* ---------- tiny helpers ---------- */
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p.charAt(0); }).join('').toUpperCase();
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n.toFixed(d == null ? 1 : d) : '\u2014'; }
  function ordinal(n) {
    n = Number(n); if (!isFinite(n)) return '';
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function rpc(name, body) {
    return fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      return r.json();
    });
  }

  function authToken() {
    try {
      var raw = localStorage.getItem('sb-auth-token');
      if (!raw) return null;
      var t = JSON.parse(raw);
      return t.access_token || t.currentSession && t.currentSession.access_token || null;
    } catch (e) { return null; }
  }

  /* ---------- assets ---------- */
  function logoUrl(team) {
    if (!team) return '';
    return 'https://sleepercdn.com/images/team_logos/nfl/' + String(team).toLowerCase() + '.png';
  }
  function shotUrl(espnId, sleeperId) {
    if (espnId) return 'https://a.espncdn.com/i/headshots/nfl/players/full/' + espnId + '.png';
    if (sleeperId) return 'https://sleepercdn.com/content/nfl/players/thumb/' + sleeperId + '.jpg';
    return '';
  }

  /* ---------- data loads ---------- */
  function loadState() {
    var qs = new URLSearchParams(location.search);
    return fetch('https://api.sleeper.app/v1/state/nfl')
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; })
      .then(function (s) {
        STATE.season = Number(qs.get('season')) || Number(s.season) || new Date().getFullYear();
        STATE.week   = Number(qs.get('week'))   || Number(s.display_week || s.week) || 1;
      });
  }

  function loadDvp() {
    return fetch(DVP_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { DVP = j; })
      .catch(function () { DVP = null; });
  }

  function loadAnalysts() {
    return rpc('ss_analysts').then(function (rows) { ANALYSTS = rows || []; })
      .catch(function () { ANALYSTS = []; });
  }

  function loadBoard() {
    return rpc('ss_board', { p_season: STATE.season, p_week: STATE.week })
      .then(function (j) {
        BOARD = j || { week: null, matchups: [] };
        BOARD.matchups = BOARD.matchups || [];
        renderWeek();
        if (TAB === 'board') renderBoard();
        loadRecentStats();
      });
  }

  /* Per-player weekly log — small payloads, unlike the 5MB players file. */
  function loadRecentStats() {
    var ids = [];
    BOARD.matchups.forEach(function (m) {
      if (m.a_player_id) ids.push(m.a_player_id);
      if (m.b_player_id) ids.push(m.b_player_id);
    });
    ids = ids.filter(function (id, i) { return ids.indexOf(id) === i && !STATS[id]; });
    if (!ids.length) return;

    Promise.all(ids.map(function (id) {
      var url = 'https://api.sleeper.app/stats/nfl/player/' + id +
                '?season_type=regular&season=' + STATE.season + '&grouping=week';
      return fetch(url).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var log = [];
          if (j) {
            Object.keys(j).forEach(function (w) {
              var row = j[w], st = row && (row.stats || row);
              var pts = st && st.pts_ppr;
              if (pts != null && Number(w) < STATE.week) log.push({ week: Number(w), pts: Number(pts) });
            });
          }
          log.sort(function (a, b) { return b.week - a.week; });
          STATS[id] = log.slice(0, RECENT_GAMES);
        })
        .catch(function () { STATS[id] = []; });
    })).then(function () { if (TAB === 'board') renderBoard(); });
  }

  /* ---------- rendering: matchups ---------- */
  function renderWeek() {
    var st = BOARD.week && BOARD.week.status;
    var label = 'Week ' + STATE.week + ' \u00b7 ' + STATE.season;
    if (st === 'locked') label += ' \u00b7 Picks locked';
    if (st === 'scored') label += ' \u00b7 Final';
    el('ssWeek').textContent = label;
  }

  function dvpFor(oppTeam, pos) {
    if (!DVP || !DVP.defense || !oppTeam) return null;
    var code = String(oppTeam).replace(/[^A-Za-z]/g, '').toUpperCase();
    var d = DVP.defense[code];
    return d && d[pos] ? d[pos] : null;
  }

  function dvpHtml(oppTeam, pos) {
    var d = dvpFor(oppTeam, pos);
    if (!d) return '';
    var cls = d.rank <= 10 ? 'soft' : (d.rank >= 23 ? 'tough' : 'mid');
    var code = String(oppTeam).replace(/[^A-Za-z]/g, '').toUpperCase();
    return '<div class="ss-dvp">' + esc(code) + ' allows <b>' + num(d.ppg) + '</b> PPG to ' + esc(pos) +
           's<span class="rk ' + cls + '">' + ordinal(d.rank) + ' most</span></div>';
  }

  function statsHtml(playerId) {
    var log = STATS[playerId];
    if (!log || !log.length) return '';
    return '<div class="ss-stats">' + log.map(function (g) {
      return '<div class="ss-chip"><b>' + num(g.pts) + '</b><span>Wk ' + g.week + '</span></div>';
    }).join('') + '</div>';
  }

  function picksHtml(m, side) {
    var picks = m.picks || [];
    var analysts = picks.filter(function (p) { return p.analyst; });
    var bothIn = ANALYSTS.length ? analysts.length >= ANALYSTS.length : analysts.length >= 2;
    var out = '';

    if (m.revealed) {
      analysts.filter(function (p) { return p.pick === side; }).forEach(function (p) {
        out += '<span class="ss-analyst">' + esc(p.name) + '</span>';
      });
    } else if (analysts.length) {
      out += '<span class="ss-hidden">' + analysts.length + ' locked in</span>';
    }

    if (m.revealed && bothIn) {
      var crowd = picks.filter(function (p) { return !p.analyst && p.pick === side; });
      if (crowd.length) {
        out += '<span class="ss-crowd">' + crowd.map(function (p) {
          return '<span class="ss-av" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>';
        }).join('') + '<span class="ss-crowd-n">' + crowd.length + ' staff</span></span>';
      }
    }
    return '<div class="ss-picks">' + out + '</div>';
  }

  function sideHtml(m, side) {
    var p = {
      name:  m[side + '_name'],
      team:  m[side + '_team'],
      opp:   m[side + '_opp'],
      pts:   m[side + '_points'],
      pid:   m[side + '_player_id'],
      espn:  m[side + '_espn_id']
    };
    var cls = 'ss-side ' + side;
    if (m.winner === side) cls += ' win';
    else if (m.winner && m.winner !== 'tie') cls += ' lose';

    var opp = p.opp ? (/^[@vs]/i.test(p.opp) ? p.opp : 'vs ' + p.opp) : '';
    var shot = shotUrl(p.espn, p.pid);

    return '<div class="' + cls + '">' +
      (p.team ? '<img class="ss-logo" src="' + logoUrl(p.team) + '" alt="" aria-hidden="true">' : '') +
      '<div class="ss-idrow">' +
        (shot ? '<img class="ss-shot" src="' + shot + '" alt="" data-fallback="' +
                (p.pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + p.pid + '.jpg' : '') + '">'
              : '<div class="ss-shot"></div>') +
        '<div>' +
          '<h3 class="ss-name">' + esc(p.name) + '</h3>' +
          '<p class="ss-meta">' + esc(m.pos) + (p.team ? ' \u00b7 ' + esc(p.team) : '') + '</p>' +
          (opp ? '<span class="ss-opp">' + esc(opp) + '</span>' : '') +
        '</div>' +
      '</div>' +
      statsHtml(p.pid) +
      dvpHtml(p.opp, m.pos) +
      (p.pts != null ? '<div class="ss-score">' + num(p.pts) + '</div>' : '') +
      picksHtml(m, side) +
    '</div>';
  }

  function opHtml(m) {
    var btns = ANALYSTS.map(function (a) {
      var mine = (m.picks || []).filter(function (p) { return p.staff_id === a.id; })[0];
      return ['a', 'b'].map(function (s) {
        var on = mine && mine.pick === s;
        return '<button class="ss-opbtn' + (on ? ' live' : '') + '" data-act="pick" data-m="' + m.id +
               '" data-staff="' + a.id + '" data-side="' + s + '">' +
               esc(a.name) + ' \u2192 ' + esc(m[s + '_name'] || s.toUpperCase()) + '</button>';
      }).join('');
    }).join('<span class="ss-opsep"></span>');

    return '<div class="ss-op">' + btns +
      '<span class="ss-opsep"></span>' +
      '<button class="ss-opbtn' + (m.revealed ? ' live' : '') + '" data-act="reveal" data-m="' + m.id +
      '" data-val="' + (m.revealed ? '0' : '1') + '">' +
      (m.revealed ? 'Hide picks' : 'Reveal picks') + '</button></div>';
  }

  function renderBoard() {
    var wrap = el('ssBoard');
    if (!BOARD.matchups.length) {
      wrap.innerHTML = '<p class="ss-note">No matchups posted for <b>Week ' + STATE.week +
        '</b> yet. Add them in the admin dashboard and they\u2019ll appear here.</p>';
      return;
    }
    wrap.innerHTML = BOARD.matchups.map(function (m) {
      var state = m.winner ? 'Final' : (m.revealed ? 'Picks revealed' : 'Picks hidden');
      return '<section class="ss-card">' +
        '<div class="ss-cardhead">' +
          '<span class="ss-pos ss-pos-' + esc(m.pos) + '"><i></i>' + esc(m.pos) + '</span>' +
          '<span class="ss-state">' + state + '</span>' +
        '</div>' +
        '<div class="ss-duel">' + sideHtml(m, 'a') + '<div class="ss-vs">VS</div>' + sideHtml(m, 'b') + '</div>' +
        opHtml(m) +
      '</section>';
    }).join('');
  }

  /* ---------- rendering: standings ---------- */
  function renderStandings() {
    rpc('ss_standings', { p_season: STATE.season }).then(function (rows) {
      var body = el('ssStandBody');
      if (!rows || !rows.length) {
        body.innerHTML = '<tr><td colspan="4" class="ss-note">No scored picks yet this season.</td></tr>';
        return;
      }
      body.innerHTML = rows.map(function (r, i) {
        var rec = r.wins + ' - ' + r.losses + (r.ties ? ' - ' + r.ties : '');
        return '<tr class="' + (r.analyst ? 'analyst' : '') + '">' +
          '<td class="rank num">' + (i + 1) + '</td>' +
          '<td class="who">' + esc(r.name) + '</td>' +
          '<td class="num">' + esc(rec) + '</td>' +
          '<td class="num">' + (r.pct == null ? '\u2014' : Number(r.pct).toFixed(3)) + '</td>' +
        '</tr>';
      }).join('');
    }).catch(function () {
      el('ssStandBody').innerHTML = '<tr><td colspan="4" class="ss-note">Standings unavailable right now.</td></tr>';
    });

    rpc('ss_week_results', { p_season: STATE.season, p_week: STATE.week }).then(function (rows) {
      if (!rows || !rows.length) return;
      el('ssWeekResultsHead').hidden = false;
      el('ssWeekResults').hidden = false;
      el('ssWeekBody').innerHTML = rows.map(function (r, i) {
        return '<tr class="' + (r.analyst ? 'analyst' : '') + '">' +
          '<td class="rank num">' + (i + 1) + '</td>' +
          '<td class="who">' + esc(r.name) + '</td>' +
          '<td class="num">' + r.wins + ' - ' + r.losses + (r.ties ? ' - ' + r.ties : '') + '</td>' +
        '</tr>';
      }).join('');
    }).catch(function () {});
  }

  /* ---------- operator actions ---------- */
  function setPick(matchupId, staffId, side) {
    var tok = authToken();
    if (!tok) return;
    return fetch(SB_URL + '/rest/v1/ss_picks?on_conflict=matchup_id,staff_id', {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ matchup_id: matchupId, staff_id: staffId, pick: side, updated_at: new Date().toISOString() })
    }).then(function (r) {
      if (!r.ok) throw new Error('pick ' + r.status);
      return loadBoard();
    });
  }

  function setReveal(matchupId, val) {
    var tok = authToken();
    if (!tok) return;
    return fetch(SB_URL + '/rest/v1/ss_matchups?id=eq.' + matchupId, {
      method: 'PATCH',
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ revealed: val === '1' })
    }).then(function (r) {
      if (!r.ok) throw new Error('reveal ' + r.status);
      return loadBoard();
    });
  }

  function checkOperator() {
    var tok = authToken();
    if (!tok || !ANALYSTS.length) return Promise.resolve();
    return fetch(SB_URL + '/rest/v1/ss_matchups?select=id&limit=1', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok }
    }).then(function (r) {
      if (r.ok) { CAN_EDIT = true; document.body.classList.add('op'); }
    }).catch(function () {});
  }

  /* ---------- wiring ---------- */
  function showTab(name) {
    TAB = name;
    el('tabBoard').classList.toggle('on', name === 'board');
    el('tabStand').classList.toggle('on', name === 'standings');
    el('ssBoard').hidden = name !== 'board';
    el('ssStandings').hidden = name !== 'standings';
    if (name === 'board') renderBoard(); else renderStandings();
  }

  function bind() {
    el('tabBoard').addEventListener('click', function () { showTab('board'); });
    el('tabStand').addEventListener('click', function () { showTab('standings'); });

    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.ss-opbtn');
      if (!b || !CAN_EDIT) return;
      if (b.dataset.act === 'pick') setPick(b.dataset.m, b.dataset.staff, b.dataset.side);
      if (b.dataset.act === 'reveal') setReveal(b.dataset.m, b.dataset.val);
    });

    // headshot fallback: ESPN -> Sleeper thumb -> blank circle
    document.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || img.className !== 'ss-shot') return;
      var fb = img.dataset.fallback;
      if (fb) { img.dataset.fallback = ''; img.src = fb; }
      else { img.removeAttribute('src'); }
    }, true);
  }

  function start() {
    if (!SB_URL || !SB_KEY) {
      el('ssBoard').innerHTML = '<p class="ss-note">Supabase config didn\u2019t load. ' +
        'Check that <b>javascript/auth.js</b> sets SUPABASE_URL and SUPABASE_ANON_KEY.</p>';
      return;
    }
    bind();
    loadState()
      .then(function () { return Promise.all([loadDvp(), loadAnalysts()]); })
      .then(function () { return loadBoard(); })
      .then(checkOperator)
      .then(function () {
        if (CAN_EDIT) renderBoard();
        timer = setInterval(function () {
          if (!document.hidden) loadBoard();
        }, POLL_MS);
      })
      .catch(function (err) {
        console.error('[start-sit]', err);
        el('ssBoard').innerHTML = '<p class="ss-note">Couldn\u2019t load the board. ' +
          'Confirm the Start/Sit SQL has been run.</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();