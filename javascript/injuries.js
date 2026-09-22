const INJURIES_SUPABASE_URL = "https://fckobcxprmudfpxdmswi.supabase.co";
const INJURIES_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja29iY3hwcm11ZGZweGRtc3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTI5MzcsImV4cCI6MjA5OTE4ODkzN30.9wMb0SXAZs-jo1G9xRxk5M47fJIIU7-DTJTl1yFRwFk";

const sb = window.supabase.createClient(INJURIES_SUPABASE_URL, INJURIES_SUPABASE_ANON_KEY);

const POSITIONS = ["QB", "RB", "WR", "TE"];
const POSITION_COLORS = {
  QB: "#e5578a",
  RB: "#3fb98a",
  WR: "#4b8fe0",
  TE: "#e08a4b",
};

// Roster % and PPG come from the same published waiver-wire CSV, matched by
// normalized player name -- same source and matching approach as waiver-wire.js.
const MIN_ROSTER_PCT = 0.25;
const WAIVER_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPaCNSMYNkNavyamJOZh6RZb4G7UFMRp6h-BO2KJKj3t821H0-dTWzxo6qLhr6Nrh2U9BN2OQLfwOl/pub?gid=1131935259&single=true&output=csv";
const WAIVER_COL = { pos: 0, player: 1, team: 2, bye: 3, rost: 4, lwPts: 5, lwRank: 6, l3Ppg: 7, l3Rank: 8, l3Gp: 9, season: 10, week: 11, sleeperId: 12 };

function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const NAME_SUFFIXES = ["jr", "sr", "ii", "iii", "iv", "v"];
function normName(s) {
  const t = (s || "").toLowerCase()
    .replace(/[\u2019'`.]/g, "")
    .replace(/[^a-z\s-]/g, "");
  return t.split(/\s+/).filter((x) => x && NAME_SUFFIXES.indexOf(x) === -1).join(" ").trim();
}

function num(v) {
  const s = String(v == null ? "" : v).replace(/,/g, "").trim();
  if (s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function pct(v) {
  const s = String(v == null ? "" : v).replace(/,/g, "").trim();
  if (s === "") return null;
  const hasSign = s.indexOf("%") > -1;
  const n = parseFloat(s.replace("%", ""));
  if (isNaN(n)) return null;
  if (hasSign) return n / 100;
  return n > 1 ? n / 100 : n;
}

const ROSTER_DATA = new Map(); // normName(player)+"|"+pos -> { rost, ppg }

async function loadRosterData() {
  try {
    const res = await fetch(WAIVER_CSV_URL + (WAIVER_CSV_URL.includes("?") ? "&" : "?") + "_=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const grid = parseCSV(await res.text());
    grid.forEach((r, i) => {
      if (i === 0) return;
      const player = (r[WAIVER_COL.player] || "").trim();
      const posn = (r[WAIVER_COL.pos] || "").trim().toUpperCase();
      if (!player || !POSITIONS.includes(posn)) return;
      ROSTER_DATA.set(normName(player) + "|" + posn, {
        rost: pct(r[WAIVER_COL.rost]),
        ppg: num(r[WAIVER_COL.l3Ppg]),
      });
    });
  } catch (e) {
    console.warn("Roster/PPG CSV unavailable:", e);
  }
}

function attachRosterData(row) {
  const match = ROSTER_DATA.get(normName(row.name) + "|" + row.position);
  row.rost = match ? match.rost : null;
  row.ppg = match ? match.ppg : null;
}

let allRows = [];
let seasonRows = [];       // one row per player: their most recent status
let weeklyRows = new Map(); // week -> [one row per player: latest within that week]
let weeks = [];
let currentView = "season";
let currentWeek = null;
let sortKey = "name";
let sortDir = 1;
let chart = null;

async function loadData() {
  const [{ data, error }] = await Promise.all([
    sb.from("injury_reports").select("*").order("fetched_at", { ascending: true }),
    loadRosterData(),
  ]);

  if (error) {
    console.error(error);
    document.getElementById("injury-tbody").innerHTML =
      `<tr><td colspan="7" class="loading-row">Couldn't load injury data.</td></tr>`;
    return;
  }

  allRows = (data ?? [])
    .map((row) => {
      attachRosterData(row);
      return row;
    })
    .filter((row) => row.rost != null && row.rost >= MIN_ROSTER_PCT);

  updateLastUpdated();
  processData();
  populateFilterOptions();
  populateWeekSelect();
  renderChart();
  render();
}

function updateLastUpdated() {
  if (allRows.length === 0) return;
  const latest = allRows.reduce((max, r) => (r.fetched_at > max ? r.fetched_at : max), allRows[0].fetched_at);
  const d = new Date(latest);
  document.getElementById("last-updated").textContent =
    `Last updated: ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

// Reduces raw rows (which may have several snapshots per player per day)
// down to "latest row per player" (season view) and "latest row per player,
// per week" (by-week view).
function processData() {
  const latestByPlayer = new Map();
  const latestByPlayerWeek = new Map();

  for (const row of allRows) {
    const prevSeason = latestByPlayer.get(row.player_id);
    if (!prevSeason || row.fetched_at > prevSeason.fetched_at) {
      latestByPlayer.set(row.player_id, row);
    }

    const weekKey = `${row.season}-${row.week}-${row.player_id}`;
    const prevWeek = latestByPlayerWeek.get(weekKey);
    if (!prevWeek || row.fetched_at > prevWeek.fetched_at) {
      latestByPlayerWeek.set(weekKey, row);
    }
  }

  seasonRows = Array.from(latestByPlayer.values());

  weeklyRows = new Map();
  for (const row of latestByPlayerWeek.values()) {
    const key = `${row.season}-${row.week}`;
    if (!weeklyRows.has(key)) weeklyRows.set(key, []);
    weeklyRows.get(key).push(row);
  }

  weeks = Array.from(weeklyRows.keys())
    .map((key) => {
      const [season, week] = key.split("-").map(Number);
      return { key, season, week };
    })
    .sort((a, b) => a.season - b.season || a.week - b.week);

  currentWeek = weeks[weeks.length - 1]?.key ?? null;
}

function populateFilterOptions() {
  const teams = Array.from(new Set(allRows.map((r) => r.team).filter(Boolean))).sort();
  const statuses = Array.from(new Set(allRows.map((r) => r.status).filter(Boolean))).sort();

  const teamSelect = document.getElementById("team-filter");
  for (const team of teams) {
    const opt = document.createElement("option");
    opt.value = team;
    opt.textContent = team;
    teamSelect.appendChild(opt);
  }

  const statusSelect = document.getElementById("status-filter");
  for (const status of statuses) {
    const opt = document.createElement("option");
    opt.value = status;
    opt.textContent = status;
    statusSelect.appendChild(opt);
  }
}

function populateWeekSelect() {
  const weekSelect = document.getElementById("week-select");
  const multiSeason = new Set(weeks.map((w) => w.season)).size > 1;
  weekSelect.innerHTML = "";
  for (const w of weeks) {
    const opt = document.createElement("option");
    opt.value = w.key;
    opt.textContent = multiSeason ? `${w.season} - Week ${w.week}` : `Week ${w.week}`;
    weekSelect.appendChild(opt);
  }
  if (currentWeek != null) weekSelect.value = currentWeek;
}

function renderChart() {
  const ctx = document.getElementById("injury-chart");
  const multiSeason = new Set(weeks.map((w) => w.season)).size > 1;
  const datasets = POSITIONS.map((pos) => ({
    label: pos,
    backgroundColor: POSITION_COLORS[pos],
    data: weeks.map((w) => (weeklyRows.get(w.key) || []).filter((r) => r.position === pos).length),
  }));

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks.map((w) => (multiSeason ? `${w.season} Wk${w.week}` : `Wk ${w.week}`)),
      datasets,
    },
    options: {
      responsive: true,
      scales: {
        x: { stacked: true, ticks: { color: "#A0A0A0" }, grid: { color: "#1c2026" } },
        y: { stacked: true, ticks: { color: "#A0A0A0" }, grid: { color: "#1c2026" }, beginAtZero: true },
      },
      plugins: {
        legend: { labels: { color: "#E4E4E4" } },
      },
    },
  });
}

function getActiveRows() {
  return currentView === "season" ? seasonRows : (weeklyRows.get(currentWeek) || []);
}

// A player counts as "new" only in the By Week view: on the current week's
// report but not on the prior week's (season-scoped, so it can't cross years).
function getNewPlayerIds() {
  if (currentView !== "week" || currentWeek == null) return new Set();
  const [season, week] = currentWeek.split("-").map(Number);
  const prevRows = weeklyRows.get(`${season}-${week - 1}`);
  if (!prevRows) return new Set(); // no prior-week data to compare against
  const prevIds = new Set(prevRows.map((r) => r.player_id));
  const currRows = weeklyRows.get(currentWeek) || [];
  return new Set(currRows.filter((r) => !prevIds.has(r.player_id)).map((r) => r.player_id));
}

function applyFilters(rows) {
  const search = document.getElementById("search-input").value.trim().toLowerCase();
  const team = document.getElementById("team-filter").value;
  const position = document.getElementById("position-filter").value;
  const status = document.getElementById("status-filter").value;

  return rows.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search)) return false;
    if (team && r.team !== team) return false;
    if (position && r.position !== position) return false;
    if (status && r.status !== status) return false;
    return true;
  });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const av = a[sortKey] ?? "";
    const bv = b[sortKey] ?? "";
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });
}

function statusClass(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("out") || s.includes("ir")) return "status-out";
  if (s.includes("doubtful")) return "status-doubtful";
  if (s.includes("questionable")) return "status-questionable";
  return "";
}

function render() {
  const rows = sortRows(applyFilters(getActiveRows()));
  const newIds = getNewPlayerIds();
  const tbody = document.getElementById("injury-tbody");

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-row">No injuries match these filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="player-name">${r.name}${newIds.has(r.player_id) ? '<span class="new-badge">NEW</span>' : ""}</td>
      <td>${r.team ?? "-"}</td>
      <td><span class="pos-badge pos-${r.position}">${r.position}</span></td>
      <td><span class="status-badge ${statusClass(r.status)}">${r.status ?? "-"}</span></td>
      <td>${r.injury_type ?? "-"}</td>
      <td>${r.probability_of_playing != null ? Math.round(r.probability_of_playing * 100) + "%" : "-"}</td>
      <td>${r.ppg != null ? r.ppg.toFixed(1) : "-"}</td>
    </tr>
  `).join("");
}

function initEvents() {
  document.querySelectorAll(".view-toggle .pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-toggle .pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view;
      document.getElementById("week-select").hidden = currentView !== "week";
      render();
    });
  });

  document.getElementById("week-select").addEventListener("change", (e) => {
    currentWeek = e.target.value;
    render();
  });

  document.getElementById("chart-toggle").addEventListener("click", () => {
    const body = document.getElementById("chart-body");
    const btn = document.getElementById("chart-toggle");
    const willShow = body.hidden;
    body.hidden = !willShow;
    btn.setAttribute("aria-expanded", String(willShow));
    btn.querySelector(".chart-toggle-icon").innerHTML = willShow ? "&#9662;" : "&#9656;";
    if (willShow && chart) chart.resize();
  });

  ["search-input", "team-filter", "position-filter", "status-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", render);
  });

  document.querySelectorAll("#injury-table thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = 1;
      }
      render();
    });
  });
}

initEvents();
loadData();
