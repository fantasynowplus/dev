(function () {
  var SHEET_URL = {
    draft: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0RwIKqubfB3GVgr2hFzH5VqjemlPqpOHeJFRaFYtIdeW4wYaOol2HJq6mqB6pNUXj9ztP-4mDGzOk/pub?gid=0&single=true&output=csv',
    dynasty: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0RwIKqubfB3GVgr2hFzH5VqjemlPqpOHeJFRaFYtIdeW4wYaOol2HJq6mqB6pNUXj9ztP-4mDGzOk/pub?gid=102395833&single=true&output=csv'
  };
  var WORKER = 'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/rankings';
  var RANK_POS = ['QB', 'RB', 'WR', 'TE'];
  var TIER_ORDER = ['Title Favorite', 'Contender', 'On the Bubble', 'Rebuilding', 'Tank Mode', 'Drafting'];
  var TIER_COL = { 'Title Favorite': '#a371f7', 'Contender': '#3fb950', 'On the Bubble': '#FFA515', 'Rebuilding': '#e5534b', 'Tank Mode': '#6e7681', 'Drafting': '#586f96' };
  var POS_COL = { QB: '#f2cc60', RB: '#56d364', WR: '#58a6ff', TE: '#ff7b72' };
  var TIERS = {
    QB: [[8, 200, 160], [12, 100, 80], [24, 55, 42], [36, 30, 20]],
    RB: [[12, 200, 160], [24, 100, 80], [36, 55, 42], [60, 30, 20], [100, 12, 7], [200, 5, 2]],
    WR: [[12, 200, 160], [24, 100, 80], [36, 55, 42], [60, 30, 20], [100, 12, 7], [200, 5, 2]],
    TE: [[4, 200, 160], [10, 100, 80], [16, 55, 42], [28, 30, 20], [50, 12, 7]]
  };
  var PROJ_SCALE = 700;
  var PLAYERS = null, USER_SLEEPER_ID = null, rankCache = {}, LEAGUES = {}, DETAIL = null;

  function el(id) { return document.getElementById(id); }
  function loggedIn() { return typeof auth !== 'undefined' && auth.isAuthenticated(); }
  function sbHeaders() { return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + localStorage.getItem('sb-auth-token') }; }
  function comma(v) { return Math.round(v).toLocaleString(); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  async function fetchLeagues() {
    const url = SUPABASE_URL + '/rest/v1/sleeper_leagues?user_id=eq.' + auth.user.sub +
      '&select=league_id,name,season,total_rosters,status,raw&order=season.desc,name.asc';
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error('Could not load leagues (' + res.status + ')');
    return res.json();
  }

  function typeLabel(t) { return t === 2 ? 'Dynasty' : t === 1 ? 'Keeper' : 'Redraft'; }
  function scoringLabel(s) { const rec = s && typeof s.rec === 'number' ? s.rec : 0; return rec >= 1 ? 'PPR' : rec >= 0.5 ? '1/2 PPR' : 'Standard'; }
  function startersCount(positions) {
    if (!Array.isArray(positions)) return null;
    const bench = { BN: 1, IR: 1, TAXI: 1 };
    return positions.filter(function (p) { return !bench[p]; }).length;
  }
  function isDynasty(raw) {
    var s = raw.settings || {};
    if (s.type === 2 || s.type === 1) return true;
    if (s.taxi_slots > 0) return true;
    return (raw.roster_positions || []).indexOf('TAXI') !== -1;
  }
  function bubbles(raw) {
    const settings = raw.settings || {};
    const out = [typeLabel(settings.type)];
    const teams = raw.total_rosters || settings.num_teams;
    if (teams) out.push(teams + ' Teams');
    const starters = startersCount(raw.roster_positions);
    if (starters) out.push(starters + ' Starters');
    out.push(scoringLabel(raw.scoring_settings));
    if (settings.best_ball === 1) out.push('Best Ball');
    return out;
  }

  function cellTier(ins) { return (ins && ins.tier) ? '<span class="ml-tier ml-tier-' + tierClass(ins.tier) + '">' + ins.tier + '</span>' : '<span class="ml-dim">-</span>'; }
  function cellRank(ins) { return (ins && ins.rank) ? (ins.rank + ' <span style="color:#5f6c85">/ ' + ins.n + '</span>') : '<span class="ml-dim">-</span>'; }
  function cellValue(ins) { return (ins && ins.score != null) ? '<b style="color:#eef2fb">' + comma(ins.score) + '</b>' : '<span class="ml-dim">-</span>'; }

  function render(leagues, insights) {
    insights = insights || {};
    const body = el('leaguesBody');
    if (!leagues.length) {
      body.innerHTML = '<tr><td colspan="5" class="ml-empty">No leagues synced yet. Open <strong>Edit Profile</strong>, add your Sleeper handle, and hit <strong>Sync my Sleeper leagues</strong>.</td></tr>';
      return;
    }
    body.innerHTML = leagues.map(function (l) {
      const raw = l.raw || {};
      const ins = insights[l.league_id];
      const avatar = raw.avatar
        ? '<img class="ml-avatar" src="https://sleepercdn.com/avatars/thumbs/' + raw.avatar + '" alt="">'
        : '<span class="ml-avatar ml-avatar-blank"></span>';
      const pills = bubbles(raw).map(function (b) { return '<span class="ml-pill">' + b + '</span>'; }).join('');
      return '<tr style="cursor:pointer" onclick="MLDetail.open(\'' + l.league_id + '\')">' +
        '<td><div class="ml-league">' + avatar + '<div><div class="ml-name">' + (l.name || 'League') + '</div><div class="ml-season">' + (l.season || '') + '</div></div></div></td>' +
        '<td id="tier-' + l.league_id + '">' + cellTier(ins) + '</td>' +
        '<td id="rank-' + l.league_id + '">' + cellRank(ins) + '</td>' +
        '<td id="value-' + l.league_id + '">' + cellValue(ins) + '</td>' +
        '<td>' + pills + '</td>' +
        '</tr>';
    }).join('');
  }

  function normName(s) { return (s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv|v)$/, ''); }
  function matchKey(name, pos) { return normName(name) + '|' + (pos || '').toUpperCase(); }

  async function loadPlayers() {
    if (PLAYERS) return PLAYERS;
    PLAYERS = await Sleeper.get('/players/nfl');
    return PLAYERS;
  }

  async function rankingsFor(format) {
    var key = format === 'dynasty' ? 'dynasty' : 'draft';
    if (rankCache[key]) return rankCache[key];
    var fnMap = {}, ecrMap = {}, lists = {};
    try {
      var res = await fetch(SHEET_URL[key]);
      var text = await res.text();
      var rows = text.split(/\r?\n/);
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i]) continue;
        var cols = rows[i].split(',');
        var posRank = parseInt(String(cols[0] || '').replace(/[^0-9]/g, ''), 10);
        var name = (cols[2] || '').replace(/^"|"$/g, '').trim();
        var pos = (cols[4] || '').replace(/^"|"$/g, '').trim().toUpperCase();
        var team = (cols[3] || '').replace(/^"|"$/g, '').trim();
        if (!name || !pos || !posRank) continue;
        var k = matchKey(name, pos);
        if (fnMap[k] == null) fnMap[k] = posRank;
        (lists[pos] = lists[pos] || []).push({ name: name, team: team, pos: pos, rank: posRank, key: k });
      }
    } catch (e) {}
    for (var pi = 0; pi < RANK_POS.length; pi++) {
      var pos2 = RANK_POS[pi];
      try {
        var r2 = await fetch(WORKER + '?format=' + key + '&position=' + pos2 + '&limit=200');
        if (!r2.ok) continue;
        var d2 = await r2.json();
        var arr2 = Array.isArray(d2) ? d2 : (d2.players || []);
        for (var j = 0; j < arr2.length; j++) {
          var kk = matchKey(arr2[j].name, arr2[j].position || pos2);
          if (ecrMap[kk] == null) ecrMap[kk] = j + 1;
        }
      } catch (e) {}
    }
    var map = Object.assign({}, ecrMap, fnMap);
    RANK_POS.forEach(function (p) { if (lists[p]) lists[p].sort(function (a, b) { return a.rank - b.rank; }); });
    rankCache[key] = { map: map, lists: lists };
    return rankCache[key];
  }

  function playerValue(pos, rank) {
    var tiers = TIERS[pos];
    if (!tiers || !rank) return 0;
    var minRank = 1;
    for (var i = 0; i < tiers.length; i++) {
      var maxRank = tiers[i][0], hi = tiers[i][1], lo = tiers[i][2];
      if (rank <= maxRank) {
        if (maxRank === minRank) return hi;
        var frac = (rank - minRank) / (maxRank - minRank);
        return Math.round(hi - frac * (hi - lo));
      }
      minRank = maxRank + 1;
    }
    return 0;
  }

  function evalRoster(roster, playersMap, rankMap, topN) {
    var arr = [];
    (roster.players || []).forEach(function (pid) {
      var p = playersMap[pid]; if (!p) return;
      var name = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || ''));
      var rank = rankMap[matchKey(name, p.position)];
      arr.push({ name: name, pos: p.position, team: p.team, rank: rank || null, value: playerValue(p.position, rank) });
    });
    arr.sort(function (a, b) { return b.value - a.value; });
    var top = arr.slice(0, topN), byPos = { QB: 0, RB: 0, WR: 0, TE: 0 }, total = 0;
    top.forEach(function (pl) { total += pl.value; if (byPos[pl.pos] != null) byPos[pl.pos] += pl.value; });
    return { total: total, byPos: byPos, players: arr };
  }

  function tierFor(rank, n, score) {
    if (score === 0) return 'Drafting';
    var frac = rank / n;
    if (frac <= 0.15) return 'Title Favorite';
    if (frac <= 0.40) return 'Contender';
    if (frac <= 0.60) return 'On the Bubble';
    if (frac <= 0.85) return 'Rebuilding';
    return 'Tank Mode';
  }
  function tierClass(t) {
    return t === 'Title Favorite' ? 'title' : t === 'Contender' ? 'contender' : t === 'On the Bubble' ? 'bubble' : t === 'Rebuilding' ? 'rebuild' : t === 'Drafting' ? 'drafting' : 'tank';
  }

  async function insightsForLeague(l, playersMap) {
    var raw = l.raw || {};
    var rankData = await rankingsFor(isDynasty(raw) ? 'dynasty' : 'draft');
    var rosters = await Sleeper.get('/league/' + l.league_id + '/rosters');
    var topN = (startersCount(raw.roster_positions) || 12) + 6;
    var scored = rosters.map(function (r) {
      return { ownerId: r.owner_id, score: evalRoster(r, playersMap, rankData.map, topN).total };
    }).sort(function (a, b) { return b.score - a.score; });
    var n = scored.length;
    var idx = scored.findIndex(function (s) { return s.ownerId === USER_SLEEPER_ID; });
    if (idx < 0 || !n) return { rank: null, n: n, tier: null, score: null };
    var rank = idx + 1;
    return { rank: rank, n: n, tier: tierFor(rank, n, scored[idx].score), score: scored[idx].score };
  }

  function setInsight(leagueId, ins) {
    var tc = el('tier-' + leagueId), rc = el('rank-' + leagueId), vc = el('value-' + leagueId);
    if (tc) tc.innerHTML = cellTier(ins);
    if (rc) rc.innerHTML = cellRank(ins);
    if (vc) vc.innerHTML = cellValue(ins);
  }

  function renderSummary(totalLeagues, tierCounts, formatCounts, topTeams) {
    var slot = el('ml-chart-slot');
    if (!totalLeagues) { slot.style.display = 'none'; return; }
    var tierTotal = TIER_ORDER.reduce(function (s, t) { return s + tierCounts[t]; }, 0);
    var html = '';
    if (tierTotal) {
      var acc = 0, stops = [];
      TIER_ORDER.forEach(function (t) {
        if (!tierCounts[t]) return;
        var start = acc / tierTotal * 100; acc += tierCounts[t]; var end = acc / tierTotal * 100;
        stops.push(TIER_COL[t] + ' ' + start + '% ' + end + '%');
      });
      var legend = TIER_ORDER.filter(function (t) { return tierCounts[t] > 0; }).map(function (t) {
        return '<div class="ml-legend-item"><span class="ml-legend-dot" style="background:' + TIER_COL[t] + '"></span>' + t + ' <span class="ml-legend-count">' + tierCounts[t] + '</span></div>';
      }).join('');
      html += '<div class="ml-sum-donut"><div class="ml-donut" style="background:conic-gradient(' + stops.join(', ') + ')"><div class="ml-donut-hole"><span>' + totalLeagues + '</span><small>leagues</small></div></div>' +
        '<div><div class="ml-sum-title">Contender Tiers</div>' + legend + '</div></div>';
    }
    html += '<div class="ml-sum-col"><div class="ml-sum-title">Formats</div>' +
      '<div class="ml-stat"><span>Redraft</span><b>' + formatCounts.Redraft + '</b></div>' +
      '<div class="ml-stat"><span>Dynasty</span><b>' + formatCounts.Dynasty + '</b></div>' +
      '<div class="ml-stat"><span>Keeper</span><b>' + formatCounts.Keeper + '</b></div>' +
      (formatCounts.BestBall ? '<div class="ml-stat"><span>Best Ball</span><b>' + formatCounts.BestBall + '</b></div>' : '') + '</div>';
    if (topTeams.length) {
      var items = topTeams.map(function (tm, i) {
        return '<div class="ml-top-item"><span class="ml-top-rank">' + (i + 1) + '</span><span class="ml-top-name">' + tm.name + '</span>' +
          '<span class="ml-tier ml-tier-' + tierClass(tm.tier) + '">' + tm.tier + '</span><span class="ml-top-val">' + comma(tm.score) + '</span></div>';
      }).join('');
      html += '<div class="ml-sum-col ml-sum-top"><div class="ml-sum-title">Your Top Teams</div>' + items + '</div>';
    }
    slot.className = 'ml-summary';
    slot.innerHTML = html;
  }

  async function getSleeperUserId() {
    if (auth.profile && auth.profile.sleeper_user_id) return auth.profile.sleeper_user_id;
    try {
      var res = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + auth.user.sub + '&select=sleeper_user_id,sleeper_handle', { headers: sbHeaders() });
      var rows = await res.json();
      var p = (rows && rows[0]) || {};
      if (p.sleeper_user_id) return p.sleeper_user_id;
      if (p.sleeper_handle && typeof Sleeper !== 'undefined') { var u = await Sleeper.resolveUser(p.sleeper_handle); return u && u.user_id; }
    } catch (e) {}
    return null;
  }

  async function computeInsights(leagues) {
    var formatCounts = { Redraft: 0, Dynasty: 0, Keeper: 0, BestBall: 0 };
    leagues.forEach(function (l) {
      var s = (l.raw && l.raw.settings) || {};
      if (s.type === 2) formatCounts.Dynasty++; else if (s.type === 1) formatCounts.Keeper++; else formatCounts.Redraft++;
      if (s.best_ball === 1) formatCounts.BestBall++;
    });
    var tierCounts = { 'Title Favorite': 0, 'Contender': 0, 'On the Bubble': 0, 'Rebuilding': 0, 'Tank Mode': 0, 'Drafting': 0 };
    var topTeams = [], insightsMap = {};
    try {
      USER_SLEEPER_ID = await getSleeperUserId();
      if (USER_SLEEPER_ID) {
        var playersMap = await loadPlayers();
        for (var i = 0; i < leagues.length; i++) {
          try {
            var ins = await insightsForLeague(leagues[i], playersMap);
            insightsMap[leagues[i].league_id] = ins;
            setInsight(leagues[i].league_id, ins);
            if (ins.tier) tierCounts[ins.tier]++;
            if (ins.score != null) topTeams.push({ name: leagues[i].name || 'League', tier: ins.tier, score: ins.score });
          } catch (e) {}
        }
      }
    } catch (e) {}
    topTeams.sort(function (a, b) { return b.score - a.score; });
    renderSummary(leagues.length, tierCounts, formatCounts, topTeams.slice(0, 3));

    var sorted = leagues.slice().sort(function (a, b) {
      var ia = insightsMap[a.league_id], ib = insightsMap[b.league_id];
      var ta = (ia && ia.tier) ? TIER_ORDER.indexOf(ia.tier) : 99;
      var tb = (ib && ib.tier) ? TIER_ORDER.indexOf(ib.tier) : 99;
      if (ta !== tb) return ta - tb;
      var va = (ia && ia.score != null) ? ia.score : -1;
      var vb = (ib && ib.score != null) ? ib.score : -1;
      return vb - va;
    });
    render(sorted, insightsMap);
  }

  function shortName(s) { return (s || '').length > 11 ? (s.slice(0, 10) + '…') : (s || ''); }

  function barHTML(team, idx, maxTotal, sel) {
    var h = maxTotal > 0 ? Math.round(team.total / maxTotal * 220) : 0;
    var segs = RANK_POS.map(function (pos) {
      var v = team.byPos[pos] || 0;
      var sh = team.total > 0 ? Math.round(v / team.total * h) : 0;
      return sh > 0 ? '<div style="height:' + sh + 'px;background:' + POS_COL[pos] + '"></div>' : '';
    }).join('');
    return '<div class="ml-bar-col' + (idx === sel ? ' ml-bar-sel' : '') + '" onclick="MLDetail.select(' + idx + ')">' +
      '<div class="ml-bar-val">' + comma(team.total) + '</div>' +
      '<div class="ml-bar" style="height:' + h + 'px">' + segs + '</div>' +
      '<div class="ml-bar-label">' + shortName(team.name) + '</div></div>';
  }

  async function leagueTransactions(leagueId) {
    var weeks = [];
    for (var w = 1; w <= 18; w++) weeks.push(w);
    var results = await Promise.all(weeks.map(function (w) {
      return Sleeper.get('/league/' + leagueId + '/transactions/' + w).catch(function () { return []; });
    }));
    var tx = {};
    results.forEach(function (arr) {
      (arr || []).forEach(function (t) {
        if (t.status && t.status !== 'complete') return;
        var ids = t.roster_ids || [];
        if (t.type === 'trade') ids.forEach(function (rid) { (tx[rid] = tx[rid] || { waivers: 0, trades: 0 }).trades++; });
        else if (t.type === 'waiver' || t.type === 'free_agent') ids.forEach(function (rid) { (tx[rid] = tx[rid] || { waivers: 0, trades: 0 }).waivers++; });
      });
    });
    return tx;
  }

  function standingsHTML(teams) {
    var sorted = teams.slice().sort(function (a, b) { return (b.wins - a.wins) || (b.pf - a.pf); });
    var rows = sorted.map(function (t, i) {
      var rec = t.wins + '-' + t.losses + (t.ties ? '-' + t.ties : '');
      var proj = t.projGames ? (t.projWins + '-' + t.projLosses + (t.ties ? '-' + t.ties : '')) : '<span class="ml-dim">—</span>';
      return '<tr><td class="ml-center">' + (i + 1) + '</td><td class="ml-name">' + t.name + '</td>' +
        '<td class="ml-center">' + rec + '</td>' +
        '<td class="ml-center">' + (t.maxpf ? t.maxpf.toFixed(1) : '0.0') + '</td>' +
        '<td class="ml-center">' + proj + '</td></tr>';
    }).join('');
    return '<div class="ml-sum-title">Standings</div><div class="ml-table-wrap" style="margin-top:12px"><table class="ml-table"><thead><tr>' +
      '<th class="ml-center">#</th><th>Team</th><th class="ml-center">Record</th><th class="ml-center">Max PF</th><th class="ml-center">Proj. Record</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function txChartHTML(teams, tx) {
    var TXCOL = { waivers: '#3fb950', trades: '#58a6ff' };
    var data = teams.map(function (t) {
      var x = tx[t.rosterId] || { waivers: 0, trades: 0 };
      return { name: t.name, waivers: x.waivers, trades: x.trades, total: x.waivers + x.trades };
    }).sort(function (a, b) { return b.total - a.total; });
    var maxVal = data.reduce(function (m, d) { return Math.max(m, d.waivers, d.trades); }, 0);
    function bar(val, color) {
      var h = maxVal > 0 ? Math.round(val / maxVal * 200) : 0;
      return '<div class="ml-txbar-wrap"><div class="ml-bar-val">' + val + '</div>' +
        '<div class="ml-txbar" style="height:' + h + 'px;background:' + color + '"></div></div>';
    }
    var cols = data.map(function (d) {
      return '<div class="ml-bar-col" style="cursor:default">' +
        '<div class="ml-txgroup">' + bar(d.waivers, TXCOL.waivers) + bar(d.trades, TXCOL.trades) + '</div>' +
        '<div class="ml-bar-label">' + shortName(d.name) + '</div></div>';
    }).join('');
    var legend = '<span class="ml-legend-item"><span class="ml-legend-dot" style="background:' + TXCOL.waivers + '"></span>Waivers</span>' +
      '<span class="ml-legend-item"><span class="ml-legend-dot" style="background:' + TXCOL.trades + '"></span>Trades</span>';
    return '<div class="ml-panel-head"><span class="ml-sum-title" style="margin:0">Transactions Per Team</span><span class="ml-poslegend">' + legend + '</span></div>' +
      '<div class="ml-chartrow">' + cols + '</div>';
  }

  function teamNeeds(team, n) {
    var needs = [];
    RANK_POS.forEach(function (pos) { if (team.posRank[pos] && team.posRank[pos] > n * 0.6) needs.push(pos); });
    return needs;
  }

  function rosterPanelHTML(team, n) {
    var needs = teamNeeds(team, n);
    var needHTML = needs.length ? needs.map(function (p) { return '<span class="ml-pill">' + p + '</span>'; }).join('') : '<span style="color:#56d364">Balanced roster</span>';
    var rows = team.players.slice(0, 40).map(function (pl) {
      return '<div class="ml-rost-row"><span class="ml-rost-pos ml-pos-' + (pl.pos || '').toLowerCase() + '">' + (pl.pos || '') + '</span>' +
        '<span class="ml-rost-name">' + pl.name + '</span><span class="ml-rost-team">' + (pl.team || '') + '</span>' +
        '<span class="ml-rost-rank">' + (pl.rank ? ('#' + pl.rank) : '—') + '</span>' +
        '<span class="ml-rost-val">' + comma(pl.value) + '</span></div>';
    }).join('');
    return '<div class="ml-sum-title">' + team.name + ' — <span class="ml-tier ml-tier-' + tierClass(team.tier) + '">' + team.tier + '</span> · #' + team.overallRank + ' of ' + n + ' · ' + comma(team.total) + ' value</div>' +
      '<div class="ml-needs"><span class="ml-needs-label">Team needs:</span> ' + needHTML + '</div>' +
      '<div class="ml-rost-head"><span class="ml-rost-pos"></span><span class="ml-rost-name">Player</span><span class="ml-rost-team">Team</span><span class="ml-rost-rank">Rank</span><span class="ml-rost-val">Value</span></div>' + rows;
  }

  function renderDetail() {
    var d = DETAIL, tab = d.tab || 'overview';
    var tabs = '<div class="ml-dtabs">' +
      '<button class="ml-dtab' + (tab === 'overview' ? ' active' : '') + '" onclick="MLDetail.tab(\'overview\')">Overview</button>' +
      '<button class="ml-dtab' + (tab === 'draft' ? ' active' : '') + '" onclick="MLDetail.tab(\'draft\')">Draft Analyzer</button>' +
      '</div>';
    el('ml-detail').innerHTML =
      '<button class="ml-back" onclick="MLDetail.back()">← Back to leagues</button>' +
      '<h2 class="ml-detail-title">' + (d.league.name || 'League') + '</h2>' +
      tabs + '<div id="ml-detail-body"></div>';
    renderDetailBody();
  }

  function renderDetailBody() {
    if ((DETAIL.tab || 'overview') === 'draft') renderDraft();
    else el('ml-detail-body').innerHTML = overviewHTML();
  }

  function overviewHTML() {
    var d = DETAIL, teams = d.teams, sel = d.selected, n = d.n;
    var maxTotal = teams.reduce(function (m, t) { return Math.max(m, t.total); }, 0);
    var bars = teams.map(function (t, i) { return barHTML(t, i, maxTotal, sel); }).join('');
    var posLegend = RANK_POS.map(function (pos) { return '<span class="ml-legend-item"><span class="ml-legend-dot" style="background:' + POS_COL[pos] + '"></span>' + pos + '</span>'; }).join('');
    var rows = teams.map(function (t, i) {
      return '<tr class="' + (i === sel ? 'ml-row-sel' : '') + '" style="cursor:pointer" onclick="MLDetail.select(' + i + ')">' +
        '<td class="ml-name">' + t.name + '</td>' +
        '<td class="ml-center"><span class="ml-tier ml-tier-' + tierClass(t.tier) + '">' + t.tier + '</span></td>' +
        '<td class="ml-center">' + t.overallRank + ' <span style="color:#5f6c85">/ ' + n + '</span></td>' +
        '<td class="ml-center">' + ordinal(t.posRank.QB) + '</td><td class="ml-center">' + ordinal(t.posRank.RB) + '</td>' +
        '<td class="ml-center">' + ordinal(t.posRank.WR) + '</td><td class="ml-center">' + ordinal(t.posRank.TE) + '</td></tr>';
    }).join('');
    return '<div class="ml-panel"><div class="ml-panel-head"><span class="ml-sum-title" style="margin:0">Roster Value — Best to Worst</span><span class="ml-poslegend">' + posLegend + '</span></div><div class="ml-chartrow">' + bars + '</div></div>' +
      '<div class="ml-detail-grid"><div class="ml-panel">' + rosterPanelHTML(teams[sel], n) + '</div>' +
      '<div class="ml-panel"><div class="ml-sum-title">All Teams</div><div class="ml-table-wrap" style="margin-top:12px"><table class="ml-table"><thead><tr><th>Team</th><th class="ml-center">Tier</th><th class="ml-center">Rank</th><th class="ml-center">QB</th><th class="ml-center">RB</th><th class="ml-center">WR</th><th class="ml-center">TE</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>' +
      '<div class="ml-panel">' + standingsHTML(teams) + '</div>' +
      '<div class="ml-panel">' + txChartHTML(teams, d.tx || {}) + '</div>';
  }

  function pickLabel(e, n) { var inRound = ((e.pickNo - 1) % n) + 1; return e.round + '.' + (inRound < 10 ? '0' + inRound : inRound); }

  async function renderDraft() {
    var body = el('ml-detail-body');
    if (DETAIL.draftAnalysis) { body.innerHTML = draftHTML(DETAIL.draftAnalysis); return; }
    body.innerHTML = '<div class="ml-panel"><div class="ml-empty">Analyzing the draft…</div></div>';
    try {
      var drafts = await Sleeper.get('/league/' + DETAIL.leagueId + '/drafts');
      var completed = (drafts || []).filter(function (dr) { return dr.status === 'complete'; });
      var chosen = (completed.length ? completed : (drafts || [])).sort(function (a, b) { return (b.start_time || 0) - (a.start_time || 0); })[0];
      if (!chosen) { body.innerHTML = '<div class="ml-panel"><div class="ml-empty">No draft found for this league yet.</div></div>'; return; }
      var picks = await Sleeper.get('/draft/' + chosen.draft_id + '/picks');
      DETAIL.draftAnalysis = analyzeDraft(picks || []);
      body.innerHTML = draftHTML(DETAIL.draftAnalysis);
    } catch (e) {
      body.innerHTML = '<div class="ml-panel"><div class="ml-empty">Could not load the draft: ' + e.message + '</div></div>';
    }
  }

  function analyzeDraft(picks) {
    var rankMap = DETAIL.rankData.map;
    var nameById = {}; DETAIL.teams.forEach(function (t) { nameById[t.rosterId] = t.name; });
    var enriched = picks.map(function (p) {
      var md = p.metadata || {};
      var name = ((md.first_name || '') + ' ' + (md.last_name || '')).trim();
      var pos = (md.position || '').toUpperCase();
      var rank = rankMap[matchKey(name, pos)];
      return { pickNo: p.pick_no, round: p.round, rosterId: p.roster_id, name: name, pos: pos, rank: rank || null, value: playerValue(pos, rank) };
    });
    var byValue = enriched.filter(function (e) { return e.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    var valueRank = {}; byValue.forEach(function (e, i) { valueRank[e.pickNo] = i + 1; });
    enriched.forEach(function (e) { e.vop = (valueRank[e.pickNo] != null) ? (e.pickNo - valueRank[e.pickNo]) : null; });
    var teamTotals = {};
    enriched.forEach(function (e) { var tt = (teamTotals[e.rosterId] = teamTotals[e.rosterId] || { value: 0, picks: 0 }); tt.value += e.value; tt.picks++; });
    var teamGrades = DETAIL.teams.map(function (t) {
      var tt = teamTotals[t.rosterId] || { value: 0, picks: 0 };
      return { name: t.name, value: tt.value, picks: tt.picks };
    }).sort(function (a, b) { return b.value - a.value; });
    var ranked = enriched.filter(function (e) { return e.vop != null; });
    var steals = ranked.slice().sort(function (a, b) { return b.vop - a.vop; }).slice(0, 5);
    var reaches = ranked.slice().sort(function (a, b) { return a.vop - b.vop; }).slice(0, 5);
    return { picks: enriched, teamGrades: teamGrades, steals: steals, reaches: reaches, nameById: nameById };
  }

  function draftHTML(a) {
    if (!a.picks.length) return '<div class="ml-panel"><div class="ml-empty">This league hasn\'t drafted yet.</div></div>';
    var n = DETAIL.n, nameById = a.nameById;
    var grades = a.teamGrades.map(function (t, i) {
      return '<tr><td class="ml-center">' + (i + 1) + '</td><td class="ml-name">' + t.name + '</td>' +
        '<td class="ml-center">' + t.picks + '</td><td class="ml-center"><b style="color:#eef2fb">' + comma(t.value) + '</b></td></tr>';
    }).join('');
    var gradesTable = '<div class="ml-sum-title">Draft Grades — Best Haul to Worst</div><div class="ml-table-wrap" style="margin-top:12px"><table class="ml-table"><thead><tr><th class="ml-center">#</th><th>Team</th><th class="ml-center">Picks</th><th class="ml-center">Draft Value</th></tr></thead><tbody>' + grades + '</tbody></table></div>';
    function pickRow(e, steal) {
      return '<div class="ml-rost-row"><span class="ml-rost-pos ml-pos-' + (e.pos || '').toLowerCase() + '">' + pickLabel(e, n) + '</span>' +
        '<span class="ml-rost-name">' + e.name + '</span>' +
        '<span class="ml-rost-rank" style="width:130px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (nameById[e.rosterId] || '') + '</span>' +
        '<span class="ml-rost-val" style="color:' + (steal ? '#56d364' : '#ff7b72') + '">' + (steal ? '+' : '') + e.vop + '</span></div>';
    }
    var stealsList = a.steals.map(function (e) { return pickRow(e, true); }).join('') || '<div class="ml-empty">—</div>';
    var reachesList = a.reaches.map(function (e) { return pickRow(e, false); }).join('') || '<div class="ml-empty">—</div>';
    var board = a.picks.slice().sort(function (x, y) { return x.pickNo - y.pickNo; }).map(function (e) {
      var col = (e.vop != null && e.vop >= 10) ? '#56d364' : (e.vop != null && e.vop <= -10) ? '#ff7b72' : '#c9d2e6';
      return '<div class="ml-rost-row"><span class="ml-rost-pos ml-pos-' + (e.pos || '').toLowerCase() + '">' + pickLabel(e, n) + '</span>' +
        '<span class="ml-rost-name" style="color:' + col + '">' + e.name + '</span>' +
        '<span class="ml-rost-rank" style="width:130px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (nameById[e.rosterId] || '') + '</span>' +
        '<span class="ml-rost-val">' + comma(e.value) + '</span></div>';
    }).join('');
    return '<div class="ml-panel">' + gradesTable + '</div>' +
      '<div class="ml-detail-grid"><div class="ml-panel"><div class="ml-sum-title">Best Value Picks</div>' + stealsList + '</div>' +
      '<div class="ml-panel"><div class="ml-sum-title">Biggest Reaches</div>' + reachesList + '</div></div>' +
      '<div class="ml-panel"><div class="ml-sum-title">Full Draft Board</div><div style="max-height:420px;overflow-y:auto;margin-top:8px">' + board + '</div></div>';
  }

  async function openDetail(leagueId) {
    var league = LEAGUES[leagueId]; if (!league) return;
    el('ml-content').style.display = 'none';
    var detail = el('ml-detail'); detail.style.display = 'block';
    detail.innerHTML = '<button class="ml-back" onclick="MLDetail.back()">← Back to leagues</button><div class="ml-empty">Analyzing ' + (league.name || 'league') + '…</div>';
    window.scrollTo(0, 0);
    try {
      if (!USER_SLEEPER_ID) USER_SLEEPER_ID = await getSleeperUserId();
      var raw = league.raw || {};
      var rankData = await rankingsFor(isDynasty(raw) ? 'dynasty' : 'draft');
      var players = await loadPlayers();
      var fetched = await Promise.all([
        Sleeper.get('/league/' + leagueId + '/rosters'),
        Sleeper.get('/league/' + leagueId + '/users'),
        leagueTransactions(leagueId),
        Sleeper.get('/state/nfl').catch(function () { return { week: 1 }; })
      ]);
      var rosters = fetched[0], users = fetched[1], tx = fetched[2], state = fetched[3];
      var userMap = {}; users.forEach(function (u) { userMap[u.user_id] = u; });
      var topN = (startersCount(raw.roster_positions) || 12) + 6;
      var teams = rosters.map(function (r) {
        var ev = evalRoster(r, players, rankData.map, topN);
        var u = userMap[r.owner_id] || {}, st = r.settings || {};
        return {
          ownerId: r.owner_id, rosterId: r.roster_id,
          name: (u.metadata && u.metadata.team_name) || u.display_name || 'Ghost Team',
          total: ev.total, byPos: ev.byPos, players: ev.players, posRank: {},
          wins: st.wins || 0, losses: st.losses || 0, ties: st.ties || 0,
          pf: (st.fpts || 0) + (st.fpts_decimal || 0) / 100,
          maxpf: (st.ppts || 0) + (st.ppts_decimal || 0) / 100
        };
      }).sort(function (a, b) { return b.total - a.total; });
      var n = teams.length;
      teams.forEach(function (t, i) { t.overallRank = i + 1; t.tier = tierFor(i + 1, n, t.total); });
      RANK_POS.forEach(function (pos) {
        teams.slice().sort(function (a, b) { return (b.byPos[pos] || 0) - (a.byPos[pos] || 0); })
          .forEach(function (t, i) { t.posRank[pos] = i + 1; });
      });
      await projectRecords(leagueId, teams, raw, state);
      var selIdx = teams.findIndex(function (t) { return t.ownerId === USER_SLEEPER_ID; });
      DETAIL = { league: league, leagueId: leagueId, teams: teams, n: n, rankData: rankData, tx: tx, selected: selIdx >= 0 ? selIdx : 0, tab: 'overview', draftAnalysis: null };
      renderDetail();
    } catch (e) {
      detail.innerHTML = '<button class="ml-back" onclick="MLDetail.back()">← Back to leagues</button><div class="ml-empty">Could not load this league: ' + e.message + '</div>';
    }
  }

  async function projectRecords(leagueId, teams, raw, state) {
    teams.forEach(function (t) { t.projWins = t.wins; t.projLosses = t.losses; t.projGames = 0; });
    var curWeek = Math.max(1, (state && state.week) || 1);
    var lastReg = ((raw.settings && raw.settings.playoff_week_start) || 15) - 1;
    if (curWeek > lastReg) return;
    var weeks = [];
    for (var w = curWeek; w <= lastReg; w++) weeks.push(w);
    var byWeek = await Promise.all(weeks.map(function (w) {
      return Sleeper.get('/league/' + leagueId + '/matchups/' + w).catch(function () { return []; });
    }));
    var valById = {}, proj = {};
    teams.forEach(function (t) { valById[t.rosterId] = t.total; proj[t.rosterId] = { exp: 0, games: 0 }; });
    byWeek.forEach(function (week) {
      var byMatch = {};
      (week || []).forEach(function (m) {
        if (m.matchup_id == null) return;
        (byMatch[m.matchup_id] = byMatch[m.matchup_id] || []).push(m.roster_id);
      });
      Object.keys(byMatch).forEach(function (mid) {
        var pair = byMatch[mid];
        if (pair.length !== 2) return;
        var a = pair[0], b = pair[1];
        var pa = 1 / (1 + Math.exp(-((valById[a] || 0) - (valById[b] || 0)) / PROJ_SCALE));
        if (proj[a]) { proj[a].exp += pa; proj[a].games++; }
        if (proj[b]) { proj[b].exp += (1 - pa); proj[b].games++; }
      });
    });
    teams.forEach(function (t) {
      var p = proj[t.rosterId] || { exp: 0, games: 0 };
      var addWins = Math.round(p.exp);
      t.projWins = t.wins + addWins;
      t.projLosses = t.losses + (p.games - addWins);
      t.projGames = p.games;
    });
  }

  function selectTeam(i) { if (DETAIL) { DETAIL.selected = i; renderDetailBody(); } }
  function closeDetail() { el('ml-detail').style.display = 'none'; el('ml-content').style.display = 'block'; }
  window.MLDetail = { open: openDetail, select: selectTeam, back: closeDetail, tab: function (name) { if (DETAIL) { DETAIL.tab = name; renderDetail(); } } };

  async function init() {
    if (!loggedIn()) {
      el('ml-gate').style.display = 'block';
      el('ml-content').style.display = 'none';
      el('ml-login-btn').onclick = function () { var link = document.querySelector('.btn-login'); if (link) link.click(); };
      return;
    }
    el('ml-gate').style.display = 'none';
    el('ml-content').style.display = 'block';
    var body = el('leaguesBody');
    body.innerHTML = '<tr><td colspan="5" class="ml-empty">Loading your leagues…</td></tr>';
    try {
      var leagues = await fetchLeagues();
      LEAGUES = {};
      leagues.forEach(function (l) { LEAGUES[l.league_id] = l; });
      render(leagues);
      if (leagues.length) {
        el('ml-chart-slot').textContent = 'Analyzing your rosters…';
        computeInsights(leagues);
      } else {
        el('ml-chart-slot').style.display = 'none';
      }
    } catch (e) {
      body.innerHTML = '<tr><td colspan="5" class="ml-empty">' + e.message + '</td></tr>';
      el('ml-chart-slot').style.display = 'none';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();