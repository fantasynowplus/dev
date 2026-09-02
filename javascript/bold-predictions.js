(function () {
  'use strict';

  var POLL_MS = 15000;
  var POSITIONS = ['QB','RB','WR','TE'];
  var SB_URL = '', SB_KEY = '';
  var STATE = { season:null, week:null, rows:[] };
  var REVEALED = {};
  var filter = 'ALL';

  function el(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function sbCfg(){
    return {
      url: (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : '',
      key: (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : ''
    };
  }
  function api(path){
    return fetch(SB_URL + '/rest/v1/' + path, { headers:{ apikey:SB_KEY } })
      .then(function(r){ return r.ok ? r.json() : []; })
      .catch(function(){ return []; });
  }

  function loadState(){
    return fetch('https://api.sleeper.app/v1/state/nfl')
      .then(function(r){ return r.json(); })
      .catch(function(){ return {}; })
      .then(function(s){
        STATE.season = Number(s.season) || new Date().getFullYear();
        STATE.week = Number(s.display_week || s.week) || 1;
      });
  }

  function loadRows(){
    return api('bp_predictions?select=*&season=eq.' + STATE.season +
               '&week=eq.' + STATE.week + '&order=sort_order.asc,created_at.asc')
      .then(function(rows){ STATE.rows = rows || []; render(); });
  }

  function shards(){
    var out = '';
    for (var i = 0; i < 6; i++) out += '<i class="bp-shard s' + i + '"></i>';
    return '<span class="bp-burst"></span>' + out;
  }

  function cardHtml(r, big){
    var shown = !!REVEALED[r.id];
    return '<div class="bp-card' + (big ? ' big' : '') + (shown ? ' revealed instant' : '') +
             '" data-id="' + r.id + '" style="--pos:var(--pos-' + r.position + ')">' +
             '<div class="bp-body">' +
               '<div class="bp-head">' +
                 '<span class="bp-pill">' + r.position + '</span>' +
                 (big ? '' : '<span class="bp-who">' + esc(r.author_name) + '</span>') +
               '</div>' +
               '<div class="bp-text">' + esc(r.prediction) + '</div>' +
             '</div>' +
             '<div class="bp-veil">' +
               '<span class="bp-vpos">' + r.position + '</span>' +
               (big ? '' : '<span class="bp-vwho">' + esc(r.author_name) + '</span>') +
               '<span class="bp-vhint">Tap to reveal</span>' +
               shards() +
             '</div>' +
           '</div>';
  }

  function featuredHtml(){
    var cols = [1,2].map(function(slot){
      var mine = STATE.rows.filter(function(r){ return r.featured_slot === slot; });
      if (!mine.length) return '';
      var name = mine[0].author_name;
      var cards = POSITIONS.map(function(p){
        var r = mine.filter(function(x){ return x.position === p; })[0];
        return r ? cardHtml(r, true) : '';
      }).join('');
      return '<div class="bp-col"><h3>' + esc(name) + '</h3>' + cards + '</div>';
    }).join('');
    return cols || '<div class="state">No featured predictions for this week yet.</div>';
  }

  function listHtml(){
    var rows = STATE.rows.filter(function(r){ return !r.featured_slot; });
    if (filter !== 'ALL') rows = rows.filter(function(r){ return r.position === filter; });
    rows.sort(function(a,b){
      return POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
             String(a.author_name).localeCompare(String(b.author_name));
    });
    if (!rows.length) return '<div class="state">Nothing here yet.</div>';
    return rows.map(function(r){ return cardHtml(r, false); }).join('');
  }

  function render(){
    el('scope').textContent = STATE.season + ' \u00b7 Week ' + STATE.week;
    el('featured').innerHTML = featuredHtml();
    el('list').innerHTML = listHtml();
    var all = STATE.rows.length && STATE.rows.every(function(r){ return REVEALED[r.id]; });
    el('revealAll').textContent = all ? 'Hide all' : 'Reveal all';
  }

  function reveal(card){
    var id = card.dataset.id;
    card.classList.remove('instant');
    if (REVEALED[id]) { delete REVEALED[id]; card.classList.remove('revealed'); }
    else { REVEALED[id] = true; card.classList.add('revealed'); }
    var all = STATE.rows.length && STATE.rows.every(function(r){ return REVEALED[r.id]; });
    el('revealAll').textContent = all ? 'Hide all' : 'Reveal all';
  }

  function bind(){
    document.addEventListener('click', function(e){
      var tab = e.target.closest('#posTabs button');
      if (tab){
        filter = tab.dataset.pos;
        [].forEach.call(document.querySelectorAll('#posTabs button'), function(b){
          b.classList.toggle('on', b === tab);
        });
        el('list').innerHTML = listHtml();
        return;
      }
      if (e.target.closest('#revealAll')){
        var all = STATE.rows.length && STATE.rows.every(function(r){ return REVEALED[r.id]; });
        STATE.rows.forEach(function(r){ if (all) delete REVEALED[r.id]; else REVEALED[r.id] = true; });
        [].forEach.call(document.querySelectorAll('.bp-card'), function(c){
          c.classList.remove('instant');
          c.classList.toggle('revealed', !!REVEALED[c.dataset.id]);
        });
        el('revealAll').textContent = all ? 'Reveal all' : 'Hide all';
        return;
      }
      var card = e.target.closest('.bp-card');
      if (card) reveal(card);
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
