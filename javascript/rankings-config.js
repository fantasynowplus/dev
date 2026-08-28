(function () {
  var thisScript = document.currentScript;
  var SLUG = thisScript ? thisScript.getAttribute('data-slug') : null;

  var FP_SRC = 'https://cdn.fantasypros.com/js/fp-widget-2.0.js';
  var CACHE_KEY = 'fnp_rankings_cfg';
  var CACHE_MS = 15 * 60 * 1000;
  var GIVE_UP_MS = 3000;

  var ATTRS = {
    height: 'data-height',
    wtype: 'data-wtype',
    scoring: 'data-scoring',
    filters: 'data-filters',
    expert: 'data-expert',
    positions: 'data-positions',
    ppr_positions: 'data-ppr_positions',
    half_positions: 'data-half_positions',
    year: 'data-year',
    week: 'data-week'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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

  function readCache() {
    try {
      var raw = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      return raw && (Date.now() - raw.t) < CACHE_MS ? raw.d : null;
    } catch (e) { return null; }
  }

  function writeCache(d) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
  }

  function fetchConfig(cb) {
    var cached = readCache();
    if (cached) return cb(cached);

    waitForSupabase(function (url, key) {
      if (!url || !key) return cb(null);
      fetch(url + '/rest/v1/rpc/rankings_public_config', {
        method: 'POST',
        headers: { 'apikey': key, 'Content-Type': 'application/json' },
        body: '{}'
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.length) writeCache(d);
          cb(d);
        })
        .catch(function () { cb(null); });
    });
  }

  function applyPage(p) {
    var el = document.getElementById('fp-widget');
    if (!el || !p) return;

    Object.keys(ATTRS).forEach(function (k) {
      var v = p[k];
      if (v === null || v === undefined) return;
      el.setAttribute(ATTRS[k], String(v));
    });

    var h = document.querySelector('[data-rankings-heading]');
    if (h && p.heading) h.textContent = p.heading;
    if (p.heading) document.title = p.heading + ' | FantasyNow+';
  }

  function applyNav(pages) {
    var nav = document.querySelector('[data-rankings-nav]');
    if (!nav || !pages || !pages.length) return;

    var here = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    nav.innerHTML = pages.map(function (p) {
      var on = p.url === here ? ' class="active"' : '';
      return '<a href="' + esc(p.url) + '"' + on + '>' + esc(p.name) + '</a>';
    }).join('');
  }

  var widgetLoaded = false;
  function loadWidget() {
    if (widgetLoaded) return;
    widgetLoaded = true;

    var target = document.getElementById('fp-widget');
    var s = document.createElement('script');
    s.src = FP_SRC;
    s.setAttribute('data-fp-widget', '1');

    s.onload = function () {
      setTimeout(function () {
        if (target && !target.innerHTML.trim()) {
          try { document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true })); } catch (e) {}
        }
      }, 1500);
    };

    document.body.appendChild(s);
  }

  function start() {
    setTimeout(loadWidget, GIVE_UP_MS);

    fetchConfig(function (pages) {
      if (pages && pages.length) {
        applyNav(pages);
        if (SLUG) {
          for (var i = 0; i < pages.length; i++) {
            if (pages[i].slug === SLUG) { applyPage(pages[i]); break; }
          }
        }
      }
      loadWidget();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
