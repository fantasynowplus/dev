async function fetchNews() {
    const rssUrl = "https://rss.app/feeds/t0yMjPknbcSjLVy8.xml";
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data.items) {
            const container = document.getElementById('news-container');
            // We create a string of links
            const content = data.items.map(item => 
                `<a href="${item.link}" target="_blank">${item.title}</a>`
            ).join(" ••• ");
            
            // Inject content
            container.innerHTML = content;
        }
    } catch (err) {
        console.error("Ticker Error:", err);
    }
}

// Run immediately
fetchNews();
