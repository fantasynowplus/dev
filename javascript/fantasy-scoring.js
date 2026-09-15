(function () {
  var SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  var SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=';
  var TOP_N = 25;

  var currentScoring = 'half';
  var allPlayers = [];
  var searchEl, resultsEl, statusEl, toggleButtons;
  var teamPositionCache = {};

  function fetchTeamPositions(teamId) {
    if (!teamPositionCache[teamId]) {
      teamPositionCache[teamId] = fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/' + teamId + '/roster')
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var map = {};
          (data.athletes || []).forEach(function (group) {
            (group.items || []).forEach(function (a) {
              map[a.id] = a.position && a.position.abbreviation;
            });
          });
          return map;
        })
        .catch(function () { return {}; });
    }
    return teamPositionCache[teamId];
  }

  function statVal(group, athleteStats, label) {
    var idx = group.labels.indexOf(label);
    if (idx === -1) return 0;
    var num = parseFloat(athleteStats[idx]);
    return isNaN(num) ? 0 : num;
  }

  function fantasyPoints(p, scoring) {
    var pts = 0;
    pts += p.passYds / 25;
    pts += p.passTD * 4;
    pts += p.passInt * -2;
    pts += p.rushYds / 10;
    pts += p.rushTD * 6;
    pts += p.recYds / 10;
    pts += p.recTD * 6;
    pts += p.receptions * (scoring === 'ppr' ? 1 : scoring === 'half' ? 0.5 : 0);
    pts += p.fgMade * 3;
    pts += p.xpMade * 1;
    return Math.round(pts * 10) / 10;
  }

  function guessPosition(positions) {
    if (positions.indexOf('QB') > -1) return 'QB';
    if (positions.indexOf('K') > -1) return 'K';
    if (positions.indexOf('RB') > -1) return 'RB';
    if (positions.indexOf('WR') > -1) return 'WR';
    return '—';
  }

  function statLine(p) {
    var parts = [];
    if (p.passYds || p.passTD || p.passInt) parts.push(p.passYds + ' pass yds, ' + p.passTD + ' TD, ' + p.passInt + ' INT');
    if (p.rushYds || p.rushTD) parts.push(p.rushYds + ' rush yds, ' + p.rushTD + ' TD');
    if (p.receptions || p.recYds || p.recTD) parts.push(p.receptions + ' rec, ' + p.recYds + ' yds, ' + p.recTD + ' TD');
    if (p.fgMade || p.xpMade) parts.push(p.fgMade + ' FG, ' + p.xpMade + ' XP');
    return parts.join(' · ') || '—';
  }

  function collectPlayers(teamBlock, teamAbbr, oppAbbr, gameStatus, positionMap) {
    var players = {};

    function getPlayer(athlete) {
      if (!players[athlete.id]) {
        players[athlete.id] = {
          name: athlete.displayName,
          team: teamAbbr,
          opp: oppAbbr,
          status: gameStatus,
          position: (positionMap && positionMap[athlete.id]) || null,
          passYds: 0, passTD: 0, passInt: 0,
          rushYds: 0, rushTD: 0,
          receptions: 0, recYds: 0, recTD: 0,
          fgMade: 0, xpMade: 0,
          positions: []
        };
      }
      return players[athlete.id];
    }

    (teamBlock.statistics || []).forEach(function (group) {
      if (['passing', 'rushing', 'receiving', 'kicking'].indexOf(group.name) === -1) return;

      (group.athletes || []).forEach(function (a) {
        var p = getPlayer(a.athlete);
        var s = a.stats;

        if (group.name === 'passing') {
          p.passYds += statVal(group, s, 'YDS');
          p.passTD += statVal(group, s, 'TD');
          p.passInt += statVal(group, s, 'INT');
          p.positions.push('QB');
        } else if (group.name === 'rushing') {
          p.rushYds += statVal(group, s, 'YDS');
          p.rushTD += statVal(group, s, 'TD');
          p.positions.push('RB');
        } else if (group.name === 'receiving') {
          p.receptions += statVal(group, s, 'REC');
          p.recYds += statVal(group, s, 'YDS');
          p.recTD += statVal(group, s, 'TD');
          p.positions.push('WR');
        } else if (group.name === 'kicking') {
          var fg = s[group.labels.indexOf('FG')] || '0/0';
          var xp = s[group.labels.indexOf('XP')] || '0/0';
          p.fgMade += parseInt(fg.split('/')[0], 10) || 0;
          p.xpMade += parseInt(xp.split('/')[0], 10) || 0;
          p.positions.push('K');
        }
      });
    });

    return Object.keys(players).map(function (id) { return players[id]; });
  }

  function loadGame(game) {
    return fetch(SUMMARY + game.id)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var teams = data.boxscore && data.boxscore.players;
        if (!teams || teams.length < 2) return [];

        var t0 = teams[0].team.abbreviation;
        var t1 = teams[1].team.abbreviation;

        return Promise.all([
          fetchTeamPositions(teams[0].team.id),
          fetchTeamPositions(teams[1].team.id)
        ]).then(function (maps) {
          return collectPlayers(teams[0], t0, t1, game.statusText, maps[0])
            .concat(collectPlayers(teams[1], t1, t0, game.statusText, maps[1]));
        });
      })
      .catch(function () { return []; });
  }

  function loadWeek() {
    statusEl.textContent = 'Loading this week\'s games…';

    return fetch(SCOREBOARD)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var games = (data.events || [])
          .filter(function (e) {
            var state = e.status && e.status.type && e.status.type.state;
            return state === 'in' || state === 'post';
          })
          .map(function (e) {
            var type = e.status.type;
            return {
              id: e.id,
              statusText: type.state === 'in' ? (type.shortDetail || 'Live') : 'Final'
            };
          });

        if (!games.length) {
          statusEl.textContent = 'No games have started yet this week — check back once kickoff hits.';
          return [];
        }

        statusEl.textContent = 'Loading stats for ' + games.length + ' game' + (games.length === 1 ? '' : 's') + '…';
        return Promise.all(games.map(loadGame));
      })
      .then(function (perGame) {
        allPlayers = [].concat.apply([], perGame);
        statusEl.textContent = allPlayers.length
          ? 'Showing stats from ' + allPlayers.length + ' players across today\'s games.'
          : 'No player stats available yet.';
        render();
      })
      .catch(function () {
        statusEl.textContent = 'Couldn\'t load this week\'s games. Try refreshing.';
      });
  }

  function render() {
    var query = searchEl.value.trim().toLowerCase();

    var ranked = allPlayers
      .slice()
      .sort(function (a, b) { return fantasyPoints(b, currentScoring) - fantasyPoints(a, currentScoring); })
      .map(function (p, i) { return { player: p, rank: i + 1 }; });

    var rows = query
      ? ranked.filter(function (r) { return r.player.name.toLowerCase().indexOf(query) > -1; })
      : ranked.slice(0, TOP_N);

    resultsEl.innerHTML = '';

    if (!rows.length) {
      resultsEl.innerHTML = '<tr><td colspan="8" class="fs-statline">' +
        (query ? 'No player matching "' + query + '" has stats this week.' : 'No stats yet.') +
        '</td></tr>';
      return;
    }

    rows.forEach(function (r) {
      var p = r.player;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="fs-rank">' + r.rank + '</td>' +
        '<td class="fs-player-name"><a class="fs-player-link" href="my-leagues?player=' + encodeURIComponent(p.name) + '&pos=' + encodeURIComponent(p.position || '') + '">' + p.name + '</a></td>' +
        '<td>' + (p.position || guessPosition(p.positions)) + '</td>' +
        '<td>' + p.team + '</td>' +
        '<td>' + p.opp + '</td>' +
        '<td class="fs-statline">' + statLine(p) + '</td>' +
        '<td class="' + (p.status === 'Final' ? '' : 'fs-live') + '">' + p.status + '</td>' +
        '<td class="fs-pts">' + fantasyPoints(p, currentScoring).toFixed(1) + '</td>';
      resultsEl.appendChild(tr);
    });
  }

  function init() {
    searchEl = document.getElementById('fs-search');
    resultsEl = document.getElementById('fs-results');
    statusEl = document.getElementById('fs-status');
    toggleButtons = document.querySelectorAll('.fs-scoring-toggle button');

    searchEl.addEventListener('input', render);

    toggleButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentScoring = btn.dataset.scoring;
        toggleButtons.forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        render();
      });
    });

    loadWeek();
    setInterval(loadWeek, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
