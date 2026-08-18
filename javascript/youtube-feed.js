const FEED_PROXY = 'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/yt?id=';
const ALL_CHANNELS = [
    'UCCW6qFFB7ezwJk1cLPjPHDg', // main channel
    'UCYVj7kCSQ5iogXUGoVV5uqA', // Get Tilted
    'UCwbYE7IpXw0GEMB03vQcfPg'  // Dynasty
];

const RANKINGS_PLAYLISTS = [
    'PLUVFeEpJJhZY', // Main Channel Redraft Rankings
    'PLL_4CfGZ4F9I', // Get Tilted Best Ball Rankings
    'PLR9K2bdHCzeQ'  // Dynasty Rankings
];

function setActiveButton(buttonElement) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');
}

async function fetchFeedItems(sourceId) {
    const cacheKey = 'yt_feed_' + sourceId;
    try {
        const response = await fetch(FEED_PROXY + encodeURIComponent(sourceId));
        if (!response.ok) throw new Error('Proxy returned ' + response.status);
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
        if (xml.querySelector('parsererror')) throw new Error('Feed was not valid XML');
        const YT_NS = 'http://www.youtube.com/xml/schemas/2015';
        const MEDIA_NS = 'http://search.yahoo.com/mrss/';
        const items = [...xml.querySelectorAll('entry')].map(entry => {
            const link = entry.querySelector('link')?.getAttribute('href') || '';
            const vid = entry.getElementsByTagNameNS(YT_NS, 'videoId')[0]?.textContent
                || (link.match(/(?:[?&]v=|\/shorts\/)([\w-]{11})/) || [])[1] || '';
            const feedThumb = entry.getElementsByTagNameNS(MEDIA_NS, 'thumbnail')[0]?.getAttribute('url');
            return {
                title: entry.querySelector('title')?.textContent || '',
                link: link,
                pubDate: entry.querySelector('published')?.textContent || '',
                thumbnail: feedThumb || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : ''),
                vid: vid
            };
        });
        if (!items.length) throw new Error('Feed returned no items');
        try { localStorage.setItem(cacheKey, JSON.stringify(items)); } catch (e) {}
        return items;
    } catch (err) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached);
        throw err;
    }
}

function renderVideos(videos) {
    const container = document.getElementById('youtube-feed');
    container.innerHTML = videos.map(v => `
            <div class="video-card">
                <a href="${v.link}" target="_blank" rel="noopener">
                                        <img src="${v.thumbnail}" class="thumbnail" alt="${v.title}"
                         onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.vid}/oardefault.jpg';">
                </a>
                <div class="video-info">
                    <h3 class="video-title">${v.title}</h3>
                    <p class="video-date">${new Date(v.pubDate).toLocaleDateString()}</p>
                </div>
            </div>
        `).join('');
}

async function loadFeed(playlistId, buttonElement) {
    setActiveButton(buttonElement);

    const container = document.getElementById('youtube-feed');
    container.innerHTML = 'Loading...';

    try {
        const items = await fetchFeedItems(playlistId);
        if (items.length === 0) throw new Error('Feed returned no items');
        renderVideos(items.slice(0, 8));
    } catch (err) {
        console.error('Feed load failed:', err);
        container.innerHTML = '<p class="feed-error">Feed unavailable right now — please refresh.</p>';
    }
}

async function loadMergedFeed(sourceIds, buttonElement) {
    setActiveButton(buttonElement);

    const container = document.getElementById('youtube-feed');
    container.innerHTML = 'Loading...';

    try {
        const results = await Promise.allSettled(sourceIds.map(fetchFeedItems));
        const items = results
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value);

        if (items.length === 0) throw new Error('No items from any source');

        items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        renderVideos(items.slice(0, 8));
    } catch (err) {
        console.error('Feed load failed:', err);
        container.innerHTML = '<p class="feed-error">Feed unavailable right now — please refresh.</p>';
    }
}

function loadAllFeed(buttonElement) {
    loadMergedFeed(ALL_CHANNELS, buttonElement);
}

function loadRankingsFeed(buttonElement) {
    loadMergedFeed(RANKINGS_PLAYLISTS, buttonElement);
}

document.addEventListener('DOMContentLoaded', () => {
    loadAllFeed(document.getElementById('all-btn'));
});