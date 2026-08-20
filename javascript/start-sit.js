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

  var TEAM_ALIAS = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', SD: 'LAC', OAK: 'LV', ARZ: 'ARI' };

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
  function normTeam(t) {
    var c = String(t || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    return TEAM_ALIAS[c] || c;
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

  /* one season's weekly log; maxWeek null = every week */
  function fetchLog(pid, season, maxWeek) {
    return withTimeout(
      fetch('https://api.sleeper.app/stats/nfl/player/' + pid +
            '?season_type=regular&season=' + season + '&grouping=week')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }), 8000, null)
      .then(function (j) {
        var log = [];
        if (j) Object.keys(j).forEach(function (w) {
          var row = j[w];
          var st = row && (row.stats || row);
          if (!st || st.pts_ppr == null) return;
          if (maxWeek != null && Number(w) >= maxWeek) return;
          log.push({
            season: season, week: Number(w), pts: Number(st.pts_ppr),
            opp: (row && (row.opponent || row.opp)) || '', st: st
          });
        });
        return log;
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
      return fetchLog(id, STATE.season, STATE.week)
        .then(function (cur) {
          if (cur.length >= RECENT_GAMES) return cur;
          return fetchLog(id, STATE.season - 1, null)
            .then(function (prev) { return cur.concat(prev); });
        })
        .then(function (all) {
          all.sort(function (a, b) { return b.season - a.season || b.week - a.week; });
          STATS[id] = all.slice(0, 10);
        })
        .catch(function () { STATS[id] = []; });
    })).then(render);
  }

  /* ---------- game log ---------- */
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

    var rows = [], w;
    for (w = STATE.week - RECENT_GAMES; w <= STATE.week - 1; w++) {
      if (w < 1) continue;
      var g = log.filter(function (x) { return x.season === STATE.season && x.week === w; })[0];
      rows.push(g || { week: w, dnp: true });
    }
    var played = rows.filter(function (r) { return !r.dnp; });
    if (!played.length) { rows = log.slice(0, RECENT_GAMES); played = rows; }
    rows.reverse();

    var avg = played.reduce(function (t, g) { return t + g.pts; }, 0) / played.length;

    return '<table class="glog"><caption>Last ' + rows.length + ' weeks</caption>' +
      '<thead><tr><th>Wk</th><th>Opp</th><th>Line</th><th class="n">PPR</th></tr></thead><tbody>' +
      rows.map(function (g) {
        if (g.dnp) {
          return '<tr class="dnp"><td class="wk">' + g.week + '</td>' +
            '<td class="line" colspan="2">Did not play</td><td class="n">\u2014</td></tr>';
        }
        return '<tr><td class="wk">' + g.week +
          (g.season !== STATE.season
            ? '<span style="font-size:9px;color:#5f77a0;margin-left:3px">\u2019' +
              String(g.season).slice(2) + '</span>' : '') + '</td>' +
          '<td class="line">' + esc(g.opp || '\u2014') + '</td>' +
          '<td class="line">' + esc(statLine(pos, g.st)) + '</td>' +
          '<td class="n">' + num(g.pts) + '</td></tr>';
      }).join('') +
      '<tr class="avg"><td class="lbl" colspan="3">Average \u00b7 ' + played.length +
        ' game' + (played.length === 1 ? '' : 's') + '</td>' +
      '<td class="n">' + num(avg) + '</td></tr></tbody></table>';
  }

  /* ---------- defense vs position ---------- */
  function dvpHtml(opp, pos) {
    if (!DVP || !DVP.defense || !opp) return '';
    var code = normTeam(opp);
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

  /* ---------- picks ---------- */
  function onAirPicks(m) {
    return (m.picks || []).filter(function (p) { return p.on_air; });
  }
  function allIn(m) {
    if (!ONAIR.length) return false;
    return onAirPicks(m).length >= ONAIR.length;
  }
  function pickOf(m, pickerId) {
    return (m.picks || []).filter(function (p) { return p.picker_id === pickerId; })[0] || null;
  }

  /* stacked bars — one per on-air picker who chose this side */
  function barsHtml(m, side) {
    var mine = ONAIR.filter(function (a) {
      var p = pickOf(m, a.picker_id);
      return p && p.pick === side;
    });
    if (!mine.length) return '';
    return '<div class="bars">' + mine.map(function (a, i) {
      return '<div class="pickbar' + (a.guest ? ' guest' : '') + '" style="--d:' + (i * 0.12) + 's">' +
        '<span>' + esc(firstName(a.name)) + '</span></div>';
    }).join('') + '</div>';
  }

  function crowdHtml(m, side) {
    if (!allIn(m)) return '';
    var others = (m.picks || []).filter(function (p) { return !p.on_air && p.pick === side; });
    if (!others.length) return '';
    return '<div class="crowd"><span class="crowd-l">' + others.length + ' also picking</span>' +
      others.map(function (p) {
        return '<span class="av" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>';
      }).join('') + '</div>';
  }

  function sideHtml(m, side) {
    var name = m[side + '_name'], team = m[side + '_team'], opp = m[side + '_opp'];
    var pts = m[side + '_points'], pid = m[side + '_player_id'], espn = m[side + '_espn_id'];

    var picked = onAirPicks(m).some(function (p) { return p.pick === side; });
    var cls = 'side ' + side + (picked ? ' picked' : '');
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
      (allIn(m) ? '' : dvpHtml(opp, m.pos)) +
      '<div class="sidefoot">' + crowdHtml(m, side) + barsHtml(m, side) + '</div>' +
    '</div>';
  }

  /* ---------- center column ---------- */
  function chev(dir) {
    var d = dir === 'a' ? 'M9 2 L3.5 8 L9 14' : 'M3 2 L8.5 8 L3 14';
    return '<svg viewBox="0 0 12 16" width="11" height="15">' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function arrow(dir) { return chev(dir) + chev(dir) + chev(dir); }

  function ctlHtml(m) {
    if (!ONAIR.length) return '';
    return '<div class="ctl">' + ONAIR.map(function (a) {
      var p = pickOf(m, a.picker_id);
      return '<div class="ctl-row' + (p ? ' done' : '') + '" data-m="' + m.id +
             '" data-picker="' + a.picker_id + '">' +
        '<button class="ctl-arrow' + (p && p.pick === 'a' ? ' on' : '') + '" data-side="a" ' +
          'aria-label="' + esc(a.name) + ' picks ' + esc(m.a_name) + '">' + arrow('a') + '</button>' +
        '<span class="ctl-name">' + esc(firstName(a.name)) + '</span>' +
        '<button class="ctl-arrow' + (p && p.pick === 'b' ? ' on' : '') + '" data-side="b" ' +
          'aria-label="' + esc(a.name) + ' picks ' + esc(m.b_name) + '">' + arrow('b') + '</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  function centerHtml(m) {
    var picked = onAirPicks(m);
    var waiting = ONAIR.filter(function (a) {
      return !picked.some(function (p) { return p.picker_id === a.picker_id; });
    });
    var note = !ONAIR.length ? 'No pickers set'
      : m.winner ? 'Final'
      : (waiting.length ? 'On the clock' : 'All picks in');

    return '<div class="center">' +
      '<span class="posmark" style="background:var(--' + esc(m.pos) + ')">' + esc(m.pos) + '</span>' +
      '<span class="vs">VS</span>' +
      '<span class="waiting">' + note + '</span>' +
      ctlHtml(m) +
    '</div>';
  }

  /* ---------- render ---------- */
  function matchupFor(pos) {
    return BOARD.matchups.filter(function (m) { return m.pos === pos; })[0] || null;
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
    stage.innerHTML = '<div class="duel">' +
      sideHtml(m, 'a') + centerHtml(m) + sideHtml(m, 'b') + '</div>';
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
      var btn = e.target.closest('.ctl-arrow');
      if (!btn) return;
      var row = btn.closest('.ctl-row');
      if (!row) return;
      /* clicking the side already chosen clears it */
      var clear = btn.classList.contains('on');
      setPick(row.dataset.m, row.dataset.picker, btn.dataset.side, clear);
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