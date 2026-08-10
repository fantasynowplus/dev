const ALL_CHANNELS = [
    'UCCW6qFFB7ezwJk1cLPjPHDg', // main channel
    'UCYVj7kCSQ5iogXUGoVV5uqA', // Get Tilted
    'UCwbYE7IpXw0GEMB03vQcfPg'  // Dynasty
];

const RANKINGS_PLAYLISTS = [
    'PLG9ZMMQPPOMA', // Main Channel Redraft Rankings
    'PLL_4CfGZ4F9I', // Get Tilted Best Ball Rankings
    'PLR9K2bdHCzeQ'  // Dynasty Rankings
];

function setActiveButton(buttonElement) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');
}

async function fetchFeedItems(sourceId) {
    const isChannel = sourceId.startsWith('UC');
    const rss = isChannel
        ? `https://www.youtube.com/feeds/videos.xml?channel_id=${sourceId}`
        : `https://www.youtube.com/feeds/videos.xml?playlist_id=${sourceId}`;

    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rss)}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status !== 'ok' || !Array.isArray(data.items)) {
        throw new Error(data.message || 'Feed returned no items');
    }
    return data.items;
}

function renderVideos(videos) {
    const container = document.getElementById('youtube-feed');
    container.innerHTML = videos.map(v => `
            <div class="video-card">
                <a href="${v.link}" target="_blank" rel="noopener">
                    <img src="${v.thumbnail}" class="thumbnail" alt="${v.title}">
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