async function fetchNews() {
    const rssUrl = "https://rss.app/feeds/t0yMjPknbcSjLVy8.xml";
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    const container = document.getElementById('news-container');

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.items && data.items.length) {
            // We create a string of links
            const content = data.items.map(item => 
                `<a href="${item.link}" target="_blank">${item.title}</a>`
            ).join(" ••• ");
            
            // Inject content
            container.innerHTML = content;
        } else {
            console.warn("Ticker: feed returned no items", data);
            if (container) container.textContent = "Headlines temporarily unavailable.";
        }
    } catch (err) {
        console.error("Ticker Error:", err);
        if (container) container.textContent = "Headlines temporarily unavailable.";
    }
}

// Run immediately
fetchNews();
