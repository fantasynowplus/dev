(function () {
  function el(id) { return document.getElementById(id); }
  function loggedIn() { return typeof auth !== 'undefined' && auth.isAuthenticated(); }

  async function fetchLeagues() {
    const token = localStorage.getItem('sb-auth-token');
    const url = SUPABASE_URL + '/rest/v1/sleeper_leagues?user_id=eq.' + auth.user.sub +
      '&select=league_id,name,season,total_rosters,status,raw&order=season.desc,name.asc';
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token } });
    if (!res.ok) throw new Error('Could not load leagues (' + res.status + ')');
    return res.json();
  }

  function typeLabel(t) { return t === 2 ? 'Dynasty' : t === 1 ? 'Keeper' : 'Redraft'; }
  function scoringLabel(s) {
    const rec = s && typeof s.rec === 'number' ? s.rec : 0;
    return rec >= 1 ? 'PPR' : rec >= 0.5 ? 'Half PPR' : 'Standard';
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
        '<td class="ml-center ml-dim">-</td>' +
        '<td class="ml-center ml-dim">-</td>' +
        '<td>' + pills + '</td>' +
        '</tr>';
    }).join('');
  }

async function init() {
    if (!loggedIn()) {
      el('ml-gate').style.display = 'block';
      el('ml-content').style.display = 'none';
      el('ml-login-btn').onclick = function () {
        const link = document.querySelector('.btn-login');
        if (link) link.click();
      };
      return;
    }
    el('ml-gate').style.display = 'none';
    el('ml-content').style.display = 'block';

    const body = el('leaguesBody');
    body.innerHTML = '<tr><td colspan="4" class="ml-empty">Loading your leagues…</td></tr>';
    try {
      render(await fetchLeagues());
    } catch (e) {
      body.innerHTML = '<tr><td colspan="4" class="ml-empty">' + e.message + '</td></tr>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();