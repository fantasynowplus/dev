async function loadFeed(playlistId, buttonElement) {
    // 1. Update active class on buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');

    // 2. Fetch logic (same as before)
    const isChannel = playlistId === 'UCCW6qFFB7ezwJk1cLPjPHDg';
    const rss = isChannel 
        ? `https://www.youtube.com/feeds/videos.xml?channel_id=${playlistId}`
        : `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
        
    const container = document.getElementById('youtube-feed');
    container.innerHTML = 'Loading...';

    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rss)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.status !== 'ok' || !Array.isArray(data.items) || data.items.length === 0) {
            throw new Error(data.message || 'Feed returned no items');
        }

        const videos = data.items.slice(0, 8);
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
    } catch (err) {
        console.error('Feed load failed:', err);
        container.innerHTML = '<p class="feed-error">Feed unavailable right now — please refresh.</p>';
    }
}
