(function () {
  var thisScript = document.currentScript;
  var SLUG = thisScript ? thisScript.getAttribute('data-slug') : null;
  var WORKER = (thisScript && thisScript.getAttribute('data-worker')) ||
    'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev';

  var MOUNT_ID = 'rankings-board';
  var HEADSHOT_DIR = 'assets/staff/';
  var POSITION_LABELS = { OP: 'Superflex', ALL: 'Overall', DST: 'D/ST', IDP: 'All IDP', FLEX: 'Flex' };
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

  var ovOpen = false;
  var ovExpert = null;
  var ovSlug = null;
  var ovPosition = null;
  var ovData = null;

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

  function mount() { return document.getElementById(MOUNT_ID); }

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
    if (list.indexOf('ALL') !== -1) return 'ALL';
    if (list.indexOf('OP') !== -1) return 'OP';
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

  function requestFor(p, pos, sc, filterIds) {
    var qs = new URLSearchParams({
      type: p.wtype || 'ST',
      position: pos,
      scoring: sc,
      year: String(p.year || 2026),
      week: String(p.week || 0)
    });
    if (p.expert) qs.set('expert', p.expert);
    if (filterIds) qs.set('filters', filterIds);
    else if (p.filters) qs.set('filters', p.filters);
    return qs.toString();
  }

  function fetchRankings(key, cb) {
    if (cache[key]) return cb(cache[key]);
    fetch(WORKER + '/expert-rankings?' + key)
      .then(function (r) {
        if (!r.ok) throw new Error('Rankings service returned ' + r.status);
        return r.json();
      })
      .then(function (d) { cache[key] = d; cb(d); })
      .catch(function (e) { cb({ error: e.message }); });
  }

  function keptColumns(d) {
    var keep = [];
    var experts = (d && d.experts) || [];
    var players = (d && d.players) || [];
    for (var c = 0; c < experts.length; c++) {
      for (var r = 0; r < players.length; r++) {
        if (players[r].ranks && players[r].ranks[c] != null) { keep.push(c); break; }
      }
    }
    return keep;
  }

  function isLoggedIn() {
    try {
      if (typeof auth !== 'undefined' && auth && auth.user) return true;
      var t = localStorage.getItem('sb-auth-token');
      if (!t) return false;
      var d = JSON.parse(atob(t.split('.')[1]));
      return !!d.exp && d.exp * 1000 > Date.now();
    } catch (e) { return false; }
  }

  function promptLogin() {
    var link = document.querySelector('.btn-login');
    if (link) { link.click(); return; }
    window.location.href = 'login.html';
  }

  function downloadCsv() {
    if (!isLoggedIn()) { promptLogin(); return; }
    if (!data || !data.players || !data.players.length) return;
    var keep = keptColumns(data);
    var head = ['Rank', 'Player', 'Team', 'Position', 'Bye'].concat(keep.map(function (c) {
      var e = data.experts[c] || {};
      var a = analystById(e.id);
      return (a && a.name) || e.name || '';
    }));

    function cell(v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    var lines = [head.map(cell).join(',')];
    data.players.forEach(function (p) {
      var row = [p.rank, p.name, p.team, p.position, p.byeWeek]
        .concat(keep.map(function (c) { return p.ranks ? p.ranks[c] : ''; }));
      lines.push(row.map(cell).join(','));
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fantasynowplus-' + page.slug + '-' + position.toLowerCase() + '-' + scoring.toLowerCase() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
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
          '<div class="rb-field">' +
            '<label>&nbsp;</label>' +
            '<button type="button" id="rbCsv" class="rb-csv' + (isLoggedIn() ? '' : ' rb-csv-lock') + '">' +
              (isLoggedIn() ? 'Download CSV' : 'Log in to download') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="rb-pills" id="rbPills">' + pills + '</div>' +
        '<div class="rb-body" id="rbBody"></div>' +
      '</div>' +
      '<div class="rb-ov" id="rbOv" hidden><div class="rb-ov-box" id="rbOvBox"></div></div>';
  }

  function tableHtml() {
    if (!data) return '<div class="rb-state">Loading rankings…</div>';
    if (data.error) {
      return '<div class="rb-state rb-error">Could not load rankings.<span>' + esc(data.error) + '</span></div>';
    }

    var players = data.players || [];
    if (!players.length) return '<div class="rb-state">No rankings published for this view yet.</div>';

    var experts = data.experts || [];
    var keep = keptColumns(data);

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
              '<button type="button" class="rb-exp-name" data-expert="' + esc(e.id) + '">' + esc(label) + '</button>' +
              (when ? '<span class="rb-exp-date">' + esc(when) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</th>';
      }).join('') +
    '</tr>';

    var body = rows.map(function (p) { return rowHtml(p, keep); }).join('');

    if (!rows.length) {
      body = '<tr><td class="rb-state" colspan="' + (3 + keep.length) + '">No players match “' + esc(search) + '”.</td></tr>';
    }

    return '<div class="rb-scroll"><table class="rb-table">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function playerCellHtml(p) {
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

    return '<div class="rb-who">' + photo +
        '<div class="rb-who-t">' +
          '<div class="rb-name">' + nameCell + (p.isRookie ? '<span class="rb-rookie">R</span>' : '') + '</div>' +
          '<div class="rb-meta">' + logo +
            '<span class="rb-pos rb-pos-' + esc(p.position || '') + '">' + esc(p.position || '') + '</span>' +
            '<span class="rb-team">' + esc(p.team || '') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function rowHtml(p, keep) {
    return '<tr>' +
      '<td class="rb-c-rank">' + esc(p.rank == null ? '' : p.rank) + '</td>' +
      '<td class="rb-c-player">' + playerCellHtml(p) + '</td>' +
      '<td class="rb-c-bye">' + esc(p.byeWeek || '—') + '</td>' +
      keep.map(function (c) {
        var v = p.ranks ? p.ranks[c] : null;
        return '<td class="rb-c-exp' + (v == null ? ' rb-none' : '') + '">' +
          (v == null ? '&ndash;' : esc(v)) + '</td>';
      }).join('') +
    '</tr>';
  }

  function openOverlay(expertId) {
    var e = null;
    (data.experts || []).forEach(function (x) { if (String(x.id) === String(expertId)) e = x; });
    if (!e) return;
    ovExpert = e;
    ovSlug = page.slug;
    ovPosition = position;
    ovData = null;
    ovOpen = true;
    document.getElementById('rbOv').hidden = false;
    document.body.style.overflow = 'hidden';
    paintOverlay();
    loadOverlay();
  }

  function closeOverlay() {
    ovOpen = false;
    document.getElementById('rbOv').hidden = true;
    document.body.style.overflow = '';
  }

  function loadOverlay() {
    var p = PAGES.filter(function (x) { return x.slug === ovSlug; })[0] || page;
    if (positionsFor(p).indexOf(ovPosition) === -1) ovPosition = defaultPosition(p);
    fetchRankings(requestFor(p, ovPosition, scoring, ovExpert.id), function (d) {
      ovData = d;
      paintOverlay();
    });
  }

  function ovUpdatedLabel() {
    var p = PAGES.filter(function (x) { return x.slug === ovSlug; })[0];
    var setName = (p && p.name) || '';
    if (!ovData || ovData.error) return setName;
    var e = null;
    (ovData.experts || []).forEach(function (x) {
      if (String(x.id) === String(ovExpert.id)) e = x;
    });
    var when = e && e.updated ? shortDate(e.updated) : '';
    return when ? setName + ' · updated ' + when : setName + ' · not published';
  }

  function paintOverlay() {
    var box = document.getElementById('rbOvBox');
    if (!box) return;

    var a = analystById(ovExpert.id);
    var label = (a && a.name) || ovExpert.name || '';
    var hs = a ? headshotSrc(a.headshot) : '';
    var avatar = hs
      ? '<img class="rb-ov-av" src="' + esc(hs) + '" alt="">'
      : '<span class="rb-ov-av rb-av-i">' + esc(initials(label)) + '</span>';

    var p = PAGES.filter(function (x) { return x.slug === ovSlug; })[0] || page;
    var setOptions = PAGES.map(function (x) {
      return '<option value="' + esc(x.slug) + '"' + (x.slug === ovSlug ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    var pills = positionsFor(p).map(function (x) {
      return '<button type="button" class="rb-pill' + (x === ovPosition ? ' on' : '') +
        '" data-ovpos="' + esc(x) + '">' + esc(POSITION_LABELS[x] || x) + '</button>';
    }).join('');

    var listHtml;
    if (!ovData) listHtml = '<div class="rb-state">Loading…</div>';
    else if (ovData.error) listHtml = '<div class="rb-state rb-error">Could not load rankings.</div>';
    else {
      var rows = (ovData.players || []).filter(function (pl) {
        return pl.ranks && pl.ranks[0] != null;
      }).sort(function (x, y) { return x.ranks[0] - y.ranks[0]; });

      listHtml = rows.length
        ? '<table class="rb-table rb-ov-table"><tbody>' + rows.map(function (pl) {
            return '<tr><td class="rb-c-rank">' + esc(pl.ranks[0]) + '</td>' +
              '<td class="rb-c-player">' + playerCellHtml(pl) + '</td>' +
              '<td class="rb-c-bye">' + esc(pl.byeWeek || '—') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="rb-state">' + esc(label) + ' hasn’t published rankings for this view.</div>';
    }

    box.innerHTML =
      '<div class="rb-ov-head">' + avatar +
        '<div class="rb-ov-t"><h3>' + esc(label) + '</h3>' +
          '<span>' + esc(ovUpdatedLabel()) + '</span>' +
        '</div>' +
        '<button type="button" class="rb-ov-x" id="rbOvClose" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="rb-ov-controls">' +
        '<select class="rb-select" id="rbOvSet">' + setOptions + '</select>' +
        '<div class="rb-pills rb-ov-pills" id="rbOvPills">' + pills + '</div>' +
      '</div>' +
      '<div class="rb-ov-list">' + listHtml + '</div>';

    document.getElementById('rbOvClose').addEventListener('click', closeOverlay);
    document.getElementById('rbOvSet').addEventListener('change', function (ev) {
      ovSlug = ev.target.value;
      ovData = null;
      paintOverlay();
      loadOverlay();
    });
    document.getElementById('rbOvPills').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-ovpos]');
      if (!btn) return;
      ovPosition = btn.getAttribute('data-ovpos');
      ovData = null;
      paintOverlay();
      loadOverlay();
    });
    box.querySelectorAll('.rb-photo[data-fb]').forEach(bindPhotoFallback);
  }

  function bindPhotoFallback(img) {
    img.addEventListener('error', function () {
      var fb = img.getAttribute('data-fb');
      img.removeAttribute('data-fb');
      if (fb) { img.src = fb; img.classList.add('rb-photo-fb'); }
      else { img.classList.add('rb-photo-x'); }
    });
  }

  function paintBody() {
    var el = document.getElementById('rbBody');
    if (!el) return;
    el.innerHTML = tableHtml();

    el.querySelectorAll('.rb-photo[data-fb]').forEach(bindPhotoFallback);

    el.querySelectorAll('.rb-av[data-ini]').forEach(function (img) {
      img.addEventListener('error', function () {
        var sp = document.createElement('span');
        sp.className = 'rb-av rb-av-i';
        sp.textContent = img.getAttribute('data-ini');
        if (img.parentNode) img.parentNode.replaceChild(sp, img);
      });
    });

    el.querySelectorAll('.rb-exp-name[data-expert]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openOverlay(btn.getAttribute('data-expert'));
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
    fetchRankings(requestFor(page, position, scoring), function (d) {
      data = d;
      paintBody();
    });
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

    document.getElementById('rbCsv').addEventListener('click', downloadCsv);

    document.getElementById('rbPills').addEventListener('click', function (e) {
      var btn = e.target.closest('.rb-pill');
      if (!btn) return;
      position = btn.getAttribute('data-pos');
      sortCol = -1;
      paintAll();
      load();
    });

    document.getElementById('rbOv').addEventListener('click', function (e) {
      if (e.target.id === 'rbOv') closeOverlay();
    });

    paintBody();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ovOpen) closeOverlay();
  });

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