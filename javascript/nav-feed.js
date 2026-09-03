const NAV_FEED_PROXY = 'https://fantasynowplus-rankings-proxy.fantasynowplus.workers.dev/yt?id=';
const NAV_ALL_CHANNELS = [
    'UCCW6qFFB7ezwJk1cLPjPHDg',
    'UCYVj7kCSQ5iogXUGoVV5uqA',
    'UCwbYE7IpXw0GEMB03vQcfPg'
];

let navFeedLoaded = false;

async function fetchNavFeedItems(channelId) {
    const response = await fetch(NAV_FEED_PROXY + encodeURIComponent(channelId));
    if (!response.ok) throw new Error('Proxy returned ' + response.status);
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const YT_NS = 'http://www.youtube.com/xml/schemas/2015';
    const MEDIA_NS = 'http://search.yahoo.com/mrss/';
    return [...xml.querySelectorAll('entry')].map(entry => {
        const link = entry.querySelector('link')?.getAttribute('href') || '';
        const vid = entry.getElementsByTagNameNS(YT_NS, 'videoId')[0]?.textContent
            || (link.match(/(?:[?&]v=|\/shorts\/)([\w-]{11})/) || [])[1] || '';
        const feedThumb = entry.getElementsByTagNameNS(MEDIA_NS, 'thumbnail')[0]?.getAttribute('url');
        return {
            title: entry.querySelector('title')?.textContent || '',
            link: link,
            pubDate: entry.querySelector('published')?.textContent || '',
            thumbnail: feedThumb || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '')
        };
    });
}

async function loadNavLatestFeed() {
    if (navFeedLoaded) return;
    navFeedLoaded = true;

    const container = document.getElementById('nav-latest-feed');
    if (!container) return;

    try {
        const results = await Promise.allSettled(NAV_ALL_CHANNELS.map(fetchNavFeedItems));
        const items = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
        items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        container.innerHTML = items.slice(0, 4).map(v => `
            <a href="${v.link}" class="mega-video" target="_blank" rel="noopener">
                <img src="${v.thumbnail}" alt="${v.title}">
                <span class="mega-video-title">${v.title}</span>
            </a>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p class="feed-error">Feed unavailable.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const trigger = document.querySelector('.mega-trigger');
    if (trigger) {
        trigger.addEventListener('mouseenter', loadNavLatestFeed, { once: true });
        trigger.addEventListener('focusin', loadNavLatestFeed, { once: true });
    }
});
