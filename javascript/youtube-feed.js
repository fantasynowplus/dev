async function loadFeed(playlistId, buttonElement) {
    // 1. Update active class on buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');

    // 2. Fetch logic (same as before)
    const isChannel = playlistId === 'UCCW6qFFB7ezwJk1cLPjPHDg';
    const rss = isChannel 
        ? `https://www.youtube.com/feeds/videos.xml?channel_id=${playlistId}`
        : `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
        
    const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rss}`);
    const data = await response.json();
    const videos = data.items.slice(0, 8);

    const container = document.getElementById('youtube-feed');
    container.innerHTML = videos.map(v => `
        <div class="video-card">
            <a href="${v.link}" target="_blank">
                <img src="${v.thumbnail}" class="thumbnail" alt="${v.title}">
            </a>
            <div class="video-info">
                <h3 class="video-title">${v.title}</h3>
                <p class="video-date">${new Date(v.pubDate).toLocaleDateString()}</p>
            </div>
        </div>
    `).join('');
}
