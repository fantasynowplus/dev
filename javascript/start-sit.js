(function () {
  'use strict';

  var POLL_MS      = 12000;
  var RECENT_GAMES = 3;
  var DVP_URL      = 'data/dvp.json';
  var POSITIONS    = ['QB', 'RB', 'WR', 'TE'];

  var SB_URL = '', SB_KEY = '';
  var STATE    = { season: null, week: null };
  var BOARD    = { week: null, matchups: [] };
  var ONAIR    = [];
  var DVP      = null;
  var STATS    = {};
  var CAN_EDIT = false;
  var current  = 'QB';
  var busy     = {};

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
  function lastName(n) {
    var p = String(n || '').trim().split(/\s+/);
    return p.length > 1 ? p[p.length - 1] : p[0];
  }
  function num(v, d) { var x = Number(v); return isFinite(x) ? x.toFixed(d == null ? 1 : d) : '\u2014'; }
  function ordinal(n) {
    n = Number(n); if (!isFinite(n)) return '';
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function withTimeout(p, ms, fallback) {
    return Promise.race([p, new Promise(function (res) {
      setTimeout(function () { res(fallback); }, ms || 6000);
    })]);
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
    var qsSeason = Number(qs.get('season'));
    var qsWeek   = Number(qs.get('week'));

    return rpc('ss_display_target').catch(function () { return null; })
      .then(function (rows) {
        var d = rows && rows[0];
        if (d && !qsSeason && !qsWeek) {
          STATE.season = Number(d.season);
          STATE.week   = Number(d.week);
          return;
        }
        return withTimeout(
          fetch('https://api.sleeper.app/v1/state/nfl')
            .then(function (r) { return r.json(); })
            .catch(function () { return {}; }), 6000, {})
          .then(function (s) {
            var fallback = Number(s.display_week || s.week) || 1;
            STATE.season = qsSeason || (d && Number(d.season)) || Number(s.season) || new Date().getFullYear();
            if (qsWeek) { STATE.week = qsWeek; return; }
            return rpc('ss_current_week', { p_season: STATE.season })
              .then(function (w) { STATE.week = Number(w) || fallback; })
              .catch(function () { STATE.week = fallback; });
          });
      });
  }

  function loadDvp() {
    return fetch(DVP_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { DVP = j; })
      .catch(function () { DVP = null; });
  }

  function loadOnAir() {
    return rpc('ss_onair', { p_season: STATE.season, p_week: STATE.week })
      .then(function (r) { ONAIR = r || []; })
      .catch(function () { ONAIR = []; });
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
      return withTimeout(
        fetch('https://api.sleeper.app/stats/nfl/player/' + id +
              '?season_type=regular&season=' + STATE.season + '&grouping=week')
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; }), 8000, null)
        .then(function (j) {
          var log = [];
          if (j) Object.keys(j).forEach(function (w) {
            var row = j[w];
            var st = row && (row.stats || row);
            if (!st || st.pts_ppr == null || Number(w) >= STATE.week) return;
            log.push({
              week: Number(w),
              pts: Number(st.pts_ppr),
              opp: row && (row.opponent || row.opp) || '',
              st: st
            });
          });
          log.sort(function (a, b) { return b.week - a.week; });
          STATS[id] = log.slice(0, RECENT_GAMES);
        })
        .catch(function () { STATS[id] = []; });
    })).then(render);
  }

  /* ---------- render: game log ---------- */
  function statLine(pos, st) {
    function v(k) { return Number(st[k] || 0); }
    var out = [];
    if (pos === 'QB') {
      out.push(v('pass_yd') + ' pass');
      if (v('rush_yd')) out.push(v('rush_yd') + ' rush');
      var td = v('pass_td') + v('rush_td');
      if (td) out.push(td + ' TD');
      if (v('pass_int')) out.push(v('pass_int') + ' INT');
    } else if (pos === 'RB') {
      out.push(v('rush_yd') + ' rush');
      if (v('rec')) out.push(v('rec') + '-' + v('rec_yd') + ' rec');
      var td2 = v('rush_td') + v('rec_td');
      if (td2) out.push(td2 + ' TD');
    } else {
      out.push(v('rec') + ' rec');
      out.push(v('rec_yd') + ' yd');
      if (v('rec_td')) out.push(v('rec_td') + ' TD');
    }
    return out.join(' \u00b7 ');
  }

  function glogHtml(pid, pos) {
    var log = STATS[pid];
    if (!log) return '<div class="glog-empty">Loading recent games\u2026</div>';
    if (!log.length) return '<div class="glog-empty">No games played yet this season.</div>';

    var avg = log.reduce(function (t, g) { return t + g.pts; }, 0) / log.length;
    return '<table class="glog"><caption>Last ' + log.length + ' games</caption>' +
      '<thead><tr><th>Wk</th><th>Opp</th><th>Line</th><th class="n">PPR</th></tr></thead><tbody>' +
      log.map(function (g) {
        return '<tr><td class="wk">' + g.week + '</td>' +
          '<td class="line">' + esc(g.opp || '\u2014') + '</td>' +
          '<td class="line">' + esc(statLine(pos, g.st)) + '</td>' +
          '<td class="n">' + num(g.pts) + '</td></tr>';
      }).join('') +
      '<tr class="avg"><td class="lbl" colspan="3">' + log.length + '-game average</td>' +
      '<td class="n">' + num(avg) + '</td></tr>' +
      '</tbody></table>';
  }

  /* ---------- render: defense vs position ---------- */
  function dvpHtml(opp, pos) {
    if (!DVP || !DVP.defense || !opp) return '';
    var code = String(opp).replace(/[^A-Za-z]/g, '').toUpperCase();
    var d = DVP.defense[code] && DVP.defense[code][pos];
    if (!d) return '';

    var l3   = d.l3_ppg != null ? d.l3_ppg : d.ppg;
    var rank = d.l3_rank != null ? d.l3_rank : d.rank;
    var cls  = rank <= 10 ? 'soft' : (rank >= 23 ? 'tough' : 'mid');

    return '<div class="dvp">' +
      '<div class="dvp-h">' + esc(code) + ' allowed to ' + esc(pos) + 's \u00b7 last 3</div>' +
      '<div class="dvp-v">' +
        '<span class="dvp-n">' + num(l3) + '</span>' +
        '<span class="dvp-u">PPG</span>' +
        '<span class="dvp-r ' + cls + '">' + ordinal(rank) + ' most</span>' +
      '</div>' +
      (d.ppg != null ? '<div class="dvp-s">Season: ' + num(d.ppg) + ' PPG' +
        (d.rank != null ? ' \u00b7 ' + ordinal(d.rank) + ' most' : '') + '</div>' : '') +
    '</div>';
  }

  /* ---------- render: sides ---------- */
  function onAirPicks(m) {
    return (m.picks || []).filter(function (p) { return p.on_air; });
  }
  function allIn(m) {
    if (!ONAIR.length) return true;
    return onAirPicks(m).length >= ONAIR.length;
  }

  function crowdHtml(m, side) {
    if (!allIn(m)) return '';
    var others = (m.picks || []).filter(function (p) { return !p.on_air && p.pick === side; });
    if (!others.length) return '';
    return '<div class="crowd"><span class="crowd-l">' + others.length + ' staff</span>' +
      others.map(function (p) {
        return '<span class="av" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>';
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
      (pts != null ? '<div class="final">' + num(pts) + '</div>' : '') +
      '<div class="idrow">' +
        (shot ? '<img class="shot" src="' + shot + '" alt="" data-fallback="' + fb + '">'
              : '<div class="shot"></div>') +
        '<div>' +
          '<h2 class="pname">' + esc(name) + '</h2>' +
          '<p class="pmeta">' + esc(m.pos) + (team ? ' \u00b7 ' + esc(team) : '') + '</p>' +
          (oppTxt ? '<span class="opp">' + esc(oppTxt) + '</span>' : '') +
        '</div>' +
      '</div>' +
      glogHtml(pid, m.pos) +
      dvpHtml(opp, m.pos) +
      crowdHtml(m, side) +
    '</div>';
  }

  function centerHtml(m) {
    var picked = onAirPicks(m);
    var waiting = ONAIR.filter(function (a) {
      return !picked.some(function (p) { return p.picker_id === a.picker_id; });
    });
    var note = !ONAIR.length ? 'No pickers set'
      : m.winner ? 'Final'
      : (waiting.length ? 'On the clock<br>' + waiting.map(function (a) { return esc(firstName(a.name)); }).join(' &middot; ')
                        : 'All picks in');
    return '<div class="center">' +
      '<span class="posmark" style="background:var(--' + esc(m.pos) + ')">' + esc(m.pos) + '</span>' +
      '<span class="vs">VS</span>' +
      '<span class="waiting">' + note + '</span>' +
    '</div>';
  }

  /* ---------- render: pick rail ---------- */
  function railHtml(m) {
    if (!ONAIR.length) return '';
    var rows = ONAIR.map(function (a) {
      var mine = (m.picks || []).filter(function (p) { return p.picker_id === a.picker_id; })[0];
      var cls = 'rail-chip' + (a.guest ? ' guest' : '');
      var to = '';
      if (mine) {
        cls += ' picked to-' + mine.pick;
        to = '<span class="to">' + esc(lastName(m[mine.pick + '_name'])) + '</span>';
      }
      return '<div class="rail-row" data-m="' + m.id + '" data-picker="' + a.picker_id + '">' +
        '<div class="rail-track">' +
          '<button class="rail-zone a" data-side="a" aria-label="' + esc(a.name) + ' picks ' + esc(m.a_name) + '"></button>' +
          '<button class="rail-zone b" data-side="b" aria-label="' + esc(a.name) + ' picks ' + esc(m.b_name) + '"></button>' +
          '<span class="' + cls + '" data-clear="1">' +
            '<span class="who">' + esc(firstName(a.name)) + '</span>' + to +
          '</span>' +
        '</div></div>';
    }).join('');

    return '<div class="rail"><div class="rail-h">On-air picks</div>' + rows +
      '<div class="rail-hint">Click a side to set a pick \u00b7 click the name to clear</div></div>';
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
    stage.innerHTML =
      '<div class="duel">' + sideHtml(m, 'a') + centerHtml(m) + sideHtml(m, 'b') + '</div>' +
      railHtml(m);
  }

  function matchupFor(pos) {
    return BOARD.matchups.filter(function (m) { return m.pos === pos; })[0] || null;
  }

  function renderStandings(stage) {
    el('subTitle').innerHTML = 'Season ' + STATE.season + ' &middot; <span class="pos">Standings</span>';
    stage.innerHTML = '<div class="state">Loading standings&hellip;</div>';
    rpc('ss_standings', { p_season: STATE.season }).then(function (rows) {
      if (!rows || !rows.length) {
        stage.innerHTML = '<div class="state">No scored picks yet this season.</div>';
        return;
      }
      stage.innerHTML = '<div class="scroller"><table class="st"><thead><tr>' +
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
  function setPick(matchupId, pickerId, side, clear) {
    var key = matchupId + pickerId;
    if (busy[key]) return;
    var tok = authToken();
    if (!tok) return;
    busy[key] = true;

    var m = BOARD.matchups.filter(function (x) { return x.id === matchupId; })[0];
    if (m) {
      m.picks = (m.picks || []).filter(function (p) { return p.picker_id !== pickerId; });
      if (!clear) {
        var a = ONAIR.filter(function (x) { return x.picker_id === pickerId; })[0];
        m.picks.push({ picker_id: pickerId, name: a ? a.name : '', pick: side,
                       on_air: true, guest: a ? a.guest : false });
      }
      render();
    }

    var req = clear
      ? fetch(SB_URL + '/rest/v1/ss_picks?matchup_id=eq.' + matchupId + '&picker_id=eq.' + pickerId, {
          method: 'DELETE',
          headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok }
        })
      : fetch(SB_URL + '/rest/v1/ss_picks?on_conflict=matchup_id,picker_id', {
          method: 'POST',
          headers: {
            apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify({
            matchup_id: matchupId, picker_id: pickerId, pick: side,
            updated_at: new Date().toISOString()
          })
        });

    req.then(function (r) { if (!r.ok) throw new Error('pick ' + r.status); })
      .catch(function (e) { console.error('[start-sit] pick failed', e); })
      .then(function () { busy[key] = false; return loadBoard(true); });
  }

  function checkOperator() {
    var tok = authToken();
    if (!tok) return Promise.resolve();
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

  window.reload = function () { STATS = {}; loadBoard(); };

  function bind() {
    document.addEventListener('click', function (e) {
      if (!CAN_EDIT || !e.target.closest) return;
      var row = e.target.closest('.rail-row');
      if (!row) return;

      var chip = e.target.closest('.rail-chip');
      if (chip) { setPick(row.dataset.m, row.dataset.picker, null, true); return; }

      var zone = e.target.closest('.rail-zone');
      if (zone) setPick(row.dataset.m, row.dataset.picker, zone.dataset.side, false);
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
      .then(function () { return Promise.all([loadDvp(), loadOnAir()]); })
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