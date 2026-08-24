(function () {
  'use strict';

  var GPX = {
    cfg: null,
    season: null,
    week: null,
    weeks: [],
    seasons: [],
    games: [],
    mine: {},
    tab: 'board',
    standWeek: '',
    busy: {},
    timer: null,
  };

  var TALLYSIGHT = {
    enabled: false,
    render: function (el, game) {
      // el.innerHTML = '<div data-ts-widget="..." data-matchup="'
      //   + game.away_team + '-' + game.home_team + '"></div>';
    },
  };

  var SEASONS = [2026];

  // --------------------------------------------------------------- config

  function sbCfg() {
    if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
      return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
    }
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      return { url: window.SUPABASE_URL, key: window.SUPABASE_ANON_KEY };
    }
    return null;
  }

  function token() {
    try { return localStorage.getItem('sb-auth-token'); } catch (e) { return null; }
  }

  function loggedIn() {
    return typeof auth !== 'undefined'
      && auth.isAuthenticated && auth.isAuthenticated();
  }

  function myProfileId() {
    return (typeof auth !== 'undefined' && auth.user
      && (auth.user.sub || auth.user.id)) || null;
  }

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error('timed out')); }, ms || 12000);
      }),
    ]);
  }

  function rpc(fn, args) {
    var c = GPX.cfg;
    var t = token();
    return withTimeout(
      fetch(c.url + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: {
          apikey: c.key,
          Authorization: 'Bearer ' + (t || c.key),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args || {}),
      }).then(function (r) {
        if (!r.ok) throw new Error(fn + ' ' + r.status);
        return r.json();
      })
    );
  }

  function savePick(row) {
    var c = GPX.cfg;
    return fetch(c.url + '/rest/v1/gp_picks?on_conflict=game_id,profile_id', {
      method: 'POST',
      headers: {
        apikey: c.key,
        Authorization: 'Bearer ' + token(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([row]),
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.status); });
      return r.json();
    });
  }

  // ------------------------------------------------------------- helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function kick(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function signed(n) {
    if (n == null) return '';
    return n > 0 ? '+' + n : String(n);
  }

  function logo(abbr) {
    return 'https://sleepercdn.com/images/team_logos/nfl/'
      + String(abbr || '').toLowerCase() + '.png';
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/)
      .slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function started(g) {
    return new Date(g.kickoff) <= new Date();
  }

  function isFinal(g) {
    return g.home_score != null && g.away_score != null;
  }

  function spreadFor(g, side) {
    if (g.spread_home == null) return '';
    return signed(side === 'home' ? g.spread_home : -g.spread_home);
  }

  function resultTag(res) {
    if (res === 'w') return '<span class="gpx-tag w">W</span>';
    if (res === 'l') return '<span class="gpx-tag l">L</span>';
    if (res === 'p' || res === 't') return '<span class="gpx-tag n">Push</span>';
    return '';
  }

  function pickText(g, market, val) {
    if (!val) return '<span class="gpx-tag n">—</span>';
    if (market === 'ou') {
      return esc((val === 'over' ? 'Over ' : 'Under ') + (g.total == null ? '' : g.total));
    }
    var team = val === 'home' ? g.home_team : g.away_team;
    if (market === 'ats') return esc(team + ' ' + spreadFor(g, val));
    var ml = val === 'home' ? g.ml_home : g.ml_away;
    return esc(team + (ml != null ? ' ' + signed(ml) : ''));
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    GPX.cfg = sbCfg();
    var body = document.getElementById('gpx-body');
    if (!GPX.cfg) {
      body.innerHTML = '<div class="gpx-msg">Picks are unavailable right now.</div>';
      return;
    }

    var params = new URLSearchParams(location.search);
    var qsSeason = parseInt(params.get('season'), 10);
    var qsWeek = parseInt(params.get('week'), 10);

    rpc('gp_display_target', {}).catch(function () { return []; })
      .then(function (target) {
        var now = new Date();
        var fallback = now.getMonth() + 1 >= 3
          ? now.getFullYear() : now.getFullYear() - 1;
        GPX.season = qsSeason || (target[0] ? target[0].season : fallback);
        GPX.week = qsWeek || (target[0] ? target[0].week : 1);
        return loadWeeks();
      })
      .then(function () { return load(); })
      .catch(function (err) {
        body.innerHTML = '<div class="gpx-msg">Could not load picks: '
          + esc(err.message) + '</div>';
      });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPoll(); else startPoll();
    });
  }

  function loadWeeks() {
    return rpc('gp_weeks_public', { p_season: GPX.season }).then(function (ws) {
      GPX.weeks = ws || [];
      if (!GPX.weeks.some(function (w) { return w.week === GPX.week; })
          && GPX.weeks.length) {
        GPX.week = GPX.weeks[GPX.weeks.length - 1].week;
      }
      GPX.seasons = SEASONS.slice();
      renderControls();
    });
  }

  function load() {
    return Promise.all([
      rpc('gp_board', { p_season: GPX.season, p_week: GPX.week }),
      loggedIn()
        ? rpc('gp_my_picks', { p_season: GPX.season, p_week: GPX.week })
            .catch(function () { return []; })
        : Promise.resolve([]),
    ]).then(function (res) {
      GPX.games = res[0] || [];
      GPX.mine = {};
      (res[1] || []).forEach(function (p) { GPX.mine[p.game_id] = p; });
      render();
      startPoll();
    });
  }

  function startPoll() {
    stopPoll();
    GPX.timer = setInterval(function () {
      if (GPX.tab !== 'board' || document.hidden) return;
      rpc('gp_board', { p_season: GPX.season, p_week: GPX.week })
        .then(function (g) { GPX.games = g || []; if (GPX.tab === 'board') renderBoard(); })
        .catch(function () {});
    }, 60000);
  }

  function stopPoll() {
    if (GPX.timer) clearInterval(GPX.timer);
    GPX.timer = null;
  }

  // -------------------------------------------------------------- render

  function renderControls() {
    var ws = document.getElementById('gpx-week');
    var ss = document.getElementById('gpx-season');

    ws.innerHTML = GPX.weeks.length
      ? GPX.weeks.map(function (w) {
          return '<option value="' + w.week + '"'
            + (w.week === GPX.week ? ' selected' : '') + '>'
            + esc(w.label || ('Week ' + w.week))
            + (w.is_display ? ' • current' : '') + '</option>';
        }).join('')
      : '<option>Week ' + GPX.week + '</option>';

    if (GPX.seasons.length < 2) {
      ss.style.display = 'none';
    } else {
      ss.style.display = '';
      ss.innerHTML = GPX.seasons.map(function (y) {
        return '<option value="' + y + '"'
          + (y === GPX.season ? ' selected' : '') + '>' + y + '</option>';
      }).join('');
    }

    ws.onchange = function () {
      GPX.week = parseInt(this.value, 10);
      load();
    };
    ss.onchange = function () {
      GPX.season = parseInt(this.value, 10);
      loadWeeks().then(load);
    };
  }

  function render() {
    var wk = GPX.weeks.filter(function (w) { return w.week === GPX.week; })[0];
    var tabs = [
      { k: 'board', label: (wk && wk.label) || ('Week ' + GPX.week) },
      { k: 'standings', label: 'Standings' },
    ];
    if (loggedIn()) tabs.push({ k: 'me', label: 'My record' });

    document.getElementById('gpx-tabs').innerHTML = tabs.map(function (t) {
      return '<button class="gpx-tab' + (GPX.tab === t.k ? ' on' : '')
        + '" data-tab="' + t.k + '">' + esc(t.label) + '</button>';
    }).join('');

    Array.prototype.forEach.call(
      document.querySelectorAll('#gpx-tabs .gpx-tab'),
      function (b) {
        b.onclick = function () { GPX.tab = b.dataset.tab; render(); };
      }
    );

    if (GPX.tab === 'board') renderBoard();
    else if (GPX.tab === 'standings') renderStandings();
    else renderMe();
  }

  function renderBoard() {
    var body = document.getElementById('gpx-body');
    if (!GPX.games.length) {
      body.innerHTML = '<div class="gpx-msg">No games posted for this week yet.</div>';
      return;
    }

    var cta = loggedIn() ? '' :
      '<div class="gpx-cta">Log in to make your own picks alongside the staff — '
      + 'your record stays private, and the crowd rides as one line in the standings.'
      + '<button id="gpx-login">Log in</button></div>';

    body.innerHTML = cta + '<div class="gpx-grid">'
      + GPX.games.map(gameCard).join('') + '</div>';

    var lb = document.getElementById('gpx-login');
    if (lb) lb.onclick = function () {
      var nav = document.querySelector('.btn-login');
      if (nav) nav.click();
      else location.href = 'login.html';
    };

    Array.prototype.forEach.call(
      body.querySelectorAll('.gpx-opt'),
      function (b) { b.onclick = function () { setPick(b); }; }
    );

    if (TALLYSIGHT.enabled) {
      GPX.games.forEach(function (g) {
        var slot = body.querySelector('[data-tally="' + g.game_id + '"]');
        if (slot) TALLYSIGHT.render(slot, g);
      });
    }
  }

  function gameCard(g) {
    var fin = isFinal(g);
    var live = started(g) && !fin;
    var state = fin ? '<span class="gpx-state final">Final</span>'
      : live ? '<span class="gpx-state live">In progress</span>'
      : '<span class="gpx-state open">Picks open</span>';

    var homeWon = fin && g.home_score > g.away_score;
    var awayWon = fin && g.away_score > g.home_score;

    function side(abbr, score, ml, spread, won, lost) {
      return '<div class="gpx-side' + (won ? ' beat' : '') + (lost ? ' lost' : '') + '">'
        + '<img src="' + logo(abbr) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        + '<span class="gpx-abbr">' + esc(abbr) + '</span>'
        + '<span class="gpx-line">' + (spread ? esc(spread) : '')
        + (ml != null ? '<br>' + esc(signed(ml)) : '') + '</span>'
        + (fin ? '<span class="gpx-score">' + score + '</span>' : '')
        + '</div>';
    }

    return '<div class="gpx-game">'
      + '<div class="gpx-when">' + esc(kick(g.kickoff)) + state + '</div>'
      + '<div class="gpx-teams">'
      + side(g.away_team, g.away_score, g.ml_away, spreadFor(g, 'away'), awayWon, homeWon)
      + side(g.home_team, g.home_score, g.ml_home, spreadFor(g, 'home'), homeWon, awayWon)
      + '</div>'
      + (g.total != null
          ? '<div class="gpx-total">Total ' + esc(g.total)
            + (fin ? ' — scored ' + (g.home_score + g.away_score) : '') + '</div>'
          : '')
      + (TALLYSIGHT.enabled
          ? '<div class="gpx-tally" data-tally="' + g.game_id + '"></div>' : '')
      + myControls(g)
      + picksBlock(g)
      + '</div>';
  }

  function myControls(g) {
    if (!loggedIn()) return '';
    var p = GPX.mine[g.game_id] || {};
    var off = started(g);

    function market(field, label, opts) {
      var cur = p[field] || null;
      return '<div class="gpx-mrow"><span class="gpx-mlabel">' + label + '</span>'
        + opts.map(function (o) {
            return '<button class="gpx-opt' + (cur === o[0] ? ' on' : '') + '"'
              + ' data-game="' + g.game_id + '" data-field="' + field + '"'
              + ' data-val="' + o[0] + '"' + (off || o[2] ? ' disabled' : '') + '>'
              + esc(o[1]) + '</button>';
          }).join('')
        + '</div>';
    }

    return '<div class="gpx-mine">'
      + market('ml_pick', 'ML', [
          ['away', g.away_team + (g.ml_away != null ? ' ' + signed(g.ml_away) : ''), false],
          ['home', g.home_team + (g.ml_home != null ? ' ' + signed(g.ml_home) : ''), false],
        ])
      + market('ats_pick', 'Spread', [
          ['away', g.away_team + ' ' + spreadFor(g, 'away'), g.spread_home == null],
          ['home', g.home_team + ' ' + spreadFor(g, 'home'), g.spread_home == null],
        ])
      + market('ou_pick', 'Total', [
          ['over', 'Over ' + (g.total == null ? '' : g.total), g.total == null],
          ['under', 'Under ' + (g.total == null ? '' : g.total), g.total == null],
        ])
      + '</div>';
  }

  function picksBlock(g) {
    if (!g.revealed) {
      return '<div class="gpx-picks"><div class="gpx-ptitle">Staff picks</div>'
        + '<div class="gpx-sealed">Sealed until kickoff.</div></div>';
    }

    var staff = g.staff_picks || [];
    var fan = g.fan_pick || {};

    var rows = staff.map(function (s) {
      return '<div class="gpx-prow">'
        + '<span class="gpx-av">'
        + (s.headshot ? '<img src="' + esc(s.headshot) + '" alt="">' : esc(initials(s.name)))
        + '</span>'
        + '<span class="gpx-pname">' + esc(s.name) + '</span>'
        + '<span>' + pickText(g, 'ml', s.ml) + '</span>' + resultTag(s.ml_res)
        + '<span>' + pickText(g, 'ats', s.ats) + '</span>' + resultTag(s.ats_res)
        + '<span>' + pickText(g, 'ou', s.ou) + '</span>' + resultTag(s.ou_res)
        + '</div>';
    }).join('');

    var fanRow = '';
    if (fan && (fan.ml || fan.ats || fan.ou)) {
      var n = Math.max(fan.ml_n || 0, fan.ats_n || 0, fan.ou_n || 0);
      fanRow = '<div class="gpx-prow gpx-crowd">'
        + '<span class="gpx-av">FP</span>'
        + '<span class="gpx-pname">Fan Picks<span class="gpx-tag n" '
        + 'style="margin-left:6px">' + n + '</span></span>'
        + '<span>' + pickText(g, 'ml', fan.ml) + '</span>' + resultTag(fan.ml_res)
        + '<span>' + pickText(g, 'ats', fan.ats) + '</span>' + resultTag(fan.ats_res)
        + '<span>' + pickText(g, 'ou', fan.ou) + '</span>' + resultTag(fan.ou_res)
        + '</div>';
    }

    return '<div class="gpx-picks"><div class="gpx-ptitle">Picks</div>'
      + (rows || '<div class="gpx-sealed">No staff picks logged.</div>')
      + fanRow + '</div>';
  }

  // ---------------------------------------------------------------- picks

  function setPick(btn) {
    var gameId = btn.dataset.game;
    var field = btn.dataset.field;
    var val = btn.dataset.val;
    var key = gameId + ':' + field;
    if (GPX.busy[key]) return;
    GPX.busy[key] = true;

    var prev = GPX.mine[gameId] || {};
    var next = {};
    Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
    next[field] = prev[field] === val ? null : val;
    GPX.mine[gameId] = next;

    var group = btn.parentElement;
    Array.prototype.forEach.call(group.querySelectorAll('.gpx-opt'), function (b) {
      b.classList.toggle('on', b.dataset.val === next[field]);
    });

    savePick({
      game_id: Number(gameId),
      profile_id: myProfileId(),
      ml_pick: next.ml_pick || null,
      ats_pick: next.ats_pick || null,
      ou_pick: next.ou_pick || null,
      updated_at: new Date().toISOString(),
    }).then(function (saved) {
      if (saved && saved[0]) GPX.mine[gameId] = saved[0];
    }).catch(function (err) {
      GPX.mine[gameId] = prev;
      Array.prototype.forEach.call(group.querySelectorAll('.gpx-opt'), function (b) {
        b.classList.toggle('on', b.dataset.val === (prev[field] || null));
      });
      alert('That pick did not save. If the game has kicked off, picks are closed.');
      console.error(err);
    }).then(function () { GPX.busy[key] = false; });
  }

  // ------------------------------------------------------------ standings

  function renderStandings() {
    var body = document.getElementById('gpx-body');
    body.innerHTML = '<div class="gpx-msg">Loading standings…</div>';

    var args = { p_season: GPX.season };
    if (GPX.standWeek) args.p_week = Number(GPX.standWeek);

    rpc('gp_standings', args).then(function (rows) {
      var opts = '<option value="">Full season</option>'
        + GPX.weeks.map(function (w) {
            return '<option value="' + w.week + '"'
              + (String(w.week) === String(GPX.standWeek) ? ' selected' : '')
              + '>Week ' + w.week + '</option>';
          }).join('');

      var trs = (rows || []).map(function (r, i) {
        return '<tr' + (r.is_fan ? ' class="gpx-fan"' : '') + '>'
          + '<td>' + (i + 1) + '</td>'
          + '<td>' + esc(r.name) + '</td>'
          + '<td>' + r.ml_w + '-' + r.ml_l + (r.ml_t ? '-' + r.ml_t : '') + '</td>'
          + '<td>' + r.ats_w + '-' + r.ats_l + (r.ats_p ? '-' + r.ats_p : '') + '</td>'
          + '<td>' + r.ou_w + '-' + r.ou_l + (r.ou_p ? '-' + r.ou_p : '') + '</td>'
          + '<td><b>' + r.tot_w + '-' + r.tot_l + '</b></td>'
          + '<td>' + (Number(r.pct) * 100).toFixed(1) + '%</td>'
          + '</tr>';
      }).join('');

      body.innerHTML = '<div class="gpx-controls" style="margin-bottom:14px">'
        + '<select id="gpx-sw">' + opts + '</select></div>'
        + '<table><thead><tr><th>#</th><th>Name</th><th>ML</th><th>Spread</th>'
        + '<th>Total</th><th>Overall</th><th>Pct</th></tr></thead>'
        + '<tbody>' + (trs || '<tr><td colspan="7">Nothing graded yet.</td></tr>')
        + '</tbody></table>';

      document.getElementById('gpx-sw').onchange = function () {
        GPX.standWeek = this.value;
        renderStandings();
      };
    }).catch(function (err) {
      body.innerHTML = '<div class="gpx-msg">Could not load standings.</div>';
      console.error(err);
    });
  }

  function renderMe() {
    var body = document.getElementById('gpx-body');
    body.innerHTML = '<div class="gpx-msg">Loading your record…</div>';

    rpc('gp_my_record', { p_season: GPX.season }).then(function (rows) {
      if (!rows || !rows.length) {
        body.innerHTML = '<div class="gpx-msg">No graded picks yet this season. '
          + 'Make some picks and check back after the games.</div>';
        return;
      }
      var t = { ml_w: 0, ml_l: 0, ats_w: 0, ats_l: 0, ou_w: 0, ou_l: 0, tot_w: 0, tot_l: 0 };
      rows.forEach(function (r) {
        Object.keys(t).forEach(function (k) { t[k] += Number(r[k] || 0); });
      });
      var pct = (t.tot_w + t.tot_l)
        ? (t.tot_w / (t.tot_w + t.tot_l) * 100).toFixed(1) : '0.0';

      body.innerHTML = '<table><thead><tr><th>Week</th><th>ML</th><th>Spread</th>'
        + '<th>Total</th><th>Overall</th><th>Pct</th></tr></thead><tbody>'
        + rows.map(function (r) {
            return '<tr><td>Week ' + r.week + '</td>'
              + '<td>' + r.ml_w + '-' + r.ml_l + '</td>'
              + '<td>' + r.ats_w + '-' + r.ats_l + '</td>'
              + '<td>' + r.ou_w + '-' + r.ou_l + '</td>'
              + '<td><b>' + r.tot_w + '-' + r.tot_l + '</b></td>'
              + '<td>' + (Number(r.pct) * 100).toFixed(1) + '%</td></tr>';
          }).join('')
        + '<tr class="gpx-fan"><td>Season</td>'
        + '<td>' + t.ml_w + '-' + t.ml_l + '</td>'
        + '<td>' + t.ats_w + '-' + t.ats_l + '</td>'
        + '<td>' + t.ou_w + '-' + t.ou_l + '</td>'
        + '<td><b>' + t.tot_w + '-' + t.tot_l + '</b></td>'
        + '<td>' + pct + '%</td></tr></tbody></table>';
    }).catch(function (err) {
      body.innerHTML = '<div class="gpx-msg">Could not load your record.</div>';
      console.error(err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
