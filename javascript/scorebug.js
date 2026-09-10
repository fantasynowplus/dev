// Score bug — pulls current-week NFL games from ESPN's public scoreboard
// endpoint (no key required) and renders them into #scorebug-root.
// Polls faster while a game is actually live, slower otherwise.
(function () {
  var ENDPOINT = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  var LIVE_REFRESH_MS = 15000;
  var IDLE_REFRESH_MS = 60000;

  function formatStatus(event) {
    var status = event.status && event.status.type ? event.status.type : {};
    if (status.state === 'in') {
      return { text: status.shortDetail || 'Live', live: true };
    }
    if (status.state === 'post') {
      return { text: 'Final' + (status.detail && status.detail.indexOf('OT') > -1 ? '/OT' : ''), live: false };
    }
    var date = new Date(event.date);
    var day = date.toLocaleDateString('en-US', { weekday: 'short' });
    var time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return { text: day + ' ' + time, live: false };
  }

  function teamRow(competitor, gameIsFinal) {
    var team = competitor.team || {};
    var score = competitor.score;
    var isLoser = gameIsFinal && competitor.winner === false;
    var row = document.createElement('div');
    row.className = 'scorebug-team' + (isLoser ? ' is-loser' : '');

    var nameWrap = document.createElement('div');
    nameWrap.className = 'scorebug-team-name';

    var logo = document.createElement('img');
    logo.src = team.logo || '';
    logo.alt = team.abbreviation || '';
    logo.loading = 'lazy';

    var abbr = document.createElement('span');
    abbr.className = 'scorebug-abbr';
    abbr.textContent = team.abbreviation || team.shortDisplayName || '';

    nameWrap.appendChild(logo);
    nameWrap.appendChild(abbr);

    var scoreEl = document.createElement('span');
    scoreEl.className = 'scorebug-score';
    scoreEl.textContent = score !== undefined && score !== null && score !== '' ? score : '';

    row.appendChild(nameWrap);
    row.appendChild(scoreEl);
    return row;
  }

  function gameCard(event) {
    var competition = event.competitions && event.competitions[0];
    if (!competition) return null;

    var competitors = competition.competitors || [];
    var away = competitors.filter(function (c) { return c.homeAway === 'away'; })[0];
    var home = competitors.filter(function (c) { return c.homeAway === 'home'; })[0];
    if (!away || !home) return null;

    var statusInfo = formatStatus(event);
    var isFinal = event.status && event.status.type && event.status.type.state === 'post';

    var card = document.createElement('div');
    card.className = 'scorebug-game';

    card.appendChild(teamRow(away, isFinal));
    card.appendChild(teamRow(home, isFinal));

    var statusRow = document.createElement('div');
    statusRow.className = 'scorebug-status' + (statusInfo.live ? ' is-live' : '');

    if (statusInfo.live) {
      var dot = document.createElement('span');
      dot.className = 'scorebug-live-dot';
      statusRow.appendChild(dot);
    }

    var statusText = document.createElement('span');
    statusText.textContent = statusInfo.text;
    statusRow.appendChild(statusText);

    var broadcast = competition.broadcasts && competition.broadcasts[0] && competition.broadcasts[0].names
      ? competition.broadcasts[0].names[0]
      : null;
    if (broadcast && !statusInfo.live) {
      var net = document.createElement('span');
      net.className = 'scorebug-network';
      net.textContent = broadcast;
      statusRow.appendChild(net);
    }

    card.appendChild(statusRow);
    return card;
  }

  function updateNavVisibility(inner, prevBtn, nextBtn) {
    var scrollable = inner.scrollWidth > inner.clientWidth + 4;
    prevBtn.classList.toggle('is-visible', scrollable && inner.scrollLeft > 4);
    nextBtn.classList.toggle('is-visible', scrollable && inner.scrollLeft < inner.scrollWidth - inner.clientWidth - 4);
  }

  function render(inner, events) {
    inner.innerHTML = '';

    if (!events || !events.length) {
      var empty = document.createElement('div');
      empty.className = 'scorebug-empty';
      empty.textContent = 'No NFL games scheduled this week.';
      inner.appendChild(empty);
      return false;
    }

    var anyLive = false;
    events
      .slice()
      .sort(function (a, b) { return new Date(a.date) - new Date(b.date); })
      .forEach(function (event) {
        var card = gameCard(event);
        if (card) inner.appendChild(card);
        if (event.status && event.status.type && event.status.type.state === 'in') {
          anyLive = true;
        }
      });
    return anyLive;
  }

  function init() {
    var root = document.getElementById('scorebug-root');
    if (!root) return;

    root.innerHTML =
      '<div class="scorebug">' +
        '<button class="scorebug-nav scorebug-nav-prev" aria-label="Scroll left">&#8249;</button>' +
        '<div class="scorebug-inner"></div>' +
        '<button class="scorebug-nav scorebug-nav-next" aria-label="Scroll right">&#8250;</button>' +
      '</div>';

    var inner = root.querySelector('.scorebug-inner');
    var prevBtn = root.querySelector('.scorebug-nav-prev');
    var nextBtn = root.querySelector('.scorebug-nav-next');

    prevBtn.addEventListener('click', function () {
      inner.scrollBy({ left: -300, behavior: 'smooth' });
    });
    nextBtn.addEventListener('click', function () {
      inner.scrollBy({ left: 300, behavior: 'smooth' });
    });
    inner.addEventListener('scroll', function () {
      updateNavVisibility(inner, prevBtn, nextBtn);
    });
    window.addEventListener('resize', function () {
      updateNavVisibility(inner, prevBtn, nextBtn);
    });

    function tick() {
      fetch(ENDPOINT)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var anyLive = render(inner, data.events);
          updateNavVisibility(inner, prevBtn, nextBtn);
          setTimeout(tick, anyLive ? LIVE_REFRESH_MS : IDLE_REFRESH_MS);
        })
        .catch(function (err) {
          console.error('scorebug: failed to load scores', err);
          setTimeout(tick, IDLE_REFRESH_MS);
        });
    }

    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();