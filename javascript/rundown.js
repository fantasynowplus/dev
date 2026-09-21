/* rundown.js — FantasyNow+ PTI-style rundown, stream display
   Reads rundown_board() (anon-granted). Self-contained: own sbCfg()/rpc() copies,
   same pattern as bets-board.js. Clock is computed client-side from activated_at
   + server_now so both displays stay in sync without a websocket. */
(function () {
  'use strict';

  var CFG = null;
  var STATE = { topics: [], clockAnchor: 0, elapsedAtAnchor: 0 };
  var POLL_MS = 5000;
  var pollTimer = null, tickTimer = null;

  function sbCfg() {
    var url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : window.SUPABASE_URL;
    var key = (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : window.SUPABASE_ANON_KEY;
    return (url && key) ? { url: url, key: key } : null;
  }
  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms || 12000); })
    ]);
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
  function fmtClock(secs) {
    var s = Math.max(0, Math.ceil(secs));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function activeTopic() {
    return STATE.topics.filter(function (t) { return t.status === 'active'; })[0] || null;
  }

  function render() {
    var active = activeTopic();

    var bar = document.getElementById('rdUnderbar');
    var barText = document.getElementById('rdUnderbarText');
    if (active) {
      barText.textContent = active.title;
      bar.style.display = '';
    } else {
      bar.style.display = 'none';
    }

    var list = document.getElementById('rdList');
    list.innerHTML = STATE.topics.length
      ? STATE.topics.map(function (t, i) {
          return '<div class="rd-item rd-' + t.status + '">' +
            '<div class="rd-item-n">' + (i + 1) + '</div>' +
            '<div class="rd-item-body">' +
              '<div class="rd-item-t">' + esc(t.title) + '</div>' +
              (t.description ? '<div class="rd-item-d">' + esc(t.description) + '</div>' : '') +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="rd-item-empty">No topics yet</div>';
  }

  function tick() {
    var active = activeTopic();
    var clockEl = document.getElementById('rdClock');
    if (!active || !active.activated_at) {
      clockEl.textContent = fmtClock(active ? (active.duration_seconds || 60) : 60);
      clockEl.classList.remove('rd-clock-out');
      return;
    }
    var elapsed = (Date.now() - STATE.clockAnchor) / 1000 + STATE.elapsedAtAnchor;
    var remaining = (active.duration_seconds || 60) - elapsed;
    clockEl.textContent = fmtClock(remaining);
    clockEl.classList.toggle('rd-clock-out', remaining <= 0);
  }

  async function load() {
    try {
      var rows = await rpc('rundown_board', {});
      STATE.topics = rows || [];
      var active = activeTopic();
      var serverNow = STATE.topics.length ? new Date(STATE.topics[0].server_now).getTime() : Date.now();
      STATE.clockAnchor = Date.now();
      STATE.elapsedAtAnchor = (active && active.activated_at)
        ? (serverNow - new Date(active.activated_at).getTime()) / 1000
        : 0;
      render();
      tick();
    } catch (e) {
      var list = document.getElementById('rdList');
      list.innerHTML = '<div class="rd-item-empty">Couldn\'t load the rundown.</div>';
    }
  }

  function poll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (!document.hidden) load(); }, POLL_MS);
  }

  function start() {
    CFG = sbCfg();
    if (!CFG) {
      document.getElementById('rdList').innerHTML =
        '<div class="rd-item-empty">Supabase config not loaded.</div>';
      return;
    }
    load();
    poll();
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();