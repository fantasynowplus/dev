const Adapters = (function () {
  function typeLabel(t) { return t === 2 ? 'dynasty' : t === 1 ? 'keeper' : 'redraft'; }
  function scoringLabel(s) { const rec = s && typeof s.rec === 'number' ? s.rec : 0; return rec >= 1 ? 'PPR' : rec >= 0.5 ? 'HALF' : 'STD'; }
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

  const sleeper = {
    platform: 'sleeper',
    normalizeLeague(row) {
      const raw = row.raw || {};
      return {
        id: row.league_id,
        platform: 'sleeper',
        name: row.name || raw.name || 'League',
        season: row.season || raw.season,
        totalTeams: raw.total_rosters || (raw.settings && raw.settings.num_teams),
        format: isDynasty(raw) ? 'dynasty' : typeLabel(raw.settings && raw.settings.type),
        scoring: scoringLabel(raw.scoring_settings),
        starters: startersCount(raw.roster_positions),
        bestBall: !!(raw.settings && raw.settings.best_ball === 1),
        raw: raw
      };
    },
    normalizeTeams(rosters, users, playersMap, userSleeperId) {
      const userMap = {};
      (users || []).forEach(function (u) {
        userMap[u.user_id] = (u.metadata && u.metadata.team_name) || u.display_name || 'Team';
      });
      return (rosters || []).map(function (r) {
        const starterIds = (r.starters || []).filter(function (id) { return id && id !== '0'; });
        const taxiIds = r.taxi || [];
        const reserveIds = r.reserve || [];
        const players = (r.players || []).map(function (pid) {
          const p = playersMap[pid] || {};
          const name = p.full_name || (((p.first_name || '') + ' ' + (p.last_name || '')).trim()) || pid;
          let slot = 'bench';
          if (starterIds.indexOf(pid) !== -1) slot = 'starter';
          else if (taxiIds.indexOf(pid) !== -1) slot = 'taxi';
          else if (reserveIds.indexOf(pid) !== -1) slot = 'ir';
          return { id: pid, name: name, pos: p.position || '', nflTeam: p.team || '', slot: slot };
        });
        return {
          id: String(r.roster_id),
          leagueId: r.league_id,
          ownerName: userMap[r.owner_id] || 'Team',
          isUser: r.owner_id === userSleeperId,
          wins: (r.settings && r.settings.wins) || 0,
          losses: (r.settings && r.settings.losses) || 0,
          ties: (r.settings && r.settings.ties) || 0,
          pointsFor: (r.settings && (r.settings.fpts + (r.settings.fpts_decimal || 0) / 100)) || 0,
          potentialPoints: (r.settings && (r.settings.ppts + (r.settings.ppts_decimal || 0) / 100)) || 0,
          players: players
        };
      });
    }
  };

  const mfl = {
    platform: 'mfl',
    normalizeLeague() { throw new Error('MFL adapter not built yet'); },
    normalizeTeams() { throw new Error('MFL adapter not built yet'); }
  };

  return { sleeper: sleeper, mfl: mfl };
})();
window.Adapters = Adapters;