(function () {
  var WORKER = 'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/rankings';
  var RANK_POS = ['QB', 'RB', 'WR', 'TE'];
  var VALUE_BASE = 200;
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
      body.innerHTML = '<tr><td colspan="4" class="ml-empty">No leagues synced yet. Open <strong>Edit Profile</strong>, add your Sleeper handle, and hit <strong>Sync my Sleeper leagues</strong>.</td></tr>';
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
    if (idx < 0 || !n) return { rank: null, n: n, tier: null };
    var rank = idx + 1;
    var tier = rank <= n / 3 ? 'Contender' : rank <= (2 * n / 3) ? 'On the Bubble' : 'Rebuilding';
    return { rank: rank, n: n, tier: tier };
  }

  function tierClass(t) { return t === 'Contender' ? 'contender' : t === 'On the Bubble' ? 'bubble' : 'rebuild'; }

  function setInsight(leagueId, rank, n, tier) {
    var rc = el('rank-' + leagueId), tc = el('tier-' + leagueId);
    if (rc) rc.innerHTML = rank ? (rank + ' <span style="color:#5f6c85">/ ' + n + '</span>') : '<span class="ml-dim">-</span>';
    if (tc) tc.innerHTML = tier ? '<span class="ml-tier ml-tier-' + tierClass(tier) + '">' + tier + '</span>' : '<span class="ml-dim">-</span>';
  }

  function renderTierChart(counts) {
    var slot = el('ml-chart-slot');
    var order = ['Contender', 'On the Bubble', 'Rebuilding'];
    var total = order.reduce(function (s, t) { return s + counts[t]; }, 0);
    if (!total) { slot.style.display = 'none'; return; }
    var COL = { 'Contender': '#3fb950', 'On the Bubble': '#FFA515', 'Rebuilding': '#e5534b' };
    var acc = 0, stops = [];
    order.forEach(function (t) {
      if (!counts[t]) return;
      var start = acc / total * 100; acc += counts[t]; var end = acc / total * 100;
      stops.push(COL[t] + ' ' + start + '% ' + end + '%');
    });
    var legend = order.filter(function (t) { return counts[t] > 0; }).map(function (t) {
      return '<div class="ml-legend-item"><span class="ml-legend-dot" style="background:' + COL[t] + '"></span>' + t + ' <span class="ml-legend-count">' + counts[t] + '</span></div>';
    }).join('');
    slot.className = 'ml-chart';
    slot.innerHTML =
      '<div class="ml-donut" style="background:conic-gradient(' + stops.join(', ') + ')"><div class="ml-donut-hole"><span>' + total + '</span><small>leagues</small></div></div>' +
      '<div><div class="ml-legend-title">Contender Tiers</div>' + legend + '</div>';
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
    try {
      USER_SLEEPER_ID = await getSleeperUserId();
      if (!USER_SLEEPER_ID) { el('ml-chart-slot').style.display = 'none'; return; }
      var playersMap = await loadPlayers();
      var counts = { 'Contender': 0, 'On the Bubble': 0, 'Rebuilding': 0 };
      for (var i = 0; i < leagues.length; i++) {
        try {
          var ins = await insightsForLeague(leagues[i], playersMap);
          setInsight(leagues[i].league_id, ins.rank, ins.n, ins.tier);
          if (ins.tier) counts[ins.tier]++;
        } catch (e) {}
      }
      renderTierChart(counts);
    } catch (e) {
      el('ml-chart-slot').style.display = 'none';
    }
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
    body.innerHTML = '<tr><td colspan="4" class="ml-empty">Loading your leagues…</td></tr>';
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
      body.innerHTML = '<tr><td colspan="4" class="ml-empty">' + e.message + '</td></tr>';
      el('ml-chart-slot').style.display = 'none';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();