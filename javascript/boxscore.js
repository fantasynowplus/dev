// Game box score overlay — fetches ESPN's boxscore for a clicked game and
// shows each player's stat line with Standard / Half-PPR / PPR fantasy points.
(function () {
  var backdrop, panel;
  var currentScoring = 'half';
  var lastData = null;

  function ensureModal() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'boxscore-backdrop';
    backdrop.innerHTML =
      '<div class="boxscore-panel">' +
        '<button class="boxscore-close" aria-label="Close">&times;</button>' +
        '<div class="boxscore-body"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    panel = backdrop.querySelector('.boxscore-body');

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close();
    });
    backdrop.querySelector('.boxscore-close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function close() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  function open(eventId) {
    ensureModal();
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    panel.innerHTML = '<div class="boxscore-loading">Loading box score…</div>';

    fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=' + eventId)
      .then(function (res) { return res.json(); })
      .then(function (data) { render(data); })
      .catch(function (err) {
        console.error('boxscore: failed to load', err);
        panel.innerHTML = '<div class="boxscore-loading">Couldn\'t load this box score.</div>';
      });
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

  function collectPlayers(teamBlock) {
    var players = {};

    function getPlayer(athlete) {
      if (!players[athlete.id]) {
        players[athlete.id] = {
          name: athlete.displayName,
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

  function positionLabel(positions) {
    if (positions.indexOf('QB') > -1) return 'QB';
    if (positions.indexOf('K') > -1) return 'K';
    if (positions.indexOf('WR') > -1 && positions.indexOf('RB') > -1) return 'RB/WR';
    if (positions.indexOf('WR') > -1) return 'WR';
    if (positions.indexOf('RB') > -1) return 'RB';
    return '';
  }

  function statLine(p) {
    var parts = [];
    if (p.passYds || p.passTD || p.passInt) parts.push(p.passYds + ' pass yds, ' + p.passTD + ' TD, ' + p.passInt + ' INT');
    if (p.rushYds || p.rushTD) parts.push(p.rushYds + ' rush yds, ' + p.rushTD + ' TD');
    if (p.receptions || p.recYds || p.recTD) parts.push(p.receptions + ' rec, ' + p.recYds + ' yds, ' + p.recTD + ' TD');
    if (p.fgMade || p.xpMade) parts.push(p.fgMade + ' FG, ' + p.xpMade + ' XP');
    return parts.join(' · ');
  }

  function renderTeamColumn(teamBlock) {
    var players = collectPlayers(teamBlock).sort(function (a, b) {
      return fantasyPoints(b, currentScoring) - fantasyPoints(a, currentScoring);
    });

    var html = '<div class="boxscore-team-col">';
    html += '<h3><img src="' + teamBlock.team.logo + '" alt=""> ' + teamBlock.team.displayName + '</h3>';

    if (!players.length) {
      html += '<div class="boxscore-empty">No player stats yet.</div>';
    } else {
      players.forEach(function (p) {
        html +=
          '<div class="boxscore-player-row">' +
            '<div>' +
              '<div class="boxscore-player-name">' + p.name + ' <span class="boxscore-player-meta">' + positionLabel(p.positions) + '</span></div>' +
              '<div class="boxscore-player-meta">' + statLine(p) + '</div>' +
            '</div>' +
            '<div class="boxscore-player-pts">' + fantasyPoints(p, currentScoring).toFixed(1) + '</div>' +
          '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function render(data) {
    lastData = data;
    var players = data.boxscore && data.boxscore.players;

    if (!players || !players.length) {
      panel.innerHTML = '<div class="boxscore-loading">Stats aren\'t available for this game yet.</div>';
      return;
    }

    var comp = data.header && data.header.competitions && data.header.competitions[0];
    var title = comp && comp.competitors
      ? comp.competitors.map(function (c) { return c.team.abbreviation + ' ' + (c.score || ''); }).join('  @  ')
      : 'Box Score';

    var html = '<div class="boxscore-header"><h2>' + title + '</h2></div>';
    html +=
      '<div class="boxscore-scoring-toggle">' +
        '<button data-scoring="standard">Standard</button>' +
        '<button data-scoring="half">Half-PPR</button>' +
        '<button data-scoring="ppr">PPR</button>' +
      '</div>';
    html += '<div class="boxscore-teams">' + players.map(renderTeamColumn).join('') + '</div>';

    panel.innerHTML = html;

    var buttons = panel.querySelectorAll('.boxscore-scoring-toggle button');
    buttons.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.scoring === currentScoring);
      btn.addEventListener('click', function () {
        currentScoring = btn.dataset.scoring;
        render(lastData);
      });
    });
  }

  window.openBoxscore = open;
})();
