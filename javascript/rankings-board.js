(function () {
  var thisScript = document.currentScript;
  var SLUG = thisScript ? thisScript.getAttribute('data-slug') : null;
  var WORKER = (thisScript && thisScript.getAttribute('data-worker')) ||
    'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev';

  var MOUNT_ID = 'rankings-board';
  var HEADSHOT_DIR = 'assets/staff/';
  var POSITION_LABELS = { OP: 'Overall', ALL: 'Overall', DST: 'D/ST', IDP: 'All IDP', FLEX: 'Flex' };
  var SCORING_OPTIONS = [['PPR', 'PPR'], ['HALF', 'Half PPR'], ['STD', 'Standard']];

  var PAGES = [];
  var page = null;
  var position = null;
  var scoring = 'PPR';
  var search = '';
  var sortCol = -1;
  var sortDir = 1;
  var data = null;
  var cache = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function headshotSrc(v) {
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return v.indexOf('/') >= 0 ? v.replace(/^\/+/, '') : HEADSHOT_DIR + v;
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join('');
  }

  function shortDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length < 3) return '';
    return parseInt(p[1], 10) + '/' + parseInt(p[2], 10);
  }

  function mount() {
    return document.getElementById(MOUNT_ID);
  }

  function waitForSupabase(cb) {
    var tries = 0;
    (function poll() {
      if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
        return cb(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
      if (++tries > 40) return cb(null, null);
      setTimeout(poll, 50);
    })();
  }

  function loadConfig(cb) {
    waitForSupabase(function (url, key) {
      if (!url || !key) return cb(null);
      fetch(url + '/rest/v1/rpc/rankings_public_config', {
        method: 'POST',
        headers: { 'apikey': key, 'Content-Type': 'application/json' },
        body: '{}'
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(cb)
        .catch(function () { cb(null); });
    });
  }

  function positionsFor(p) {
    return String(p.positions || 'QB:RB:WR:TE').split(':').filter(Boolean);
  }

  function defaultPosition(p) {
    var list = positionsFor(p);
    if (list.indexOf('OP') !== -1) return 'OP';
    if (list.indexOf('ALL') !== -1) return 'ALL';
    if (list.indexOf('IDP') !== -1) return 'IDP';
    return list[0];
  }

  function analystById(id) {
    var people = (page && page.analysts) || [];
    for (var i = 0; i < people.length; i++) {
      if (String(people[i].fp_id) === String(id)) return people[i];
    }
    return null;
  }

  function fetchRankings(cb) {
    var qs = new URLSearchParams({
      type: page.wtype || 'ST',
      position: position,
      scoring: scoring,
      year: String(page.year || 2026),
      week: String(page.week || 0)
    });
    if (page.expert) qs.set('expert', page.expert);
    if (page.filters) qs.set('filters', page.filters);

    var key = qs.toString();
    if (cache[key]) return cb(cache[key]);

    fetch(WORKER + '/expert-rankings?' + key)
      .then(function (r) {
        if (!r.ok) throw new Error('Rankings service returned ' + r.status);
        return r.json();
      })
      .then(function (d) { cache[key] = d; cb(d); })
      .catch(function (e) { cb({ error: e.message }); });
  }

  function shellHtml() {
    var setOptions = PAGES.map(function (p) {
      return '<option value="' + esc(p.slug) + '"' + (p.slug === page.slug ? ' selected' : '') + '>' +
        esc(p.name) + '</option>';
    }).join('');

    var scoringOptions = SCORING_OPTIONS.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === scoring ? ' selected' : '') + '>' +
        esc(o[1]) + '</option>';
    }).join('');

    var pills = positionsFor(page).map(function (p) {
      return '<button type="button" class="rb-pill' + (p === position ? ' on' : '') +
        '" data-pos="' + esc(p) + '">' + esc(POSITION_LABELS[p] || p) + '</button>';
    }).join('');

    return '' +
      '<div class="rb">' +
        '<div class="rb-bar">' +
          '<div class="rb-field rb-field-set">' +
            '<label for="rbSet">Ranking Set</label>' +
            '<select id="rbSet" class="rb-select rb-select-lg">' + setOptions + '</select>' +
          '</div>' +
          '<div class="rb-field">' +
            '<label for="rbScoring">Scoring</label>' +
            '<select id="rbScoring" class="rb-select">' + scoringOptions + '</select>' +
          '</div>' +
          '<div class="rb-field rb-field-search">' +
            '<label for="rbSearch">Search</label>' +
            '<input id="rbSearch" class="rb-search" type="search" placeholder="Filter players" value="' + esc(search) + '">' +
          '</div>' +
        '</div>' +
        '<div class="rb-pills" id="rbPills">' + pills + '</div>' +
        '<div class="rb-body" id="rbBody"></div>' +
      '</div>';
  }

  function tableHtml() {
    if (!data) return '<div class="rb-state">Loading rankings…</div>';
    if (data.error) {
      return '<div class="rb-state rb-error">Could not load rankings.<span>' + esc(data.error) + '</span></div>';
    }

    var players = data.players || [];
    if (!players.length) {
      return '<div class="rb-state">No rankings published for this view yet.</div>';
    }

    var experts = data.experts || [];
    var keep = [];
    for (var c = 0; c < experts.length; c++) {
      for (var r = 0; r < players.length; r++) {
        if (players[r].ranks && players[r].ranks[c] != null) { keep.push(c); break; }
      }
    }

    var term = search.trim().toLowerCase();
    var rows = players.filter(function (p) {
      if (!term) return true;
      return (p.name || '').toLowerCase().indexOf(term) !== -1 ||
             (p.team || '').toLowerCase().indexOf(term) !== -1;
    });

    if (sortCol >= 0) {
      rows = rows.slice().sort(function (a, b) {
        var av = a.ranks ? a.ranks[sortCol] : null;
        var bv = b.ranks ? b.ranks[sortCol] : null;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * sortDir;
      });
    }

    var head = '<tr>' +
      '<th class="rb-c-rank" data-sort="-1">#</th>' +
      '<th class="rb-c-player">Player</th>' +
      '<th class="rb-c-bye">Bye</th>' +
      keep.map(function (c) {
        var e = experts[c] || {};
        var a = analystById(e.id);
        var label = (a && a.name) || e.name || '';
        var hs = a ? headshotSrc(a.headshot) : '';
        var avatar = hs
          ? '<img class="rb-av" src="' + esc(hs) + '" alt="" data-ini="' + esc(initials(label)) + '">'
          : '<span class="rb-av rb-av-i">' + esc(initials(label)) + '</span>';
        var when = shortDate(e.updated);
        return '<th class="rb-c-exp' + (sortCol === c ? ' sorted' : '') + '" data-sort="' + c + '">' +
          '<div class="rb-exp-h">' + avatar +
            '<div class="rb-exp-t">' +
              '<span class="rb-exp-name">' + esc(label) + '</span>' +
              (when ? '<span class="rb-exp-date">' + esc(when) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</th>';
      }).join('') +
    '</tr>';

    var body = rows.map(function (p) {
      var photo = p.photoUrl
        ? '<img class="rb-photo" src="' + esc(p.photoUrl) + '" alt="" loading="lazy" data-fb="' + esc(p.teamLogoUrl || '') + '">'
        : (p.teamLogoUrl
            ? '<img class="rb-photo rb-photo-fb" src="' + esc(p.teamLogoUrl) + '" alt="" loading="lazy">'
            : '<span class="rb-photo rb-photo-x"></span>');

      var logo = p.teamLogoUrl
        ? '<img class="rb-logo" src="' + esc(p.teamLogoUrl) + '" alt="" loading="lazy">'
        : '';

      var nameCell = p.pageUrl
        ? '<a href="' + esc(p.pageUrl) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>'
        : esc(p.name);

      return '<tr>' +
        '<td class="rb-c-rank">' + esc(p.rank == null ? '' : p.rank) + '</td>' +
        '<td class="rb-c-player">' +
          '<div class="rb-who">' + photo +
            '<div class="rb-who-t">' +
              '<div class="rb-name">' + nameCell +
                (p.isRookie ? '<span class="rb-rookie">R</span>' : '') + '</div>' +
              '<div class="rb-meta">' + logo +
                '<span class="rb-pos rb-pos-' + esc(p.position || '') + '">' + esc(p.position || '') + '</span>' +
                '<span class="rb-team">' + esc(p.team || '') + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td class="rb-c-bye">' + esc(p.byeWeek || '—') + '</td>' +
        keep.map(function (c) {
          var v = p.ranks ? p.ranks[c] : null;
          return '<td class="rb-c-exp' + (v == null ? ' rb-none' : '') + '">' +
            (v == null ? '&ndash;' : esc(v)) + '</td>';
        }).join('') +
      '</tr>';
    }).join('');

    if (!rows.length) {
      body = '<tr><td class="rb-state" colspan="' + (3 + keep.length) + '">No players match “' + esc(search) + '”.</td></tr>';
    }

    return '<div class="rb-scroll"><table class="rb-table">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function paintBody() {
    var el = document.getElementById('rbBody');
    if (!el) return;
    el.innerHTML = tableHtml();

    el.querySelectorAll('.rb-photo[data-fb]').forEach(function (img) {
      img.addEventListener('error', function () {
        var fb = img.getAttribute('data-fb');
        img.removeAttribute('data-fb');
        if (fb) { img.src = fb; img.classList.add('rb-photo-fb'); }
        else { img.classList.add('rb-photo-x'); }
      });
    });

    el.querySelectorAll('.rb-av[data-ini]').forEach(function (img) {
      img.addEventListener('error', function () {
        var sp = document.createElement('span');
        sp.className = 'rb-av rb-av-i';
        sp.textContent = img.getAttribute('data-ini');
        if (img.parentNode) img.parentNode.replaceChild(sp, img);
      });
    });

    el.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var c = parseInt(th.getAttribute('data-sort'), 10);
        if (c < 0) { sortCol = -1; }
        else if (c === sortCol) { sortDir = -sortDir; }
        else { sortCol = c; sortDir = 1; }
        paintBody();
      });
    });
  }

  function load() {
    data = null;
    paintBody();
    fetchRankings(function (d) { data = d; paintBody(); });
  }

  function paintAll() {
    var el = mount();
    if (!el) return;
    el.innerHTML = shellHtml();

    document.getElementById('rbSet').addEventListener('change', function (e) {
      var next = PAGES.filter(function (p) { return p.slug === e.target.value; })[0];
      if (!next) return;
      page = next;
      sortCol = -1;
      if (positionsFor(page).indexOf(position) === -1) position = defaultPosition(page);
      if (page.scoring) scoring = page.scoring;
      if (page.heading) {
        var h = document.querySelector('[data-rankings-heading]');
        if (h) h.textContent = page.heading;
        document.title = page.heading + ' | FantasyNow+';
      }
      if (page.url) history.pushState({ slug: page.slug }, '', page.url);
      paintAll();
      load();
    });

    document.getElementById('rbScoring').addEventListener('change', function (e) {
      scoring = e.target.value;
      load();
    });

    document.getElementById('rbSearch').addEventListener('input', function (e) {
      search = e.target.value;
      paintBody();
    });

    document.getElementById('rbPills').addEventListener('click', function (e) {
      var btn = e.target.closest('.rb-pill');
      if (!btn) return;
      position = btn.getAttribute('data-pos');
      sortCol = -1;
      paintAll();
      load();
    });

    paintBody();
  }

  function start() {
    var el = mount();
    if (!el) return;
    el.innerHTML = '<div class="rb-state">Loading rankings…</div>';

    loadConfig(function (pages) {
      if (!pages || !pages.length) {
        el.innerHTML = '<div class="rb-state rb-error">Rankings are temporarily unavailable.</div>';
        return;
      }
      PAGES = pages;
      page = pages.filter(function (p) { return p.slug === SLUG; })[0] || pages[0];
      position = defaultPosition(page);
      scoring = page.scoring || 'PPR';

      var h = document.querySelector('[data-rankings-heading]');
      if (h && page.heading) h.textContent = page.heading;

      paintAll();
      load();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();