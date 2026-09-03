(function () {
  'use strict';

  var BP_POS = ['QB', 'RB', 'WR', 'TE'];

  var CFG = null;
  var S = { season: null, rows: [], people: [], sel: 'all', pos: 'ALL' };

  function sbCfg() {
    var url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : window.SUPABASE_URL;
    var key = (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : window.SUPABASE_ANON_KEY;
    return (url && key) ? { url: url, key: key } : null;
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('timeout')); }, ms || 12000);
    })]);
  }
  function rpc(fn, body) {
    return withTimeout(fetch(CFG.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.key, Authorization: 'Bearer ' + CFG.key },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      if (!r.ok) throw new Error(fn + ' ' + r.status);
      return r.json();
    }));
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function initials(n) {
    return String(n || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function headshot(v) {
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return v.indexOf('/') >= 0 ? v.replace(/^\/+/, '') : 'assets/staff/' + v;
  }
  function personKey(r) {
    return r.staff_id ? 'staff:' + r.staff_id : (r.guest_id ? 'guest:' + r.guest_id : 'name:' + r.author_name);
  }

  function buildPeople() {
    var map = {};
    S.rows.forEach(function (r) {
      var k = personKey(r);
      var p = map[k] || (map[k] = { id: k, name: r.author_name, headshot: r.headshot, slot: null, count: 0 });
      if (r.featured_slot != null) p.slot = r.featured_slot;
      p.count++;
    });
    S.people = Object.keys(map).map(function (k) { return map[k]; });
  }

  function rowsForSel() {
    if (S.sel === 'all') return S.rows;
    return S.rows.filter(function (r) { return personKey(r) === S.sel; });
  }
  function rowsForPos(rows) {
    if (S.pos === 'ALL') return rows;
    return rows.filter(function (r) { return r.position === S.pos; });
  }

  function isOn(o) {
    if (S.sel === o.id) return true;
    if (o.group) return false;
    return S.sel === 'all';
  }

  function avatarHtml(o) {
    var src = o.group ? o.logo : headshot(o.headshot);
    var fallback = o.group ? o.abbr : initials(o.name);
    if (!src) return '<div class="bpp-anav">' + esc(fallback) + '</div>';
    return '<img class="bpp-anav" src="' + esc(src) + '" alt="" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),' +
      '{className:\'bpp-anav\',textContent:\'' + esc(fallback) + '\'}))">';
  }

  function analystHtml(o) {
    var on = isOn(o);
    return '<button class="bpp-an' + (o.group ? ' grp' : '') + (on ? ' on' : ' dim') +
             '" data-sel="' + esc(o.id) + '">' +
      avatarHtml(o) +
      '<span class="bpp-anb">' +
        '<span class="bpp-ann">' + esc(o.name) + '</span>' +
        '<span class="bpp-ans">' + o.count + ' pick' + (o.count === 1 ? '' : 's') + '</span>' +
      '</span>' +
    '</button>';
  }

  function renderRail() {
    var all = { id: 'all', name: 'All Predictors', abbr: 'ALL', group: true,
      logo: 'assets/images/social-logo.png', count: S.rows.length };
    document.getElementById('bppGroups').innerHTML = analystHtml(all);

    var featured = S.people.filter(function (p) { return p.slot != null; })
      .sort(function (a, b) { return a.slot - b.slot; });
    var others = S.people.filter(function (p) { return p.slot == null; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    document.getElementById('bppFeaturedPeople').innerHTML =
      featured.map(analystHtml).join('') ||
      '<p class="bpp-state" style="padding:14px 0">No featured analysts yet.</p>';

    document.getElementById('bppOtherLabel').hidden = !others.length;
    document.getElementById('bppOtherPeople').innerHTML = others.map(analystHtml).join('');
  }

  function cardHtml(r) {
    return '<div class="bpp-card">' +
      '<div class="bpp-cardbody">' +
        '<div class="bpp-cardtop">' +
          '<span class="bpp-pos bpp-pos-' + r.position + '">' + r.position + '</span>' +
          '<span class="bpp-cardname">' + esc(r.author_name) + '</span>' +
        '</div>' +
        '<div class="bpp-cardtxt">' +
          (r.player_name ? '<b>' + esc(r.player_name) + '</b> — ' : '') + esc(r.prediction) +
          (r.result ? '<span class="bpp-result bpp-result-' + r.result + '">' + (r.result === 'hit' ? 'HIT' : 'MISS') + '</span>' : '') +
        '</div>' +
      '</div></div>';
  }

  function renderList() {
    var rows = rowsForPos(rowsForSel())
      .slice()
      .sort(function (a, b) {
        return BP_POS.indexOf(a.position) - BP_POS.indexOf(b.position) ||
               (a.sort_order || 0) - (b.sort_order || 0);
      });

    document.getElementById('bppList').innerHTML = rows.length
      ? rows.map(cardHtml).join('')
      : '<p class="bpp-state">No predictions here yet.</p>';
  }

  function render() {
    renderList();
    renderRail();
  }

  async function start() {
    CFG = sbCfg();
    if (!CFG) {
      document.getElementById('bppList').innerHTML = '<p class="bpp-state">Config not loaded.</p>';
      return;
    }

    S.season = Number(new URLSearchParams(location.search).get('season'));
    if (!S.season) {
      try {
        var st = await fetch('https://api.sleeper.app/v1/state/nfl').then(function (r) { return r.json(); });
        S.season = Number(st.season) || new Date().getFullYear();
      } catch (e) {
        S.season = new Date().getFullYear();
      }
    }

    try {
      S.rows = await rpc('bp_public', { p_season: S.season });
    } catch (e) {
      document.getElementById('bppList').innerHTML =
        '<p class="bpp-state">Couldn\'t load predictions. ' + esc(e.message || e) + '</p>';
      return;
    }

    buildPeople();
    render();

    document.getElementById('bppPosTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pos]');
      if (!b) return;
      S.pos = b.dataset.pos;
      document.querySelectorAll('#bppPosTabs button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      renderList();
    });

    document.querySelector('.bpp-rail').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sel]');
      if (!b) return;
      S.sel = b.dataset.sel;
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();