(function () {
  var DATA_URL = "https://fckobcxprmudfpxdmswi.supabase.co/rest/v1/nfl_sim?id=eq.1&select=data";
  var ANON_KEY = "sb_publishable_lUJ8FDkLUorRO5PQwvMHTA_5_W_mbh2";
  var board = document.getElementById("nm-board");
  var statusEl = document.getElementById("nm-status");
  var updatedEl = document.getElementById("nm-updated");

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function pct(n) { return (Math.round(n * 10) / 10) + "%"; }

  function fmtKick(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit" });
  }

  function fmtUpdated(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "just now";
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function edgeClass(e) { return e >= 5 ? "hot" : e >= 2.5 ? "warm" : "cool"; }
  function edgeColor(e) { return e >= 5 ? "var(--aqua)" : e >= 2.5 ? "var(--bright-orange)" : "#38445f"; }

  function bar(cls, value) {
    return '<div class="nm-bar ' + cls + '"><span style="width:' + Math.max(0, Math.min(100, value)) + '%"></span></div>';
  }

  function card(g) {
    var primeTags = { TNF: 1, SNF: 1, MNF: 1 };
    var tagCls = primeTags[g.slate] ? "nm-tag prime" : "nm-tag";
    var kick = fmtKick(g.kickoff);

    var mlDelta = g.sim_home_win_pct - g.market_home_win_pct;
    var mlDir = mlDelta > 0.5 ? "up" : mlDelta < -0.5 ? "down" : "flat";
    var mlArrow = mlDelta > 0.5 ? "▲" : mlDelta < -0.5 ? "▼" : "▬";
    var deltaTxt = (Math.abs(mlDelta) < 0.05 ? "0" : Math.abs(mlDelta).toFixed(1));

    var spreadHome = g.sim_home_cover_pct >= 50;
    var spreadPct = spreadHome ? g.sim_home_cover_pct : g.sim_away_cover_pct;
    var spreadPick = spreadHome
      ? esc(g.home_abbr) + " " + (g.home_spread > 0 ? "+" : "") + g.home_spread
      : esc(g.away_abbr) + " " + (-g.home_spread > 0 ? "+" : "") + (-g.home_spread);

    var overPick = g.sim_over_pct >= 50;
    var totalPct = overPick ? g.sim_over_pct : g.sim_under_pct;
    var totalTxt = (overPick ? "Over " : "Under ") + g.total_line;

    var e = g.best_bet_edge;

    return '' +
      '<div class="nm-card">' +
        '<div class="nm-rail" style="background:' + edgeColor(e) + '"></div>' +
        '<div>' +
          '<div class="nm-top">' +
            '<span class="' + tagCls + '">' + esc(g.slate || "NFL") + '</span>' +
            '<span class="nm-match">' + esc(g.away_abbr) + '<span class="at">@</span>' + esc(g.home_abbr) + '</span>' +
            (kick ? '<span class="nm-kick">' + esc(kick) + '</span>' : '') +
          '</div>' +

          '<div class="nm-proj"><span class="lbl">Proj</span>' +
            esc(g.home_abbr) + ' <b>' + g.proj_home_score + '</b> &nbsp;–&nbsp; <b>' + g.proj_away_score + '</b> ' + esc(g.away_abbr) +
          '</div>' +

          '<div class="nm-row">' +
            '<div class="nm-rowlbl">Moneyline<small>' + esc(g.home_abbr) + ' win</small></div>' +
            '<div class="nm-tracks">' +
              '<div class="nm-track"><span class="who">Market</span>' + bar("market", g.market_home_win_pct) + '<span class="nm-pct">' + pct(g.market_home_win_pct) + '</span></div>' +
              '<div class="nm-track"><span class="who">Model</span>' + bar("model", g.sim_home_win_pct) +
                '<span class="nm-delta ' + mlDir + '">' + mlArrow + ' ' + deltaTxt + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="nm-row">' +
            '<div class="nm-rowlbl">Spread<small>' + (g.home_spread > 0 ? "+" : "") + g.home_spread + '</small></div>' +
            '<div class="nm-tracks"><div class="nm-track"><span class="who">Model</span>' + bar("model", spreadPct) + '<span class="nm-pct">' + pct(spreadPct) + '</span></div>' +
              '<div class="nm-lean"><b>' + spreadPick + '</b> covers</div></div>' +
          '</div>' +

          '<div class="nm-row">' +
            '<div class="nm-rowlbl">Total<small>' + g.total_line + '</small></div>' +
            '<div class="nm-tracks"><div class="nm-track"><span class="who">Model</span>' + bar("model", totalPct) + '<span class="nm-pct">' + pct(totalPct) + '</span></div>' +
              '<div class="nm-lean"><b>' + esc(totalTxt) + '</b></div></div>' +
          '</div>' +
        '</div>' +

        '<div class="nm-edge">' +
          '<div class="cap">Top Edge</div>' +
          '<div class="play">' + esc(g.best_bet_pick) + '</div>' +
          '<div class="mkt">' + esc(g.best_bet_market) + '</div>' +
          '<div class="num ' + edgeClass(e) + '">+' + e.toFixed(1) + ' <small>pts</small></div>' +
        '</div>' +
      '</div>';
  }

  var ALL_GAMES = [];
  var filters = { sort: "kickoff", team: "", minEdge: 0 };

  function populateFilters(games) {
    var teamMap = {};
    games.forEach(function (g) {
      teamMap[g.home] = 1; teamMap[g.away] = 1;
    });

    var teamSel = document.getElementById("f-team");
    var names = Object.keys(teamMap).sort();
    teamSel.innerHTML = '<option value="">All teams</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join("");
  }

  function applyFilters() {
    var list = ALL_GAMES.slice();
    if (filters.team) list = list.filter(function (g) { return g.home === filters.team || g.away === filters.team; });
    if (filters.minEdge) list = list.filter(function (g) { return g.best_bet_edge >= filters.minEdge; });

    list.sort(function (a, b) {
      switch (filters.sort) {
        case "edge": return b.best_bet_edge - a.best_bet_edge;
        case "total": return b.total_line - a.total_line;
        case "spread": return Math.abs(a.home_spread) - Math.abs(b.home_spread);
        default: return new Date(a.kickoff || 0) - new Date(b.kickoff || 0);
      }
    });

    var countEl = document.getElementById("f-count");
    if (countEl) countEl.textContent = "Showing " + list.length + " of " + ALL_GAMES.length;

    if (!list.length) {
      board.innerHTML = "";
      statusEl.style.display = "block";
      statusEl.textContent = "No games match these filters.";
      return;
    }
    statusEl.style.display = "none";
    board.innerHTML = list.map(card).join("");
  }

  function wireFilters() {
    document.getElementById("f-sort").addEventListener("change", function (e) { filters.sort = e.target.value; applyFilters(); });
    document.getElementById("f-team").addEventListener("change", function (e) { filters.team = e.target.value; applyFilters(); });
    document.getElementById("f-edge").addEventListener("change", function (e) { filters.minEdge = parseFloat(e.target.value) || 0; applyFilters(); });
    document.getElementById("f-reset").addEventListener("click", function () {
      filters = { sort: "kickoff", team: "", minEdge: 0 };
      document.getElementById("f-sort").value = "kickoff";
      document.getElementById("f-team").value = "";
      document.getElementById("f-edge").value = "0";
      applyFilters();
    });
  }

  function loadBoard() {
    var token = localStorage.getItem("sb-auth-token");
    fetch(DATA_URL, { headers: { apikey: ANON_KEY, Authorization: "Bearer " + token } })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (rows) {
        var data = rows && rows[0] && rows[0].data;
        if (!data) throw new Error("no data");
        updatedEl.textContent = "Updated " + fmtUpdated(data.generated_at) +
          "  ·  " + data.count + " game" + (data.count === 1 ? "" : "s");

        if (!data.games || !data.games.length) {
          statusEl.innerHTML = "No games on the board right now. The model runs every morning and posts the day's slate here once lines are up.";
          return;
        }
        ALL_GAMES = data.games;
        populateFilters(ALL_GAMES);
        wireFilters();
        document.getElementById("nm-filters").style.display = "flex";
        applyFilters();
      })
      .catch(function () {
        updatedEl.textContent = "";
        statusEl.innerHTML = "Couldn't load the model right now. It refreshes every morning — check back shortly.";
      });
  }

  function isLoggedIn() {
    return typeof auth !== "undefined" && auth.isAuthenticated && auth.isAuthenticated();
  }

  function openLogin() {
    var m = document.getElementById("loginBackdrop");
    if (m) { m.classList.add("open"); document.body.style.overflow = "hidden"; }
    else { window.location.href = "login"; }
  }

  function start() {
    var gate = document.getElementById("nm-gate");
    var authed = document.getElementById("nm-authed");
    if (isLoggedIn()) {
      gate.style.display = "none";
      authed.style.display = "block";
      loadBoard();
    } else {
      authed.style.display = "none";
      gate.style.display = "block";
      var btn = document.getElementById("nm-login-btn");
      if (btn) btn.addEventListener("click", openLogin);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
