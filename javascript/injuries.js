const SUPABASE_URL = "https://fckobcxprmudfpxdmswi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja29iY3hwcm11ZGZweGRtc3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTI5MzcsImV4cCI6MjA5OTE4ODkzN30.9wMb0SXAZs-jo1G9xRxk5M47fJIIU7-DTJTl1yFRwFk";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const POSITIONS = ["QB", "RB", "WR", "TE"];
const POSITION_COLORS = {
  QB: "#FFA515",
  RB: "#42F4B0",
  WR: "#EA4E3D",
  TE: "#7FA5D8",
};

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
  const { data, error } = await supabase
    .from("injury_reports")
    .select("*")
    .order("fetched_at", { ascending: true });

  if (error) {
    console.error(error);
    document.getElementById("injury-tbody").innerHTML =
      `<tr><td colspan="8" class="loading-row">Couldn't load injury data.</td></tr>`;
    return;
  }

  allRows = data ?? [];
  processData();
  populateFilterOptions();
  populateWeekSelect();
  renderChart();
  render();
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

    const weekKey = `${row.week}-${row.player_id}`;
    const prevWeek = latestByPlayerWeek.get(weekKey);
    if (!prevWeek || row.fetched_at > prevWeek.fetched_at) {
      latestByPlayerWeek.set(weekKey, row);
    }
  }

  seasonRows = Array.from(latestByPlayer.values());

  weeklyRows = new Map();
  for (const row of latestByPlayerWeek.values()) {
    if (!weeklyRows.has(row.week)) weeklyRows.set(row.week, []);
    weeklyRows.get(row.week).push(row);
  }

  weeks = Array.from(weeklyRows.keys()).sort((a, b) => a - b);
  currentWeek = weeks[weeks.length - 1] ?? null;
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
  weekSelect.innerHTML = "";
  for (const week of weeks) {
    const opt = document.createElement("option");
    opt.value = week;
    opt.textContent = `Week ${week}`;
    weekSelect.appendChild(opt);
  }
  if (currentWeek != null) weekSelect.value = currentWeek;
}

function renderChart() {
  const ctx = document.getElementById("injury-chart");
  const datasets = POSITIONS.map((pos) => ({
    label: pos,
    backgroundColor: POSITION_COLORS[pos],
    data: weeks.map((week) => (weeklyRows.get(week) || []).filter((r) => r.position === pos).length),
  }));

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks.map((w) => `Wk ${w}`),
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
  const tbody = document.getElementById("injury-tbody");

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-row">No injuries match these filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="player-name">${r.name}</td>
      <td>${r.team ?? "-"}</td>
      <td><span class="pos-badge pos-${r.position}">${r.position}</span></td>
      <td><span class="status-badge ${statusClass(r.status)}">${r.status ?? "-"}</span></td>
      <td>${r.injury_type ?? "-"}</td>
      <td>${r.probability_of_playing != null ? Math.round(r.probability_of_playing * 100) + "%" : "-"}</td>
      <td>${r.injury_update_date ?? "-"}</td>
      <td class="comment-cell">${r.comment ?? ""}</td>
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
    currentWeek = Number(e.target.value);
    render();
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
