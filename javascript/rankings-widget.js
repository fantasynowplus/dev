const WORKER_BASE = "https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev";
const RANK_LIMIT = 12;
const WEEKLY_SLUG = "weekly";
const WEEK1_START = Date.UTC(2026, 8, 8);

const state = {
  weekly: "QB",
  dynasty: "QB",
};

const CONTAINER_IDS = {
  weekly: "rank-list-weekly",
  dynasty: "rank-list-dynasty",
};

const cache = {};
let weeklyPageConfigPromise = null;

function currentWeek() {
  const w = Math.floor((Date.now() - WEEK1_START) / 604800000) + 1;
  return Math.max(1, Math.min(18, w));
}

function waitForSupabase(cb) {
  let tries = 0;
  (function poll() {
    if (typeof SUPABASE_URL !== "undefined" && typeof SUPABASE_ANON_KEY !== "undefined") {
      return cb(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    if (++tries > 40) return cb(null, null);
    setTimeout(poll, 50);
  })();
}

function rankingsRpc(name) {
  return new Promise((resolve) => {
    waitForSupabase((url, key) => {
      if (!url || !key) return resolve(null);
      fetch(`${url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: "{}",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(resolve)
        .catch(() => resolve(null));
    });
  });
}

function getWeeklyPageConfig() {
  if (!weeklyPageConfigPromise) {
    weeklyPageConfigPromise = rankingsRpc("rankings_public_config").then(
      (pages) => (pages || []).find((p) => p.slug === WEEKLY_SLUG) || null
    );
  }
  return weeklyPageConfigPromise;
}

async function fetchRankings(format, position) {
  const key = `${format}:${position}`;
  if (cache[key]) return cache[key];

  let data;
  if (format === "weekly") {
    const page = await getWeeklyPageConfig();
    if (!page) throw new Error("Weekly rankings page not configured");

    const week = Number(page.week) < 0 ? currentWeek() : page.week || 0;
    const params = new URLSearchParams({
      type: page.wtype || "ST",
      position,
      scoring: page.scoring || "PPR",
      year: String(page.year || 2026),
      week: String(week),
    });
    if (page.filters) params.set("filters", page.filters);
    else if (page.expert) params.set("expert", page.expert);

    const response = await fetch(`${WORKER_BASE}/expert-rankings?${params.toString()}`);
    if (!response.ok) throw new Error(`Rankings fetch failed: ${response.status}`);
    data = await response.json();
  } else {
    const url = `${WORKER_BASE}/rankings?format=${format}&position=${position}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Rankings fetch failed: ${response.status}`);
    data = await response.json();
  }

  cache[key] = data;
  return data;
}

function handleImgError(imgEl, fallbackUrl) {
  if (fallbackUrl && imgEl.dataset.triedFallback !== "1") {
    imgEl.dataset.triedFallback = "1";
    imgEl.src = fallbackUrl;
  } else {
    imgEl.style.visibility = "hidden";
  }
}

function renderRankings(data, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const players = (data.players || [])
    .slice()
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
    .slice(0, RANK_LIMIT);

  if (players.length === 0) {
    const message = data.week != null
      ? `Week ${data.week} rankings coming soon!`
      : "No rankings available.";
    container.innerHTML = `<p style="padding: 10px;">${message}</p>`;
    return;
  }

  container.innerHTML = players
    .map((p, i) => {
      const fallback = p.fallbackLogoUrl || p.teamLogoUrl || "";
      return `
        <a href="${p.pageUrl || "#"}" target="_blank" class="fnp-row">
            <div class="fnp-rank">${i + 1}</div>
            <div class="photo-box">
                <img src="${p.photoUrl || fallback}"
                     alt="${p.name}"
                     class="player-photo"
                     onerror="handleImgError(this, '${fallback}')">
            </div>
            <div>
                <span class="fnp-name">${p.name}</span>
                <span class="fnp-meta">${p.position} - ${p.team || "FA"}</span>
            </div>
        </a>
    `;
    })
    .join("");
}

async function loadFormat(format) {
  const containerId = CONTAINER_IDS[format];
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = "Loading...";

  try {
    const data = await fetchRankings(format, state[format]);
    renderRankings(data, containerId);
  } catch (err) {
    console.error("Rankings error:", err);
    if (container) {
      container.innerHTML = '<p style="padding: 10px;">Error loading rankings.</p>';
    }
  }
}

function loadAndRender() {
  loadFormat("weekly");
  loadFormat("dynasty");
}

function switchTab(format, position, el) {
  state[format] = position;

  if (el) {
    const group = el.closest(".fnp-nav");
    if (group) {
      group.querySelectorAll(".pos-bubble").forEach((b) => b.classList.remove("active"));
    }
    el.classList.add("active");
  }

  loadFormat(format);
}

document.addEventListener("DOMContentLoaded", loadAndRender);