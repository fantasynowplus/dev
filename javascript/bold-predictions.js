(function () {
  'use strict';

  var POLL_MS = 15000;
  var POSITIONS = ['QB','RB','WR','TE'];
  var SB_URL = '', SB_KEY = '';
  var STATE = { season:null, rows:[], sig:'' };
  var REVEALED = {};

  function el(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function initials(n){
    if(!n) return '?';
    return n.trim().split(/\s+/).slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase();
  }
  function sbCfg(){
    return {
      url:(typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : '',
      key:(typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : ''
    };
  }
  function rpc(name, body){
    return fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method:'POST',
      headers:{ apikey:SB_KEY, 'Content-Type':'application/json' },
      body:JSON.stringify(body || {})
    }).then(function(r){ return r.ok ? r.json() : []; })
      .catch(function(){ return []; });
  }
  function staffShot(v){
    if(!v) return '';
    if(/^https?:\/\//i.test(v)) return v;
    return v.indexOf('/') >= 0 ? v.replace(/^\/+/,'') : 'assets/staff/' + v;
  }
  function playerShot(r){
    if(r.espn_id) return 'https://a.espncdn.com/i/headshots/nfl/players/full/' + r.espn_id + '.png';
    if(r.player_id) return 'https://sleepercdn.com/content/nfl/players/thumb/' + r.player_id + '.jpg';
    return '';
  }

  function loadState(){
    return fetch('https://api.sleeper.app/v1/state/nfl')
      .then(function(r){ return r.json(); }).catch(function(){ return {}; })
      .then(function(s){
        STATE.season = Number(s.season) || new Date().getFullYear();
      });
  }

  function loadRows(){
    return rpc('bp_public', { p_season: STATE.season })
      .then(function(rows){
        rows = rows || [];
        var sig = JSON.stringify(rows);
        if (sig === STATE.sig) return;
        STATE.sig = sig; STATE.rows = rows;
        render();
      });
  }

  function shards(){
    var out = '';
    for (var i = 0; i < 6; i++) out += '<i class="bp-shard s' + i + '"></i>';
    return '<span class="bp-burst"></span>' + out;
  }

  function byline(r){
    var src = staffShot(r.headshot);
    var av = src
      ? '<img class="bp-av" src="' + esc(src) + '" alt="" onerror="this.remove()">'
      : '<span class="bp-av ini">' + esc(initials(r.author_name)) + '</span>';
    return '<div class="bp-by">' + av + '<span>' + esc(r.author_name) + '</span>' +
           (r.guest_id ? '<span class="bp-guest">Discord</span>' : '') + '</div>';
  }

  function cardHtml(r, big){
    var shown = !!REVEALED[r.id];
    var psrc = playerShot(r);
    return '<div class="bp-card' + (big ? ' big' : '') + (shown ? ' revealed instant' : '') +
             '" data-id="' + r.id + '" data-pos="' + r.position +
             '" style="--pos:var(--pos-' + r.position + ')">' +
             '<div class="bp-body">' +
               '<div class="bp-head">' +
                 (psrc ? '<img class="bp-shot" src="' + esc(psrc) + '" alt="" onerror="this.remove()">' : '') +
                 '<div class="bp-titles">' +
                   '<div class="bp-title"><span class="bp-pill">' + r.position + '</span>' +
                     '<span class="bp-player">' + esc(r.player_name || '') + '</span>' +
                     (r.result ? '<span class="bp-result ' + r.result + '">' +
                        (r.result === 'hit' ? 'HIT' : 'MISS') + '</span>' : '') + '</div>' +
                   (big ? '' : byline(r)) +
                 '</div>' +
               '</div>' +
               '<div class="bp-text">' + esc(r.prediction) + '</div>' +
             '</div>' +
             '<div class="bp-veil">' +
               '<span class="bp-vpos">' + r.position + '</span>' +
               (big ? '' : '<span class="bp-vwho">' + esc(r.author_name) + '</span>') +
               '<span class="bp-vhint">Tap to reveal</span>' + shards() +
             '</div>' +
           '</div>';
  }

  function featuredHtml(){
    var cols = [1,2].map(function(slot){
      var mine = STATE.rows.filter(function(r){ return r.featured_slot === slot; });
      if (!mine.length) return '';
      var first = mine[0];
      var src = staffShot(first.headshot);
      var head = '<div class="bp-colhead">' +
        (src ? '<img class="bp-colshot" src="' + esc(src) + '" alt="" onerror="this.remove()">'
             : '<span class="bp-colshot ini">' + esc(initials(first.author_name)) + '</span>') +
        '<h3>' + esc(first.author_name) + '</h3></div>';
      var cards = POSITIONS.map(function(p){
        var r = mine.filter(function(x){ return x.position === p; })[0];
        return r ? cardHtml(r, true) : '';
      }).join('');
      return '<div class="bp-col">' + head + cards + '</div>';
    }).join('');
    return cols || '<div class="state">No featured predictions for this season yet.</div>';
  }

  function listHtml(){
    var rows = STATE.rows.filter(function(r){ return !r.featured_slot; });
    rows.sort(function(a,b){
      var ga = a.guest_id ? 1 : 0, gb = b.guest_id ? 1 : 0;
      return ga - gb ||
             POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
             String(a.author_name).localeCompare(String(b.author_name));
    });
    if (!rows.length) return '<div class="state">Nothing here yet.</div>';
    return rows.map(function(r){ return cardHtml(r, false); }).join('');
  }

  function render(){
    el('scope').textContent = STATE.season + ' Season';
    el('featured').innerHTML = featuredHtml();
    el('list').innerHTML = listHtml();
    applyFilter();
    syncRevealBtn();
  }

  function applyFilter(){
    var on = document.querySelector('#posTabs button.on');
    var pos = on ? on.dataset.pos : 'ALL';
    [].forEach.call(el('list').querySelectorAll('.bp-card'), function(c){
      c.classList.toggle('off', pos !== 'ALL' && c.dataset.pos !== pos);
    });
  }

  function syncRevealBtn(){
    var all = STATE.rows.length && STATE.rows.every(function(r){ return REVEALED[r.id]; });
    el('revealAll').textContent = all ? 'Hide all' : 'Reveal all';
  }

  function bind(){
    document.addEventListener('click', function(e){
      var view = e.target.closest('#viewTabs button');
      if (view){
        [].forEach.call(document.querySelectorAll('#viewTabs button'), function(b){
          b.classList.toggle('on', b === view);
        });
        var showDiscord = view.dataset.view === 'discord';
        el('showWrap').classList.toggle('hide', showDiscord);
        el('discordWrap').classList.toggle('hide', !showDiscord);
        return;
      }
      var tab = e.target.closest('#posTabs button');
      if (tab){
        [].forEach.call(document.querySelectorAll('#posTabs button'), function(b){
          b.classList.toggle('on', b === tab);
        });
        applyFilter();
        return;
      }
      if (e.target.closest('#revealAll')){
        var all = STATE.rows.length && STATE.rows.every(function(r){ return REVEALED[r.id]; });
        STATE.rows.forEach(function(r){ if (all) delete REVEALED[r.id]; else REVEALED[r.id] = true; });
        [].forEach.call(document.querySelectorAll('.bp-card'), function(c){
          c.classList.remove('instant');
          c.classList.toggle('revealed', !!REVEALED[c.dataset.id]);
        });
        syncRevealBtn();
        return;
      }
      var card = e.target.closest('.bp-card');
      if (card){
        var id = card.dataset.id;
        card.classList.remove('instant');
        if (REVEALED[id]) { delete REVEALED[id]; card.classList.remove('revealed'); }
        else { REVEALED[id] = true; card.classList.add('revealed'); }
        syncRevealBtn();
      }
    });
  }

  function start(){
    var cfg = sbCfg();
    SB_URL = cfg.url; SB_KEY = cfg.key;
    if (!SB_URL || !SB_KEY){
      el('featured').innerHTML = '<div class="state">Supabase config didn\u2019t load. ' +
        'Check that <b>javascript/auth.js</b> is present on this page.</div>';
      return;
    }
    bind();
    loadState().then(loadRows).then(function(){
      setInterval(function(){ if (!document.hidden) loadRows(); }, POLL_MS);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();