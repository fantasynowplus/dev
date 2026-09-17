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

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US'); }

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

  function slotEligible(slot, player) {
    return slot.eligible.indexOf(player.position) !== -1;
  }

  function isRostered(dkPlayerId) {
    return Object.keys(ROSTER).some(function (k) { return ROSTER[k] && ROSTER[k].dk_player_id === dkPlayerId; });
  }

  function assignToRoster(player) {
    if (isRostered(player.dk_player_id)) {
      Object.keys(ROSTER).forEach(function (k) {
        if (ROSTER[k] && ROSTER[k].dk_player_id === player.dk_player_id) ROSTER[k] = null;
      });
      drawRoster();
      draw();
      return;
    }
    var slots = currentRuleset().slots;
    for (var i = 0; i < slots.length; i++) {
      if (!ROSTER[slots[i].key] && slotEligible(slots[i], player)) {
        ROSTER[slots[i].key] = player;
        drawRoster();
        draw();
        return;
      }
    }
  }

  function clearRoster() { resetRoster(); drawRoster(); draw(); }

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
    var pct = Math.min(100, (used / cap) * 100);
    var bar = el('capBar');
    bar.style.width = pct + '%';
    bar.className = used > cap ? 'over' : '';

    var rows = currentRuleset().slots.map(function (s) {
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
    el('rosterSlots').innerHTML = rows;

    el('rosterSlots').querySelectorAll('.slotrow').forEach(function (row) {
      row.addEventListener('click', function () {
        var key = row.getAttribute('data-slot');
        if (ROSTER[key]) { ROSTER[key] = null; drawRoster(); draw(); }
      });
    });
  }

  function draw() {
    var pos = el('posFilter').value;
    var q = el('q').value.trim().toLowerCase();

    var rows = PLAYERS.filter(function (p) {
      if (pos !== 'ALL' && p.position !== pos) return false;
      if (q && p.name.toLowerCase().indexOf(q) === -1 && (p.team || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    el('count').textContent = rows.length + ' players';

    if (!rows.length) {
      el('body').innerHTML = '<tr><td class="state" colspan="7">No players match.</td></tr>';
      return;
    }

    el('body').innerHTML = rows.map(function (p) {
      var rostered = isRostered(p.dk_player_id);
      return '<tr class="' + (rostered ? 'rostered' : '') + '" data-id="' + p.dk_player_id + '">' +
        '<td><span class="postag ' + p.position + '">' + p.position + '</span></td>' +
        '<td>' + esc(p.name) + '</td>' +
        '<td>' + esc(p.team || '') + '</td>' +
        '<td>' + esc(p.opponent || '') + '</td>' +
        '<td>' + money(p.salary) + '</td>' +
        '<td>' + (p.projected_points != null ? Number(p.projected_points).toFixed(1) : '&mdash;') + '</td>' +
        '<td>&mdash;</td>' +
        '</tr>';
    }).join('');

    el('body').querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var id = Number(tr.getAttribute('data-id'));
        var player = PLAYERS.filter(function (p) { return p.dk_player_id === id; })[0];
        if (player) assignToRoster(player);
      });
    });
  }

  function loadPlayers(draftGroupId) {
    el('body').innerHTML = '<tr><td class="state" colspan="7">Loading players&hellip;</td></tr>';
    return sbGet('dfs_players?draft_group_id=eq.' + draftGroupId + '&order=salary.desc').then(function (rows) {
      PLAYERS = rows || [];
      el('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
      draw();
    });
  }

  function populateSlateSelect() {
    var filtered = SLATES.filter(function (s) { return s.contest_type === CONTEST_TYPE; });
    var sel = el('slateSel');
    sel.innerHTML = filtered.map(function (s) {
      return '<option value="' + s.draft_group_id + '">' + esc(s.slate_name) + '</option>';
    }).join('');
    if (!filtered.length) {
      el('body').innerHTML = '<tr><td class="state" colspan="7">No ' + CONTEST_TYPE + ' slates available.</td></tr>';
      ACTIVE_SLATE = null;
      return;
    }
    ACTIVE_SLATE = filtered[0].draft_group_id;
    sel.value = ACTIVE_SLATE;
    loadPlayers(ACTIVE_SLATE);
  }

  window.onSlateChange = function () {
    ACTIVE_SLATE = Number(el('slateSel').value);
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

  window.clearRoster = clearRoster;

  window.reload = function () {
    if (ACTIVE_SLATE) loadPlayers(ACTIVE_SLATE);
  };

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
      el('body').innerHTML = '<tr><td class="state" colspan="7">Supabase config didn\u2019t load. ' +
        'Check that <b>javascript/auth.js</b> is present on this page.</td></tr>';
      return;
    }
    resetRoster();
    drawRoster();
    loadSlates();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
