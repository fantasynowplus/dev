const WORKER_URL = "https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/rankings";
const RANK_LIMIT = 12;

const state = {
  draft: "QB",
  dynasty: "QB",
};

const CONTAINER_IDS = {
  draft: "rank-list-draft",
  dynasty: "rank-list-dynasty",
};

const cache = {};

async function fetchRankings(format, position) {
  const key = `${format}:${position}`;
  if (cache[key]) return cache[key];

  const url = `${WORKER_URL}?format=${format}&position=${position}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Rankings fetch failed: ${response.status}`);

  const data = await response.json();
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

  if (!data.players || data.players.length === 0) {
    container.innerHTML = '<p style="padding: 10px;">No rankings available.</p>';
    return;
  }

  container.innerHTML = data.players
    .slice(0, RANK_LIMIT)
    .map(
      (p, i) => `
        <a href="${p.pageUrl || "#"}" target="_blank" class="fnp-row">
            <div class="fnp-rank">${i + 1}</div>
            <div class="photo-box">
                <img src="${p.photoUrl || p.fallbackLogoUrl || ""}"
                     alt="${p.name}"
                     class="player-photo"
                     onerror="handleImgError(this, '${p.fallbackLogoUrl || ""}')">
            </div>
            <div>
                <span class="fnp-name">${p.name}</span>
                <span class="fnp-meta">${p.position} - ${p.team || "FA"}</span>
            </div>
        </a>
    `
    )
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
  loadFormat("draft");
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