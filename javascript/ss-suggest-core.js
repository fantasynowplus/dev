export const TEAM_ALIAS = {
  JAC: 'JAX', LA: 'LAR', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LAR',
  WSH: 'WAS', ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU'
};

export const normTeam = t => {
  const u = String(t || '').toUpperCase().trim();
  return TEAM_ALIAS[u] || u;
};

const clamp01 = n => Math.max(0, Math.min(1, n));

export function buildSuggestions({ rankings, dvp, schedule, config }) {
  const { bands, perSide = 2, uniqueTeamWithinPosition = true } = config;
  const out = {};

  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const [lo, hi] = bands[pos];
    const span = Math.max(1, hi - lo);

    const pool = rankings
      .filter(p => p.pos === pos && p.rank >= lo && p.rank <= hi)
      .map(p => {
        const team = normTeam(p.team);
        const game = schedule[team];
        if (!game) return null;
        const d = dvp?.defense?.[normTeam(game.opp)]?.[pos];
        if (!d || !d.rank) return null;
        return {
          name: p.name, pos, team, rank: p.rank,
          opp: normTeam(game.opp), home: game.home,
          dvpRank: d.rank, dvpPpg: d.ppg,
          dvpRankL3: d.l3_rank ?? null, dvpPpgL3: d.l3_ppg ?? null
        };
      })
      .filter(Boolean);

    // 0 = top of band, 1 = bottom of band
    // 0 = softest defense (dvp rank 1), 1 = toughest (dvp rank 32)
    for (const p of pool) {
      p._r = clamp01((p.rank - lo) / span);
      p._d = clamp01((p.dvpRank - 1) / 31);
      p._scoreTough = p._r + (1 - p._d);
      p._scoreSoft  = (1 - p._r) + p._d;
    }

    const take = (key) => {
      const seen = new Set();
      const picks = [];
      for (const p of [...pool].sort((a, b) => a[key] - b[key])) {
        if (uniqueTeamWithinPosition && seen.has(p.team)) continue;
        seen.add(p.team);
        picks.push(p);
        if (picks.length === perSide) break;
      }
      return picks;
    };

    const tough = take('_scoreTough');
    const toughIds = new Set(tough.map(p => p.name + p.team));
    const softPool = pool.filter(p => !toughIds.has(p.name + p.team));

    const seenSoft = new Set(uniqueTeamWithinPosition ? tough.map(p => p.team) : []);
    const soft = [];
    for (const p of softPool.sort((a, b) => a._scoreSoft - b._scoreSoft)) {
      if (uniqueTeamWithinPosition && seenSoft.has(p.team)) continue;
      seenSoft.add(p.team);
      soft.push(p);
      if (soft.length === perSide) break;
    }

    const strip = p => {
      const { _r, _d, _scoreTough, _scoreSoft, ...rest } = p;
      return rest;
    };
    out[pos] = { tough: tough.map(strip), soft: soft.map(strip) };
  }

  return out;
}

export function teamCollisions(selected) {
  const byTeam = {};
  for (const p of selected) (byTeam[p.team] ||= []).push(p);
  return Object.entries(byTeam)
    .filter(([, v]) => v.length > 1)
    .map(([team, v]) => ({ team, players: v.map(p => p.name) }));
}