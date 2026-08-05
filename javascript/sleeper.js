const Sleeper = {
  BASE: 'https://api.sleeper.app/v1',

  async get(path) {
    const res = await fetch(this.BASE + path);
    if (!res.ok) throw new Error('Sleeper request failed (' + res.status + ')');
    return res.json();
  },

  async currentSeason() {
    const state = await this.get('/state/nfl');
    return state.season;
  },

  async resolveUser(handle) {
    const user = await this.get('/user/' + encodeURIComponent(handle.trim()));
    if (!user || !user.user_id) throw new Error('No Sleeper account found for "' + handle + '"');
    return user;
  },

  async leaguesForUser(userId, season) {
    return this.get('/user/' + userId + '/leagues/nfl/' + season);
  },

  async leagueBundle(leagueId) {
    const [league, rosters, users, drafts] = await Promise.all([
      this.get('/league/' + leagueId),
      this.get('/league/' + leagueId + '/rosters'),
      this.get('/league/' + leagueId + '/users'),
      this.get('/league/' + leagueId + '/drafts')
    ]);
    return { league, rosters, users, drafts };
  },

  async draftPicks(draftId) {
    return this.get('/draft/' + draftId + '/picks');
  }
};

async function saveSleeperLeagues(userId, leagues) {
  const token = localStorage.getItem('sb-auth-token');
  const rows = leagues.map(l => ({
    user_id: userId,
    league_id: l.league_id,
    season: l.season,
    name: l.name,
    total_rosters: l.total_rosters,
    status: l.status,
    sport: l.sport,
    avatar: l.avatar,
    draft_id: l.draft_id,
    previous_league_id: l.previous_league_id,
    raw: l,
    synced_at: new Date().toISOString()
  }));
  const res = await fetch(SUPABASE_URL + '/rest/v1/sleeper_leagues?on_conflict=user_id,league_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + token,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error('Could not save leagues: ' + (await res.text()));
  return rows.length;
}

async function syncMySleeperLeagues() {
  const out = document.getElementById('sleeperResult');
  if (!auth.isAuthenticated()) { out.textContent = 'Please log in first.'; return; }
  const handle = auth.profile && auth.profile.sleeper_handle;
  if (!handle) { out.textContent = 'Add your Sleeper handle above and click Save first.'; return; }

  out.textContent = 'Syncing your Sleeper leagues…';
  try {
    const user = await Sleeper.resolveUser(handle);
    const season = await Sleeper.currentSeason();
    const leagues = await Sleeper.leaguesForUser(user.user_id, season);

    await auth.updateProfile({ sleeper_user_id: user.user_id, sleeper_synced_at: new Date().toISOString() });
    await saveSleeperLeagues(auth.user.sub, leagues);

    if (!leagues.length) {
      out.innerHTML = 'No ' + season + ' leagues found for <strong>' + user.display_name + '</strong>.';
      return;
    }
    out.innerHTML =
      '<p>Synced <strong>' + leagues.length + '</strong> leagues for <strong>' + user.display_name + '</strong> (' + season + '):</p>' +
      '<ul>' + leagues.map(l => '<li>' + l.name + ' — ' + l.total_rosters + ' teams (' + l.status + ')</li>').join('') + '</ul>';
  } catch (e) {
    out.textContent = e.message;
  }
}