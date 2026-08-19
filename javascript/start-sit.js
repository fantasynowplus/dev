(function () {
  'use strict';

  var POLL_MS      = 12000;
  var RECENT_GAMES = 3;
  var DVP_URL      = 'data/dvp.json';
  var POSITIONS    = ['QB', 'RB', 'WR', 'TE'];

  var SB_URL = '', SB_KEY = '';
  var STATE    = { season: null, week: null };
  var BOARD    = { week: null, matchups: [] };
  var ANALYSTS = [];
  var DVP      = null;
  var STATS    = {};
  var CAN_EDIT = false;
  var current  = 'QB';
  var busy     = {};
  var FORCE_SEASON = 2025;   // set to null when the real season starts

  /* ---------- helpers ---------- */
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(n) {
    return String(n || '').trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p.charAt(0); }).join('').toUpperCase();
  }
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || n; }
  function num(v, d) { var x = Number(v); return isFinite(x) ? x.toFixed(d == null ? 1 : d) : '\u2014'; }
  function ordinal(n) {
    n = Number(n); if (!isFinite(n)) return '';
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function sbCfg() {
    return {
      url: (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : '',
      key: (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : '',
      token: localStorage.getItem('sb-auth-token')
    };
  }
  function authToken() {
    var raw = sbCfg().token;
    if (!raw) return null;
    try {
      var t = JSON.parse(raw);
      return t.access_token || (t.currentSession && t.currentSession.access_token) || null;
    } catch (e) { return raw; }
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

  function logoUrl(t) {
    return t ? 'https://sleepercdn.com/images/team_logos/nfl/' + String(t).toLowerCase() + '.png' : '';
  }
  function shotUrl(espn, sleeper) {
    if (espn) return 'https://a.espncdn.com/i/headshots/nfl/players/full/' + espn + '.png';
    if (sleeper) return 'https://sleepercdn.com/content/nfl/players/thumb/' + sleeper + '.jpg';
    return '';
  }

  /* ---------- loads ---------- */
  function loadState() {
    var qs = new URLSearchParams(location.search);
    return fetch('https://api.sleeper.app/v1/state/nfl')
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; })
      .then(function (s) {
        var fallback = Number(s.display_week || s.week) || 1;
        // STATE.season = Number(qs.get('season')) || Number(s.season) || new Date().getFullYear(); // ADD THIS BACK LATER AND DELETE LINE BELOW //
        STATE.season = Number(qs.get('season')) || FORCE_SEASON || Number(s.season) || new Date().getFullYear();
        var forced = Number(qs.get('week'));
        if (forced) { STATE.week = forced; return; }
        return rpc('ss_current_week', { p_season: STATE.season })
          .then(function (w) { STATE.week = Number(w) || fallback; })
          .catch(function () { STATE.week = fallback; });
      });
  }

  function loadDvp() {
    return fetch(DVP_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { DVP = j; })
      .catch(function () { DVP = null; });
  }

  function loadAnalysts() {
    return rpc('ss_analysts')
      .then(function (r) { ANALYSTS = r || []; })
      .catch(function () { ANALYSTS = []; });
  }

  function loadBoard(silent) {
    return rpc('ss_board', { p_season: STATE.season, p_week: STATE.week })
      .then(function (j) {
        BOARD = j || { week: null, matchups: [] };
        BOARD.matchups = BOARD.matchups || [];
        stamp();
        render();
        loadRecentStats();
      })
      .catch(function (e) {
        if (!silent) el('stage').innerHTML =
          '<div class="state">Couldn\u2019t load the board. Confirm the Start/Sit SQL has been run.</div>';
        throw e;
      });
  }

  function loadRecentStats() {
    var ids = [];
    BOARD.matchups.forEach(function (m) {
      if (m.a_player_id) ids.push(m.a_player_id);
      if (m.b_player_id) ids.push(m.b_player_id);
    });
    ids = ids.filter(function (id, i) { return ids.indexOf(id) === i && !STATS[id]; });
    if (!ids.length) return;

    Promise.all(ids.map(function (id) {
      return fetch('https://api.sleeper.app/stats/nfl/player/' + id +
                   '?season_type=regular&season=' + STATE.season + '&grouping=week')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var log = [];
          if (j) Object.keys(j).forEach(function (w) {
            var row = j[w], st = row && (row.stats || row);
            if (st && st.pts_ppr != null && Number(w) < STATE.week) {
              log.push({ week: Number(w), pts: Number(st.pts_ppr) });
            }
          });
          log.sort(function (a, b) { return b.week - a.week; });
          STATS[id] = log.slice(0, RECENT_GAMES);
        })
        .catch(function () { STATS[id] = []; });
    })).then(render);
  }

  /* ---------- render ---------- */
  function matchupFor(pos) {
    return BOARD.matchups.filter(function (m) { return m.pos === pos; })[0] || null;
  }

  function dvpHtml(opp, pos) {
    if (!DVP || !DVP.defense || !opp) return '';
    var code = String(opp).replace(/[^A-Za-z]/g, '').toUpperCase();
    var d = DVP.defense[code] && DVP.defense[code][pos];
    if (!d) return '';
    var cls = d.rank <= 10 ? 'soft' : (d.rank >= 23 ? 'tough' : 'mid');
    return '<div class="dvp">' + esc(code) + ' allows <b>' + num(d.ppg) + '</b> PPG to ' + esc(pos) +
           's<span class="rk ' + cls + '">' + ordinal(d.rank) + ' most</span></div>';
  }

  function statsHtml(pid) {
    var log = STATS[pid];
    if (!log || !log.length) return '';
    return '<div class="stats">' + log.map(function (g) {
      return '<div class="chip"><b>' + num(g.pts) + '</b><span>Wk ' + g.week + '</span></div>';
    }).join('') + '</div>';
  }

  function analystPicks(m) {
    return (m.picks || []).filter(function (p) { return p.analyst; });
  }
  function bothIn(m) {
    var need = ANALYSTS.length || 2;
    return analystPicks(m).length >= need;
  }

  function picksHtml(m, side) {
    var out = analystPicks(m).filter(function (p) { return p.pick === side; })
      .map(function (p) { return '<span class="abadge">' + esc(p.name) + '</span>'; }).join('');
    var crowd = '';
    if (bothIn(m)) {
      var others = (m.picks || []).filter(function (p) { return !p.analyst && p.pick === side; });
      if (others.length) {
        crowd = '<div class="crowd">' + others.map(function (p) {
          return '<span class="av" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>';
        }).join('') + '<span class="crowd-n">' + others.length + ' staff</span></div>';
      }
    }
    return '<div class="picks">' + out + '</div>' + crowd;
  }

  function opHtml(m, side) {
    if (!ANALYSTS.length) return '';
    return '<div class="opbar">' + ANALYSTS.map(function (a) {
      var mine = (m.picks || []).filter(function (p) { return p.staff_id === a.id; })[0];
      var on = mine && mine.pick === side;
      return '<button class="opbtn' + (on ? ' on' : '') + '" data-m="' + m.id +
             '" data-staff="' + a.id + '" data-side="' + side + '">' + esc(firstName(a.name)) + '</button>';
    }).join('') + '</div>';
  }

  function sideHtml(m, side) {
    var name = m[side + '_name'], team = m[side + '_team'], opp = m[side + '_opp'];
    var pts = m[side + '_points'], pid = m[side + '_player_id'], espn = m[side + '_espn_id'];

    var cls = 'side ' + side;
    if (m.winner === side) cls += ' win';
    else if (m.winner && m.winner !== 'tie') cls += ' lose';

    var oppTxt = opp ? (/^[@v]/i.test(opp) ? opp : 'vs ' + opp) : '';
    var shot = shotUrl(espn, pid);
    var fb = pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + pid + '.jpg' : '';

    return '<div class="' + cls + '">' +
      (team ? '<img class="logo" src="' + logoUrl(team) + '" alt="" aria-hidden="true">' : '') +
      '<div class="idrow">' +
        (shot ? '<img class="shot" src="' + shot + '" alt="" data-fallback="' + fb + '">'
              : '<div class="shot"></div>') +
        '<div>' +
          '<h2 class="pname">' + esc(name) + '</h2>' +
          '<p class="pmeta">' + esc(m.pos) + (team ? ' \u00b7 ' + esc(team) : '') + '</p>' +
          (oppTxt ? '<span class="opp">' + esc(oppTxt) + '</span>' : '') +
        '</div>' +
      '</div>' +
      statsHtml(pid) +
      dvpHtml(opp, m.pos) +
      (pts != null ? '<div class="final">' + num(pts) + '</div>' : '') +
      picksHtml(m, side) +
      opHtml(m, side) +
    '</div>';
  }

  function centerHtml(m) {
    var picked = analystPicks(m);
    var waiting = ANALYSTS.filter(function (a) {
      return !picked.some(function (p) { return p.staff_id === a.id; });
    });
    var note = !ANALYSTS.length ? 'No analysts flagged'
      : m.winner ? 'Final'
      : (waiting.length ? 'On the clock<br>' + waiting.map(function (a) { return esc(firstName(a.name)); }).join(' &middot; ')
                        : 'Both locked in');
    return '<div class="center">' +
      '<span class="posmark" style="background:var(--' + esc(m.pos) + ')">' + esc(m.pos) + '</span>' +
      '<span class="vs">VS</span>' +
      '<span class="waiting">' + note + '</span>' +
    '</div>';
  }

  function render() {
    var stage = el('stage');

    if (current === 'ST') { renderStandings(stage); return; }

    el('subTitle').innerHTML = 'Week ' + STATE.week + ' &middot; <span class="pos">' + esc(current) + '</span>';

    var m = matchupFor(current);
    if (!m) {
      stage.innerHTML = '<div class="state">No <b>' + esc(current) + '</b> matchup set for Week ' +
        STATE.week + ' yet.<br>Add it in the admin dashboard and it\u2019ll appear here.</div>';
      return;
    }
    stage.innerHTML = '<div class="duel">' + sideHtml(m, 'a') + centerHtml(m) + sideHtml(m, 'b') + '</div>';
  }

  function renderStandings(stage) {
    el('subTitle').innerHTML = 'Season ' + STATE.season + ' &middot; <span class="pos">Standings</span>';
    stage.innerHTML = '<div class="state">Loading standings&hellip;</div>';
    rpc('ss_standings', { p_season: STATE.season }).then(function (rows) {
      if (!rows || !rows.length) {
        stage.innerHTML = '<div class="state">No scored picks yet this season.</div>';
        return;
      }
      stage.innerHTML = '<div class="scroller"><table><thead><tr>' +
        '<th style="width:64px">#</th><th class="who">Name</th><th>W</th><th>L</th><th>Win %</th>' +
        '</tr></thead><tbody>' + rows.map(function (r, i) {
          return '<tr class="' + (r.analyst ? 'analyst' : '') + '">' +
            '<td>' + (i + 1) + '</td><td class="who">' + esc(r.name) + '</td>' +
            '<td>' + r.wins + '</td><td>' + r.losses + '</td>' +
            '<td class="pct">' + (r.pct == null ? '\u2014' : Number(r.pct).toFixed(3)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function () {
      stage.innerHTML = '<div class="state">Standings unavailable right now.</div>';
    });
  }

  function stamp() {
    var d = new Date();
    el('updated').textContent = 'Updated ' +
      d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- live picks ---------- */
  function setPick(matchupId, staffId, side, btn) {
    var key = matchupId + staffId;
    if (busy[key]) return;
    var tok = authToken();
    if (!tok) return;
    busy[key] = true;

    /* optimistic: the operator sees it land instantly */
    var m = BOARD.matchups.filter(function (x) { return x.id === matchupId; })[0];
    if (m) {
      m.picks = (m.picks || []).filter(function (p) { return p.staff_id !== staffId; });
      var a = ANALYSTS.filter(function (x) { return x.id === staffId; })[0];
      m.picks.push({ staff_id: staffId, name: a ? a.name : '', pick: side, analyst: true });
      render();
    }

    fetch(SB_URL + '/rest/v1/ss_picks?on_conflict=matchup_id,staff_id', {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        matchup_id: matchupId, staff_id: staffId, pick: side,
        updated_at: new Date().toISOString()
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('pick ' + r.status);
    }).catch(function (e) {
      console.error('[start-sit] pick failed', e);
    }).then(function () {
      busy[key] = false;
      return loadBoard(true);
    });
  }

  function checkOperator() {
    var tok = authToken();
    if (!tok || !ANALYSTS.length) return Promise.resolve();
    return fetch(SB_URL + '/rest/v1/ss_matchups?select=id&limit=1', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok }
    }).then(function (r) {
      if (r.ok) { CAN_EDIT = true; document.body.classList.add('op'); render(); }
    }).catch(function () {});
  }

  /* ---------- wiring ---------- */
  window.show = function (pos) {
    current = pos;
    POSITIONS.concat(['ST']).forEach(function (p) {
      var b = el('tab-' + p);
      if (!b) return;
      var on = p === pos;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    render();
  };

  window.reload = function () { STATS = {}; loadBoard().then(loadRecentStats); };

  function bind() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.opbtn');
      if (!b || !CAN_EDIT) return;
      setPick(b.dataset.m, b.dataset.staff, b.dataset.side, b);
    });

    document.addEventListener('keydown', function (e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      var i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0) window.show(POSITIONS[i]);
      if (e.key === '5') window.show('ST');
    });

    document.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || img.className !== 'shot') return;
      var fb = img.dataset.fallback;
      if (fb) { img.dataset.fallback = ''; img.src = fb; }
      else { img.removeAttribute('src'); }
    }, true);
  }

  function start() {
    var cfg = sbCfg();
    SB_URL = cfg.url; SB_KEY = cfg.key;
    if (!SB_URL || !SB_KEY) {
      el('stage').innerHTML = '<div class="state">Supabase config didn\u2019t load. ' +
        'Check that <b>javascript/auth.js</b> is present on this page.</div>';
      return;
    }
    bind();
    loadState()
      .then(function () { return Promise.all([loadDvp(), loadAnalysts()]); })
      .then(function () { return loadBoard(); })
      .then(checkOperator)
      .then(function () {
        setInterval(function () {
          if (!document.hidden && current !== 'ST') loadBoard(true).catch(function () {});
        }, POLL_MS);
      })
      .catch(function (err) { console.error('[start-sit]', err); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();