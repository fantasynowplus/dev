async function fetchTrending(type, containerId) {
    const container = document.getElementById(containerId);
    try {
        // 1. Fetch trending IDs
        const response = await fetch(`https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=24&limit=10`);
        const trendingData = await response.json();
        
        // 2. Fetch all NFL players to get names (This is a one-time map)
        const playersResponse = await fetch('https://api.sleeper.app/v1/players/nfl');
        const allPlayers = await playersResponse.json();
        
        container.innerHTML = trendingData.map(t => {
            const p = allPlayers[t.player_id];
            if (!p) return '';
            
            // Team variable for the logo URL
            const team = p.team ? p.team.toLowerCase() : 'nfl';
            const logoUrl = `https://sleepercdn.com/images/team_logos/nfl/${team}.png`;
        
            return `
                <div class="player-row">
                    <img src="https://sleepercdn.com/content/nfl/players/${t.player_id}.jpg" 
                         alt="${p.first_name}" 
                         class="player-img" 
                         onerror="this.src='${logoUrl}';">
                    <div class="player-info">
                        <div class="player-name">${p.first_name} ${p.last_name}</div>
                        <div class="player-pos">${p.position} - ${p.team || 'FA'}</div>
                    </div>
                    <div class="player-count">+${t.count}</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Fetch Error:", err);
        container.innerHTML = '<p style="padding: 10px;">Error loading data.</p>';
    }
}

fetchTrending('add', 'adds-list');
fetchTrending('drop', 'drops-list');
