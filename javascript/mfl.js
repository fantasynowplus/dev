const MFL_WORKER = 'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/mfl';

const MFL = {
  async login(username, password, year) {
    const res = await fetch(MFL_WORKER + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, year })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      var msg = data.error || 'MFL login failed';
      if (data.upstreamStatus != null) {
        msg += ' — upstream ' + data.upstreamStatus + ' (' + (data.upstreamContentType || 'no content-type') + ')';
        if (data.redirectedTo) msg += ', redirected to ' + data.redirectedTo;
        msg += ': ' + data.upstreamBody;
      }
      throw new Error(msg);
    }
    return data;
  },
  async leagues(cookie, year) {
    const res = await fetch(MFL_WORKER + '/leagues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie, year })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Could not load MFL leagues');
    return res.json();
  }
};

async function saveMFLLeagues(userId, leagues) {
  const token = localStorage.getItem('sb-auth-token');
  const rows = leagues.map(l => ({
    user_id: userId,
    league_id: l.league_id,
    season: String(l.season),
    name: l.name,
    host: l.host,
    franchise_id: l.franchise_id,
    franchise_name: l.franchise_name,
    raw: l,
    synced_at: new Date().toISOString()
  }));
  const res = await fetch(SUPABASE_URL + '/rest/v1/mfl_leagues?on_conflict=user_id,league_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + token,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error('Could not save MFL leagues: ' + (await res.text()));
  return rows.length;
}

async function syncMyMFLLeagues() {
  const out = document.getElementById('mflResult');
  if (!auth.isAuthenticated()) { out.textContent = 'Please log in first.'; return; }
  const username = document.getElementById('fp_mfl_username').value.trim();
  const password = document.getElementById('fp_mfl_password').value;
  if (!username || !password) { out.textContent = 'Enter your MFL username and password above.'; return; }

  out.textContent = 'Signing in to MFL…';
  try {
    const year = new Date().getFullYear();
    const login = await MFL.login(username, password, year);
    out.textContent = 'Finding your leagues…';
    const leagues = await MFL.leagues(login.cookie, year);

    await auth.updateProfile({
      mfl_username: username,
      mfl_cookie: login.cookie,
      mfl_cookie_year: year,
      mfl_synced_at: new Date().toISOString()
    });
    await saveMFLLeagues(auth.user.sub, leagues);
    document.getElementById('fp_mfl_password').value = '';

    if (!leagues.length) {
      out.textContent = 'No ' + year + ' MFL leagues found for ' + username + '.';
      return;
    }
    out.innerHTML =
      '<p>Synced <strong>' + leagues.length + '</strong> MFL leagues for <strong>' + username + '</strong> (' + year + '):</p>' +
      '<ul>' + leagues.map(l => '<li>' + l.name + '</li>').join('') + '</ul>';
  } catch (e) {
    out.textContent = e.message;
  }
}