(function () {
  var WORKER = 'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/rankings';
  var RANK_POS = ['QB', 'RB', 'WR', 'TE'];
  var VALUE_BASE = 200;
  var TIER_ORDER = ['Title Favorite', 'Contender', 'On the Bubble', 'Rebuilding', 'Tank Mode'];
  var TIER_COL = { 'Title Favorite': '#a371f7', 'Contender': '#3fb950', 'On the Bubble': '#FFA515', 'Rebuilding': '#e5534b', 'Tank Mode': '#6e7681' };
  var PLAYERS = null, USER_SLEEPER_ID = null, rankCache = {};

  function el(id) { return document.getElementById(id); }
  function loggedIn() { return typeof auth !== 'undefined' && auth.isAuthenticated(); }
  function sbHeaders() {
    return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + localStorage.getItem('sb-auth-token') };
  }

  async function fetchLeagues() {
    const url = SUPABASE_URL + '/rest/v1/sleeper_leagues?user_id=eq.' + auth.user.sub +
      '&select=league_id,name,season,total_rosters,status,raw&order=season.desc,name.asc';
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error('Could not load leagues (' + res.status + ')');
    return res.json();
  }

  function typeLabel(t) { return t === 2 ? 'Dynasty' : t === 1 ? 'Keeper' : 'Redraft'; }
  function scoringLabel(s) {
    const rec = s && typeof s.rec === 'number' ? s.rec : 0;
    return rec >= 1 ? 'PPR' : rec >= 0.5 ? '1/2 PPR' : 'Standard';
  }
  function startersCount(positions) {
    if (!Array.isArray(positions)) return null;
    const bench = { BN: 1, IR: 1, TAXI: 1 };
    return positions.filter(function (p) { return !bench[p]; }).length;
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

  function render(leagues) {
    const body = el('leaguesBody');
    if (!leagues.length) {
      body.innerHTML = '<tr><td colspan="5" class="ml-empty">No leagues synced yet. Open <strong>Edit Profile</strong>, add your Sleeper handle, and hit <strong>Sync my Sleeper leagues</strong>.</td></tr>';
      return;
    }
    body.innerHTML = leagues.map(function (l) {
      const raw = l.raw || {};
      const avatar = raw.avatar
        ? '<img class="ml-avatar" src="https://sleepercdn.com/avatars/thumbs/' + raw.avatar + '" alt="">'
        : '<span class="ml-avatar ml-avatar-blank"></span>';
      const pills = bubbles(raw).map(function (b) { return '<span class="ml-pill">' + b + '</span>'; }).join('');
      return '<tr>' +
        '<td><div class="ml-league">' + avatar + '<div><div class="ml-name">' + (l.name || 'League') + '</div><div class="ml-season">' + (l.season || '') + '</div></div></div></td>' +
        '<td class="ml-center" id="tier-' + l.league_id + '"><span class="ml-dim">-</span></td>' +
        '<td class="ml-center" id="rank-' + l.league_id + '"><span class="ml-dim">-</span></td>' +
        '<td class="ml-center" id="value-' + l.league_id + '"><span class="ml-dim">-</span></td>' +
        '<td>' + pills + '</td>' +
        '</tr>';
    }).join('');
  }

  function normName(s) {
    return (s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv|v)$/, '');
  }
  function matchKey(name, pos) { return normName(name) + '|' + (pos || '').toUpperCase(); }

  async function loadPlayers() {
    if (PLAYERS) return PLAYERS;
    PLAYERS = await Sleeper.get('/players/nfl');
    return PLAYERS;
  }

  async function rankingsFor(format) {
    if (rankCache[format]) return rankCache[format];
    const map = {};
    for (var i = 0; i < RANK_POS.length; i++) {
      var pos = RANK_POS[i];
      try {
        var res = await fetch(WORKER + '?format=' + format + '&position=' + pos);
        if (!res.ok) continue;
        var data = await res.json();
        var list = Array.isArray(data) ? data : (data.players || []);
        list.forEach(function (pl, idx) {
          var key = matchKey(pl.name, pl.position || pos);
          if (map[key] == null) map[key] = idx + 1;
        });
      } catch (e) {}
    }
    rankCache[format] = map;
    return map;
  }

  function teamScore(roster, playersMap, rankMap, topN) {
    var vals = [];
    (roster.players || []).forEach(function (pid) {
      var p = playersMap[pid];
      if (!p) return;
      var name = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || ''));
      var rank = rankMap[matchKey(name, p.position)];
      if (rank) vals.push(Math.max(0, VALUE_BASE - rank));
    });
    vals.sort(function (a, b) { return b - a; });
    return vals.slice(0, topN).reduce(function (s, v) { return s + v; }, 0);
  }

  function tierFor(rank, n) {
    var frac = rank / n;
    if (frac <= 0.15) return 'Title Favorite';
    if (frac <= 0.40) return 'Contender';
    if (frac <= 0.60) return 'On the Bubble';
    if (frac <= 0.85) return 'Rebuilding';
    return 'Tank Mode';
  }

  async function insightsForLeague(l, playersMap) {
    var raw = l.raw || {};
    var isDyn = (raw.settings && raw.settings.type) === 2;
    var rankMap = await rankingsFor(isDyn ? 'dynasty' : 'draft');
    var rosters = await Sleeper.get('/league/' + l.league_id + '/rosters');
    var topN = (startersCount(raw.roster_positions) || 12) + 6;
    var scored = rosters.map(function (r) {
      return { ownerId: r.owner_id, score: teamScore(r, playersMap, rankMap, topN) };
    }).sort(function (a, b) { return b.score - a.score; });
    var n = scored.length;
    var idx = scored.findIndex(function (s) { return s.ownerId === USER_SLEEPER_ID; });
    if (idx < 0 || !n) return { rank: null, n: n, tier: null, score: null };
    var rank = idx + 1;
    return { rank: rank, n: n, tier: tierFor(rank, n), score: scored[idx].score };
  }

  function tierClass(t) {
    return t === 'Title Favorite' ? 'title' : t === 'Contender' ? 'contender' : t === 'On the Bubble' ? 'bubble' : t === 'Rebuilding' ? 'rebuild' : 'tank';
  }

  function setInsight(leagueId, rank, n, tier, value) {
    var rc = el('rank-' + leagueId), tc = el('tier-' + leagueId), vc = el('value-' + leagueId);
    if (rc) rc.innerHTML = rank ? (rank + ' <span style="color:#5f6c85">/ ' + n + '</span>') : '<span class="ml-dim">-</span>';
    if (tc) tc.innerHTML = tier ? '<span class="ml-tier ml-tier-' + tierClass(tier) + '">' + tier + '</span>' : '<span class="ml-dim">-</span>';
    if (vc) vc.innerHTML = (value != null) ? '<b style="color:#eef2fb">' + Math.round(value).toLocaleString() + '</b>' : '<span class="ml-dim">-</span>';
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
      html += '<div class="ml-sum-donut">' +
        '<div class="ml-donut" style="background:conic-gradient(' + stops.join(', ') + ')"><div class="ml-donut-hole"><span>' + totalLeagues + '</span><small>leagues</small></div></div>' +
        '<div><div class="ml-sum-title">Contender Tiers</div>' + legend + '</div></div>';
    }

    html += '<div class="ml-sum-col"><div class="ml-sum-title">Formats</div>' +
      '<div class="ml-stat"><span>Redraft</span><b>' + formatCounts.Redraft + '</b></div>' +
      '<div class="ml-stat"><span>Dynasty</span><b>' + formatCounts.Dynasty + '</b></div>' +
      '<div class="ml-stat"><span>Keeper</span><b>' + formatCounts.Keeper + '</b></div></div>';

    if (topTeams.length) {
      var items = topTeams.map(function (tm, i) {
        return '<div class="ml-top-item"><span class="ml-top-rank">' + (i + 1) + '</span>' +
          '<span class="ml-top-name">' + tm.name + '</span>' +
          '<span class="ml-tier ml-tier-' + tierClass(tm.tier) + '">' + tm.tier + '</span>' +
          '<span class="ml-top-val">' + Math.round(tm.score).toLocaleString() + '</span></div>';
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
    var formatCounts = { Redraft: 0, Dynasty: 0, Keeper: 0 };
    leagues.forEach(function (l) {
      var t = (l.raw && l.raw.settings && l.raw.settings.type);
      if (t === 2) formatCounts.Dynasty++;
      else if (t === 1) formatCounts.Keeper++;
      else formatCounts.Redraft++;
    });

    var tierCounts = { 'Title Favorite': 0, 'Contender': 0, 'On the Bubble': 0, 'Rebuilding': 0, 'Tank Mode': 0 };
    var topTeams = [];
    try {
      USER_SLEEPER_ID = await getSleeperUserId();
      if (USER_SLEEPER_ID) {
        var playersMap = await loadPlayers();
        for (var i = 0; i < leagues.length; i++) {
          try {
            var ins = await insightsForLeague(leagues[i], playersMap);
            setInsight(leagues[i].league_id, ins.rank, ins.n, ins.tier, ins.score);
            if (ins.tier) tierCounts[ins.tier]++;
            if (ins.score != null) topTeams.push({ name: leagues[i].name || 'League', rank: ins.rank, n: ins.n, tier: ins.tier, score: ins.score });
          } catch (e) {}
        }
      }
    } catch (e) {}
    topTeams.sort(function (a, b) { return b.score - a.score; });
    renderSummary(leagues.length, tierCounts, formatCounts, topTeams.slice(0, 3));
  }

  async function init() {
    if (!loggedIn()) {
      el('ml-gate').style.display = 'block';
      el('ml-content').style.display = 'none';
      el('ml-login-btn').onclick = function () {
        var link = document.querySelector('.btn-login');
        if (link) link.click();
      };
      return;
    }
    el('ml-gate').style.display = 'none';
    el('ml-content').style.display = 'block';

    var body = el('leaguesBody');
    body.innerHTML = '<tr><td colspan="5" class="ml-empty">Loading your leagues…</td></tr>';
    try {
      var leagues = await fetchLeagues();
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