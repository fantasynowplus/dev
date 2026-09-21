(function () {
  'use strict';

  var SB_URL = '', SB_KEY = '';

  var RULESETS = {
    classic: {
      cap: 50000,
      slots: [
        { key: 'QB',   label: 'QB',   eligible: ['QB'] },
        { key: 'RB1',  label: 'RB',   eligible: ['RB'] },
        { key: 'RB2',  label: 'RB',   eligible: ['RB'] },
        { key: 'WR1',  label: 'WR',   eligible: ['WR'] },
        { key: 'WR2',  label: 'WR',   eligible: ['WR'] },
        { key: 'WR3',  label: 'WR',   eligible: ['WR'] },
        { key: 'TE',   label: 'TE',   eligible: ['TE'] },
        { key: 'FLEX', label: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
        { key: 'DST',  label: 'DST',  eligible: ['DST'] }
      ]
    },
    showdown: {
      cap: 50000,
      slots: [
        { key: 'CPT',   label: 'CPT',  eligible: ['QB', 'RB', 'WR', 'TE', 'DST'], mult: 1.5 },
        { key: 'UTIL1', label: 'UTIL', eligible: ['QB', 'RB', 'WR', 'TE', 'DST'] },
        { key: 'UTIL2', label: 'UTIL', eligible: ['QB', 'RB', 'WR', 'TE', 'DST'] },
        { key: 'UTIL3', label: 'UTIL', eligible: ['QB', 'RB', 'WR', 'TE', 'DST'] },
        { key: 'UTIL4', label: 'UTIL', eligible: ['QB', 'RB', 'WR', 'TE', 'DST'] },
        { key: 'UTIL5', label: 'UTIL', eligible: ['QB', 'RB', 'WR', 'TE', 'DST'] }
      ]
    }
  };

  var CONTEST_TYPE = 'classic';
  var SLATES = [];
  var ACTIVE_SLATE = null;
  var PLAYERS = [];
  var ROSTER = {};
  var CARD_PLAYER = null;
  var SEASON = null;

  function el(id) { return document.getElementById(id); }
  var INJ_TAG = { Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS', NA: 'NA', COV: 'COV' };
  function injBadge(status) {
    if (!status || !INJ_TAG[status]) return '';
    return '<span class="injtag ' + status + '">' + INJ_TAG[status] + '</span>';
  }
  var OWN_TIERS = [
    { key: 'chalk', label: 'CHALK', min: 25 },
    { key: 'moderate', label: 'MOD', min: 10 },
    { key: 'low', label: 'LOW', min: 3 },
    { key: 'contrarian', label: 'CONTRA', min: 0 }
  ];
  var OWN_FILTER = 'ALL';
  function ownershipTier(pct) {
    if (pct == null) return null;
    for (var i = 0; i < OWN_TIERS.length; i++) {
      if (pct >= OWN_TIERS[i].min) return OWN_TIERS[i];
    }
    return null;
  }
  function ownBadge(pct) {
    var tier = ownershipTier(pct);
    if (!tier) return '';
    return '<span class="owntag ' + tier.key + '">' + tier.label + '</span>';
  }
  window.setOwnFilter = function (key) {
    OWN_FILTER = key;
    document.querySelectorAll('.ownpills button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tier') === key);
    });
    draw();
  };
  function playerMatchupKey(p) {
    if (!p.opponent || !p.team) return null;
    var opp = String(p.opponent).trim();
    var away, home;
    if (/^@/.test(opp)) {
      away = p.team; home = opp.replace(/^@\s*/, '');
    } else {
      home = p.team; away = opp.replace(/^vs\s*/i, '');
    }
    if (!away || !home) return null;
    return away + ' @ ' + home;
  }
  function populateGameFilter() {
    var seen = {};
    var games = [];
    PLAYERS.forEach(function (p) {
      var key = playerMatchupKey(p);
      if (key && !seen[key]) { seen[key] = true; games.push(key); }
    });
    games.sort();
    var sel = el('gameFilter');
    var current = sel.value;
    sel.innerHTML = '<option value="ALL">All Games</option>' +
      games.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join('');
    sel.value = games.indexOf(current) !== -1 ? current : 'ALL';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US'); }
  function initials(name) {
    var parts = String(name || '').split(' ').filter(Boolean);
    return ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
  }

  function withTimeout(p, ms, fallback) {
    return Promise.race([p, new Promise(function (res) {
      setTimeout(function () { res(fallback); }, ms || 8000);
    })]);
  }

  function sbCfg() {
    return {
      url: (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : '',
      key: (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : ''
    };
  }

  function sbGet(path) {
    return withTimeout(
      fetch(SB_URL + '/rest/v1/' + path, { headers: { apikey: SB_KEY } })
        .then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); }),
      8000, []
    );
  }

  function resetRoster() {
    ROSTER = {};
    RULESETS[CONTEST_TYPE].slots.forEach(function (s) { ROSTER[s.key] = null; });
  }

  function currentRuleset() { return RULESETS[CONTEST_TYPE]; }
  function slotEligible(slot, player) { return slot.eligible.indexOf(player.position) !== -1; }

  function isRostered(dkPlayerId) {
    return Object.keys(ROSTER).some(function (k) { return ROSTER[k] && ROSTER[k].dk_player_id === dkPlayerId; });
  }

  function removeFromRoster(dkPlayerId) {
    Object.keys(ROSTER).forEach(function (k) {
      if (ROSTER[k] && ROSTER[k].dk_player_id === dkPlayerId) ROSTER[k] = null;
    });
  }

  function addToRoster(player) {
    var slots = currentRuleset().slots;
    for (var i = 0; i < slots.length; i++) {
      if (!ROSTER[slots[i].key] && slotEligible(slots[i], player)) {
        ROSTER[slots[i].key] = player;
        return true;
      }
    }
    return false;
  }

  function toggleRoster(player) {
    if (isRostered(player.dk_player_id)) removeFromRoster(player.dk_player_id);
    else addToRoster(player);
    drawRoster();
    draw();
  }

  window.clearRoster = function () { resetRoster(); drawRoster(); draw(); };

  function rosterCost() {
    var total = 0;
    currentRuleset().slots.forEach(function (s) {
      var p = ROSTER[s.key];
      if (p) total += p.salary * (s.mult || 1);
    });
    return total;
  }

  function drawRoster() {
    var cap = currentRuleset().cap;
    var used = rosterCost();
    el('capUsed').textContent = money(used);
    el('capTotal').textContent = money(cap);
    var bar = el('capBar');
    bar.style.width = Math.min(100, (used / cap) * 100) + '%';
    bar.className = used > cap ? 'over' : '';

    el('rosterSlots').innerHTML = currentRuleset().slots.map(function (s) {
      var p = ROSTER[s.key];
      if (!p) {
        return '<div class="slotrow empty" data-slot="' + s.key + '">' +
          '<span class="slotlabel">' + s.label + '</span>' +
          '<span class="slotname">Empty</span><span class="slotsal"></span></div>';
      }
      var sal = Math.round(p.salary * (s.mult || 1));
      return '<div class="slotrow" data-slot="' + s.key + '">' +
        '<span class="slotlabel">' + s.label + '</span>' +
        '<span class="slotname">' + esc(p.name) + (s.mult ? ' (1.5x)' : '') + '</span>' +
        '<span class="slotsal">' + money(sal) + '</span></div>';
    }).join('');

    el('rosterSlots').querySelectorAll('.slotrow').forEach(function (row) {
      row.addEventListener('click', function () {
        var key = row.getAttribute('data-slot');
        if (ROSTER[key]) { ROSTER[key] = null; drawRoster(); draw(); }
      });
    });
  }

  window.draw = function () {
    var pos = el('posFilter').value;
    var q = el('q').value.trim().toLowerCase();
    var salLo = Number(el('salMin').value), salHi = Number(el('salMax').value);
    var game = el('gameFilter').value;

    var rows = PLAYERS.filter(function (p) {
      if (pos !== 'ALL' && p.position !== pos) return false;
      if (q && p.name.toLowerCase().indexOf(q) === -1 && (p.team || '').toLowerCase().indexOf(q) === -1) return false;
      if (p.salary != null && (p.salary < salLo || p.salary > salHi)) return false;
      if (game !== 'ALL' && playerMatchupKey(p) !== game) return false;
      if (OWN_FILTER !== 'ALL') {
        var t = ownershipTier(p.ownership_pct);
        if (!t || t.key !== OWN_FILTER) return false;
      }
      return true;
    });

    el('count').textContent = rows.length + ' players';

    if (!rows.length) {
      el('body').innerHTML = '<tr><td class="state" colspan="8">No players match.</td></tr>';
      return;
    }

    el('body').innerHTML = rows.map(function (p) {
      var rostered = isRostered(p.dk_player_id);
      return '<tr class="row ' + (rostered ? 'rostered' : '') + '" data-id="' + p.dk_player_id + '">' +
        '<td><span class="pospill ' + p.position + '">' + p.position + '</span></td>' +
        '<td class="player">' + esc(p.name) +
          injBadge(p.injury_status) +
          '</td>' +
        '<td>' + esc(p.team || '') + '</td>' +
        '<td>' + esc(p.opponent || '') + '</td>' +
        '<td>' + money(p.salary) + '</td>' +
        '<td>' + (p.projected_points != null ? Number(p.projected_points).toFixed(1) : '<span class="dim">&mdash;</span>') + '</td>' +
        '<td>' + (p.ownership_pct != null ? '<span class="ownwrap"><span class="ownnum">' + Number(p.ownership_pct).toFixed(1) + '%</span>' + ownBadge(p.ownership_pct) + '</span>' : '<span class="dim">&mdash;</span>') + '</td>' +
        '<td><button class="addbtn ' + (rostered ? 'remove' : '') + '" data-act="' + p.dk_player_id + '">' +
          (rostered ? '\u2212' : '+') + '</button></td>' +
        '</tr>';
    }).join('');

    el('body').querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = Number(btn.getAttribute('data-act'));
        var player = PLAYERS.filter(function (p) { return p.dk_player_id === id; })[0];
        if (player) toggleRoster(player);
      });
    });

    el('body').querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var id = Number(tr.getAttribute('data-id'));
        var player = PLAYERS.filter(function (p) { return p.dk_player_id === id; })[0];
        if (player) openCard(player);
      });
    });
  }

  function fetchSeasonLog(sleeperId) {
    if (!SEASON || !sleeperId) return Promise.resolve([]);
    return withTimeout(
      fetch('https://api.sleeper.app/stats/nfl/player/' + sleeperId +
            '?season_type=regular&season=' + SEASON + '&grouping=week')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      8000, null
    ).then(function (j) {
      var log = [];
      if (j) Object.keys(j).forEach(function (w) {
        var row = j[w];
        var st = row && (row.stats || row);
        if (!st || st.pts_ppr == null) return;
        log.push({ week: Number(w), opp: (row && (row.opponent || row.opp)) || '', pts: Number(st.pts_ppr), st: st });
      });
      log.sort(function (a, b) { return a.week - b.week; });
      return log;
    });
  }

  var LOG_COLUMNS = {
    QB: [
      { label: 'CMP/ATT', get: function (st) { return (st.pass_cmp != null && st.pass_att != null) ? st.pass_cmp + '/' + st.pass_att : null; } },
      { label: 'YDS', key: 'pass_yd' },
      { label: 'TD', key: 'pass_td' },
      { label: 'INT', key: 'pass_int' },
      { label: 'RSH YDS', key: 'rush_yd' },
      { label: 'RSH TD', key: 'rush_td' }
    ],
    RB: [
      { label: 'ATT', key: 'rush_att' },
      { label: 'YDS', key: 'rush_yd' },
      { label: 'TD', key: 'rush_td' },
      { label: 'REC', key: 'rec' },
      { label: 'REC YDS', key: 'rec_yd' },
      { label: 'REC TD', key: 'rec_td' }
    ],
    WR: [
      { label: 'TAR', key: 'rec_tgt' },
      { label: 'REC', key: 'rec' },
      { label: 'YDS', key: 'rec_yd' },
      { label: 'TD', key: 'rec_td' }
    ]
  };
  LOG_COLUMNS.TE = LOG_COLUMNS.WR;

  function openCard(player) {
    CARD_PLAYER = player;
    var shot = el('cardShot');
    shot.style.display = '';
    el('cardInitials').style.display = 'none';
    shot.onerror = function () { shot.style.display = 'none'; el('cardInitials').style.display = 'block'; };
    shot.src = player.position === 'DST'
      ? 'https://sleepercdn.com/images/team_logos/nfl/' + (player.team || '').toLowerCase() + '.png'
      : (player.sleeper_id ? 'https://sleepercdn.com/content/nfl/players/thumb/' + player.sleeper_id + '.jpg' : '');
    el('cardInitials').textContent = initials(player.name);
    el('cardName').textContent = player.name;
    el('cardSub').innerHTML = player.position + '<span class="dot">&middot;</span>' +
      esc(player.team || '') + '<span class="dot">&middot;</span>' + esc(player.opponent || '') +
      injBadge(player.injury_status);

    var value = player.projected_points != null && player.salary
      ? ((player.projected_points / player.salary) * 1000).toFixed(2) : null;

    el('cardRanks').innerHTML =
      '<div class="rank"><div class="n">' + money(player.salary) + '</div><div class="l">Salary</div></div>' +
      '<div class="rank hi"><div class="n">' + (player.projected_points != null ? Number(player.projected_points).toFixed(1) : '&mdash;') + '</div><div class="l">Proj Pts</div></div>' +
      '<div class="rank"><div class="n">' + (value || '&mdash;') + '<span class="u">pts/$1k</span></div><div class="l">Value</div></div>' +
      '<div class="rank"><div class="n">' + (player.ownership_pct != null ? Number(player.ownership_pct).toFixed(1) + '%' + ownBadge(player.ownership_pct) : '&mdash;') + '</div><div class="l">Own %</div></div>';

    updateCardBtn();
    el('backdrop').className = 'backdrop open';
    document.body.className = 'locked';

    var cols = LOG_COLUMNS[player.position] || [];
    var colspan = cols.length + 3;
    el('cardLogHead').innerHTML = '<tr><th class="wk">Wk</th><th>Opp</th>' +
      cols.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '<th class="pts">Pts</th></tr>';

    el('cardLog').innerHTML = '<tr><td class="state" colspan="' + colspan + '">Loading&hellip;</td></tr>';
    fetchSeasonLog(player.sleeper_id).then(function (log) {
      if (!log.length) {
        el('cardLog').innerHTML = '<tr><td class="state" colspan="' + colspan + '">No games logged yet this season.</td></tr>';
        return;
      }
      el('cardLog').innerHTML = log.map(function (g) {
        var cells = cols.map(function (c) {
          var v = c.get ? c.get(g.st) : g.st[c.key];
          return '<td>' + (v == null ? '&mdash;' : v) + '</td>';
        }).join('');
        return '<tr><td class="wk">' + g.week + '</td><td>' + esc(g.opp) + '</td>' + cells +
          '<td class="pts">' + g.pts.toFixed(1) + '</td></tr>';
      }).join('');
    });
  }

  function updateCardBtn() {
    var rostered = isRostered(CARD_PLAYER.dk_player_id);
    var btn = el('cardActionBtn');
    btn.textContent = rostered ? 'Remove from roster' : 'Add to roster';
    btn.className = rostered ? 'addbtn big remove' : 'addbtn big';
  }

  window.toggleFromCard = function () {
    if (!CARD_PLAYER) return;
    toggleRoster(CARD_PLAYER);
    updateCardBtn();
  };

  window.closeCard = function () {
    el('backdrop').className = 'backdrop';
    document.body.className = '';
    CARD_PLAYER = null;
  };

  function setupSalaryRange() {
    var salaries = PLAYERS.map(function (p) { return p.salary; }).filter(function (s) { return s != null; });
    var lo = salaries.length ? Math.min.apply(null, salaries) : 0;
    var hi = salaries.length ? Math.max.apply(null, salaries) : 10000;
    ['salMin', 'salMax'].forEach(function (id) {
      el(id).min = lo; el(id).max = hi; el(id).step = 100;
    });
    el('salMin').value = lo;
    el('salMax').value = hi;
    updateSalaryLabel();
  }

  function updateSalaryLabel() {
    el('salVal').textContent = money(el('salMin').value) + ' \u2013 ' + money(el('salMax').value);
  }

  window.onSalaryRange = function () {
    var lo = Number(el('salMin').value), hi = Number(el('salMax').value);
    if (lo > hi) { var t = lo; lo = hi; hi = t; el('salMin').value = lo; el('salMax').value = hi; }
    updateSalaryLabel();
    draw();
  };

  function loadPlayers(draftGroupId) {
    el('body').innerHTML = '<tr><td class="state" colspan="8">Loading players&hellip;</td></tr>';
    return sbGet('dfs_players?draft_group_id=eq.' + draftGroupId + '&order=salary.desc').then(function (rows) {
      PLAYERS = rows || [];
      el('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
      setupSalaryRange();
      populateGameFilter();
      draw();
    });
  }

  function slateLabel(s) {
    var when = s.start_time ? new Date(s.start_time).toLocaleString('en-US', {
      weekday: 'short', hour: 'numeric', minute: '2-digit'
    }) : '';
    var games = s.game_count ? s.game_count + (s.game_count === 1 ? ' Game' : ' Games') : '';
    var wk = s.week ? 'Wk ' + s.week : '';
    return [wk, s.slate_name, games, when].filter(Boolean).join(' \u00b7 ');
  }

  function populateSlateSelect() {
    var filtered = SLATES.filter(function (s) { return s.contest_type === CONTEST_TYPE; });
    var sel = el('slateSel');
    sel.innerHTML = filtered.map(function (s) {
      return '<option value="' + s.draft_group_id + '">' + esc(slateLabel(s)) + '</option>';
    }).join('');

    if (!filtered.length) {
      el('body').innerHTML = '<tr><td class="state" colspan="8">No ' + CONTEST_TYPE + ' slates available.</td></tr>';
      el('slateSummary').textContent = '\u2014';
      ACTIVE_SLATE = null;
      return;
    }
    ACTIVE_SLATE = filtered[0].draft_group_id;
    sel.value = ACTIVE_SLATE;
    el('slateSummary').innerHTML = '<span class="pos">' + esc(slateLabel(filtered[0])) + '</span>';
    loadPlayers(ACTIVE_SLATE);
  }

  window.onSlateChange = function () {
    ACTIVE_SLATE = Number(el('slateSel').value);
    var match = SLATES.filter(function (s) { return s.draft_group_id === ACTIVE_SLATE; })[0];
    if (match) el('slateSummary').innerHTML = '<span class="pos">' + esc(slateLabel(match)) + '</span>';
    resetRoster();
    drawRoster();
    loadPlayers(ACTIVE_SLATE);
  };

  window.setType = function (type) {
    CONTEST_TYPE = type;
    el('type-classic').className = type === 'classic' ? 'active' : '';
    el('type-showdown').className = type === 'showdown' ? 'active' : '';
    el('type-classic').setAttribute('aria-selected', type === 'classic');
    el('type-showdown').setAttribute('aria-selected', type === 'showdown');
    resetRoster();
    drawRoster();
    populateSlateSelect();
  };

  window.reload = function () { if (ACTIVE_SLATE) loadPlayers(ACTIVE_SLATE); };

  function loadSlates() {
    return sbGet('dfs_slates?order=start_time.asc').then(function (rows) {
      SLATES = rows || [];
      populateSlateSelect();
    });
  }

  function start() {
    var cfg = sbCfg();
    SB_URL = cfg.url; SB_KEY = cfg.key;
    if (!SB_URL || !SB_KEY) {
      el('body').innerHTML = '<tr><td class="state" colspan="8">Supabase config didn\u2019t load. ' +
        'Check that <b>javascript/auth.js</b> is present on this page.</td></tr>';
      return;
    }
    resetRoster();
    drawRoster();
    loadSlates();

    fetch('https://api.sleeper.app/v1/state/nfl')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { if (s) SEASON = s.season; })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();