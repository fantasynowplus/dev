const NEWS_URL = "https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/news?limit=30";
const NEWS_CACHE_KEY = "fnp_news_ticker";
const TICKER_STATE_KEY = "fnp_ticker_state";
const NEWS_TTL = 5 * 60 * 1000;

function escHTML(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderTicker(container, items) {
    container.innerHTML = items.map(item => {
        const badge = item.injury ? '<span class="ticker-tag">INJURY</span>' : '';
        const team = item.team && item.team !== "FA"
            ? `<span class="ticker-team">${escHTML(item.team)}</span>` : '';
        return `<a href="${escHTML(item.link)}" target="_blank" rel="noopener">${badge}${team}${escHTML(item.title)}</a>`;
    }).join(" ••• ");
}

function sigOf(items) {
    return items.map(i => i.id).join(",");
}

function syncTickerPosition(container, signature) {
    let state = null;
    try { state = JSON.parse(localStorage.getItem(TICKER_STATE_KEY) || "null"); } catch (e) {}
    if (!state || state.sig !== signature) {
        state = { sig: signature, epoch: Date.now() };
        try { localStorage.setItem(TICKER_STATE_KEY, JSON.stringify(state)); } catch (e) {}
    }
    const dur = parseFloat(getComputedStyle(container).animationDuration) || 90;
    const elapsed = ((Date.now() - state.epoch) / 1000) % dur;
    container.style.animationDelay = `-${elapsed.toFixed(2)}s`;
}

function paint(container, items) {
    renderTicker(container, items);
    syncTickerPosition(container, sigOf(items));
}

async function refreshNews(container, silent) {
    try {
        const response = await fetch(NEWS_URL);
        const data = await response.json();
        if (data.items && data.items.length) {
            try {
                localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ at: Date.now(), items: data.items }));
            } catch (e) {}
            if (!silent) paint(container, data.items);
            return;
        }
        console.warn("Ticker: news feed returned no items", data);
    } catch (err) {
        console.error("Ticker Error:", err);
    }
    if (!silent) container.textContent = "Headlines temporarily unavailable.";
}

async function fetchNews() {
    const container = document.getElementById('news-container');
    if (!container) return;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || "null"); } catch (e) {}
    if (cached && cached.items && cached.items.length) {
        paint(container, cached.items);
        if (Date.now() - (cached.at || 0) >= NEWS_TTL) refreshNews(container, true);
        return;
    }
    await refreshNews(container, false);
}

fetchNews();