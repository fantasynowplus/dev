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

  function mflRecPointsByPosition(rulesRaw) {
    const rules = rulesRaw && rulesRaw.positionRules;
    if (!Array.isArray(rules)) return {};
    const out = {};
    rules.forEach(function (entry) {
      const items = Array.isArray(entry.rule) ? entry.rule : [entry.rule];
      items.forEach(function (r) {
        if (r && r.event && r.event.$t === 'CC') {
          const raw = (r.points && r.points.$t) || '0';
          const val = parseFloat(String(raw).replace('*', '')) || 0;
          String(entry.positions).split('|').forEach(function (pos) { out[pos] = val; });
        }
      });
    });
    return out;
  }
  function mflStarterSetsFromWeeklyResults(weeklyRaw) {
    const map = {};
    const matchups = weeklyRaw && weeklyRaw.matchup;
    const list = Array.isArray(matchups) ? matchups : (matchups ? [matchups] : []);
    list.forEach(function (m) {
      const franchises = Array.isArray(m.franchise) ? m.franchise : (m.franchise ? [m.franchise] : []);
      franchises.forEach(function (fr) {
        if (fr.starters) map[fr.id] = String(fr.starters).split(',').filter(Boolean);
      });
    });
    return map;
  }
  function mflScoringLabel(recPoints) {
    const v = recPoints.WR != null ? recPoints.WR : (recPoints.RB != null ? recPoints.RB : (recPoints.TE != null ? recPoints.TE : 0));
    if (v >= 1) return 'PPR';
    if (v >= 0.5) return 'HALF';
    return 'STD';
  }

  const mfl = {
    platform: 'mfl',
    normalizeLeague(leagueRaw, row, rulesRaw) {
      const starters = parseInt(leagueRaw.starters && leagueRaw.starters.count, 10) || null;
      const totalTeams = parseInt(leagueRaw.franchises && leagueRaw.franchises.count, 10) || null;
      const taxiSquad = parseInt(leagueRaw.taxiSquad, 10) || 0;
      const recPoints = rulesRaw ? mflRecPointsByPosition(rulesRaw) : {};
      return {
        id: leagueRaw.id || (row && row.league_id),
        platform: 'mfl',
        name: leagueRaw.name || (row && row.name) || 'League',
        season: (row && row.season) || null,
        totalTeams: totalTeams,
        format: taxiSquad > 0 ? 'dynasty' : 'redraft',
        scoring: rulesRaw ? mflScoringLabel(recPoints) : null,
        recPointsByPosition: recPoints,
        starters: starters,
        bestBall: leagueRaw.bestLineup === 'Yes',
        raw: leagueRaw
      };
    },
    normalizeTeams(leagueRaw, rosterFranchises, playersMap, userFranchiseId, standingsList, starterSets) {
      const nameMap = {};
      const franchiseList = (leagueRaw.franchises && leagueRaw.franchises.franchise) || [];
      (Array.isArray(franchiseList) ? franchiseList : [franchiseList]).forEach(function (f) {
        nameMap[f.id] = f.name;
      });
      const standingsMap = {};
      (standingsList || []).forEach(function (s) { standingsMap[s.id] = s; });
      return (rosterFranchises || []).map(function (fr) {
        const rawPlayers = fr.player || [];
        const playerList = Array.isArray(rawPlayers) ? rawPlayers : [rawPlayers];
        const starterIds = starterSets && starterSets[fr.id];
        const players = playerList.map(function (p) {
          const meta = playersMap[p.id] || {};
          let slot = 'bench';
          if (p.status === 'TAXI_SQUAD') slot = 'taxi';
          else if (p.status === 'INJURED_RESERVE') slot = 'ir';
          else if (starterIds && starterIds.indexOf(p.id) !== -1) slot = 'starter';
          return { id: p.id, name: meta.name || p.id, pos: meta.position || '', nflTeam: meta.team || '', slot: slot };
        });
        const st = standingsMap[fr.id] || {};
        return {
          id: fr.id,
          leagueId: leagueRaw.id,
          ownerName: nameMap[fr.id] || 'Team',
          isUser: fr.id === userFranchiseId,
          wins: parseInt(st.h2hw, 10) || 0,
          losses: parseInt(st.h2hl, 10) || 0,
          ties: parseInt(st.h2ht, 10) || 0,
          pointsFor: parseFloat(st.pf) || 0,
          potentialPoints: 0,
          players: players
        };
      });
    }
  };

  return { sleeper: sleeper, mfl: mfl };
})();
window.Adapters = Adapters;