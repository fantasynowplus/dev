const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT_BP0MJYd9QseL_8gMK3YKNVRbZLut6CMBxcm06-BhAcUxmSJMBjpv8d8IHFEYv58YriwEYqKZ1sg3/pub?output=csv';

const nflFull = {
    "FA": {n: "Free Agent", logo: ""},
    "ARI": {n: "Arizona Cardinals", logo: "https://sleepercdn.com/images/team_logos/nfl/ari.png"},
    "ATL": {n: "Atlanta Falcons", logo: "https://sleepercdn.com/images/team_logos/nfl/atl.png"},
    "BAL": {n: "Baltimore Ravens", logo: "https://sleepercdn.com/images/team_logos/nfl/bal.png"},
    "BUF": {n: "Buffalo Bills", logo: "https://sleepercdn.com/images/team_logos/nfl/buf.png"},
    "CAR": {n: "Carolina Panthers", logo: "https://sleepercdn.com/images/team_logos/nfl/car.png"},
    "CHI": {n: "Chicago Bears", logo: "https://sleepercdn.com/images/team_logos/nfl/chi.png"},
    "CIN": {n: "Cincinnati Bengals", logo: "https://sleepercdn.com/images/team_logos/nfl/cin.png"},
    "CLE": {n: "Cleveland Browns", logo: "https://sleepercdn.com/images/team_logos/nfl/cle.png"},
    "DAL": {n: "Dallas Cowboys", logo: "https://sleepercdn.com/images/team_logos/nfl/dal.png"},
    "DEN": {n: "Denver Broncos", logo: "https://sleepercdn.com/images/team_logos/nfl/den.png"},
    "DET": {n: "Detroit Lions", logo: "https://sleepercdn.com/images/team_logos/nfl/det.png"},
    "GB": {n: "Green Bay Packers", logo: "https://sleepercdn.com/images/team_logos/nfl/gb.png"},
    "HOU": {n: "Houston Texans", logo: "https://sleepercdn.com/images/team_logos/nfl/hou.png"},
    "IND": {n: "Indianapolis Colts", logo: "https://sleepercdn.com/images/team_logos/nfl/ind.png"},
    "JAX": {n: "Jacksonville Jaguars", logo: "https://sleepercdn.com/images/team_logos/nfl/jax.png"},
    "KC": {n: "Kansas City Chiefs", logo: "https://sleepercdn.com/images/team_logos/nfl/kc.png"},
    "LV": {n: "Las Vegas Raiders", logo: "https://sleepercdn.com/images/team_logos/nfl/lv.png"},
    "LAC": {n: "Los Angeles Chargers", logo: "https://sleepercdn.com/images/team_logos/nfl/lac.png"},
    "LAR": {n: "Los Angeles Rams", logo: "https://sleepercdn.com/images/team_logos/nfl/lar.png"},
    "MIA": {n: "Miami Dolphins", logo: "https://sleepercdn.com/images/team_logos/nfl/mia.png"},
    "MIN": {n: "Minnesota Vikings", logo: "https://sleepercdn.com/images/team_logos/nfl/min.png"},
    "NE": {n: "New England Patriots", logo: "https://sleepercdn.com/images/team_logos/nfl/ne.png"},
    "NO": {n: "New Orleans Saints", logo: "https://sleepercdn.com/images/team_logos/nfl/no.png"},
    "NYG": {n: "New York Giants", logo: "https://sleepercdn.com/images/team_logos/nfl/nyg.png"},
    "NYJ": {n: "New York Jets", logo: "https://sleepercdn.com/images/team_logos/nfl/nyj.png"},
    "PHI": {n: "Philadelphia Eagles", logo: "https://sleepercdn.com/images/team_logos/nfl/phi.png"},
    "PIT": {n: "Pittsburgh Steelers", logo: "https://sleepercdn.com/images/team_logos/nfl/pit.png"},
    "SF": {n: "San Francisco 49ers", logo: "https://sleepercdn.com/images/team_logos/nfl/sf.png"},
    "SEA": {n: "Seattle Seahawks", logo: "https://sleepercdn.com/images/team_logos/nfl/sea.png"},
    "TB": {n: "Tampa Bay Buccaneers", logo: "https://sleepercdn.com/images/team_logos/nfl/tb.png"},
    "TEN": {n: "Tennessee Titans", logo: "https://sleepercdn.com/images/team_logos/nfl/ten.png"},
    "WAS": {n: "Washington Commanders", logo: "https://sleepercdn.com/images/team_logos/nfl/was.png"}
};

const getPosColor = (pos) => ({ "QB": "#ff3079", "RB": "#01ffc3", "WR": "#00b8ff", "TE": "#FFA515", "K": "#AF61ED", "DEF": "#00b8ff", "DL": "#FF795A", "LB": "#6D7DF5", "DB": "#FF7CB6" }[pos] || "#ccc");

async function loadLeagues() {
    const user = document.getElementById('username').value;
    document.getElementById('loader').style.display = 'block';
    const uRes = await fetch(`https://api.sleeper.app/v1/user/${user}`);
    const u = await uRes.json();
    const lRes = await fetch(`https://api.sleeper.app/v1/user/${u.user_id}/leagues/nfl/2026`);
    const ls = await lRes.json();
    
    const s = document.getElementById('leagueSelect');
    s.innerHTML = ''; // Clear previous
    
    // Add default placeholder
    const defaultOption = new Option("Select Your League", "");
    s.add(defaultOption);
    
    ls.forEach(l => s.add(new Option(l.name, l.league_id)));
    
    document.getElementById('step2').style.display = 'block';
    document.getElementById('loader').style.display = 'none';
    window.currentUserId = u.user_id;
}

async function generate() {
    const lId = document.getElementById('leagueSelect').value;
    if (!lId) return; // Don't run if default is selected

    // Target the specific loader message element
    const loaderMsg = document.getElementById('loader'); 
    loaderMsg.innerText = "Syncing Team...";
    loaderMsg.style.display = 'block';

    const [rostersRes, usersRes, sheetRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${lId}/rosters`).then(r => r.json()),
        fetch(`https://api.sleeper.app/v1/league/${lId}/users`).then(r => r.json()),
        fetch(SHEET_URL).then(r => r.text())
    ]);

    const rows = sheetRes.split('\n').slice(1);
    const playerMap = new Map();
    rows.forEach(row => {
        const [id, name, pos, img, team, score] = row.split(',');
        if(id) playerMap.set(id.trim(), { 
            name, 
            pos, 
            img, 
            team: team ? team.trim() : "FA", // Ensures the team key is clean
            score: parseFloat(score) || 0 });
    });

    const roster = rostersRes.find(r => r.owner_id === window.currentUserId);
    const user = usersRes.find(u => u.user_id === window.currentUserId);
    const players = roster.players.map(id => playerMap.get(id) || { name: 'Unknown', pos: 'BN', img: '', team: 'FA', score: 0 });

    await draw({ players, teamName: user.metadata.team_name || "MY TEAM" });
    loaderMsg.style.display = 'none';
    loaderMsg.innerText = "Loading..."; // Reset text for next time
}

async function draw(data) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const leagueName = document.getElementById('leagueSelect').selectedOptions[0].text;
    const username = document.getElementById('username').value;
    const footerHeightPx = 50; 
    const cols = 4, cardW = 300, cardH = 75, gap = 12, headerH = 180, sidePad = 40;
    const posOrder = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
    let sortedList = [];
    posOrder.forEach(pos => {
      const group = data.players
        .filter(p => p.pos === pos)
        .sort((a, b) => { if (b.score !== a.score) return b.score - a.score; return a.name.localeCompare(b.name); });
      sortedList.push(...group);
    });
    
    const rows = Math.ceil(sortedList.length / cols);
    canvas.width = (cardW * cols) + (gap * (cols - 1)) + (sidePad * 2);
    canvas.height = headerH + (rows * (cardH + gap)) + footerHeightPx + 20;
    
    ctx.fillStyle = "#001c45";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 80px sans-serif";
    ctx.fillText(data.teamName.toUpperCase(), sidePad, 85);
    ctx.fillStyle = "#FFA515"; 
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(leagueName.toUpperCase() + " • " + username.toUpperCase() + " • 2026 ROSTER", sidePad, 125);
    
    for (let i = 0; i < sortedList.length; i++) {
      const p = sortedList[i];
      const meta = nflFull[p.team] || nflFull["FA"];
      const posColor = getPosColor(p.pos);
      const colIdx = Math.floor(i / rows);
      const rowIdx = i % rows;
      const x = sidePad + (colIdx * (cardW + gap));
      const y = headerH + (rowIdx * (cardH + gap));
      
      ctx.fillStyle = "#2d5285";
      ctx.shadowColor = "rgba(0,0,0,0.1)"; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.roundRect(x, y, cardW, cardH, 6); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = posColor;
      ctx.fillRect(x, y + cardH - 8, cardW, 8);
      ctx.beginPath();
      ctx.moveTo(x + cardW - 65, y + cardH - 8); 
      ctx.lineTo(x + cardW - 55, y + cardH - 24); 
      ctx.lineTo(x + cardW, y + cardH - 24);      
      ctx.lineTo(x + cardW, y + cardH - 8);       
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "black"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(p.team || "FA", x + cardW - 28, y + cardH - 12);
      ctx.textAlign = "left"; ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 17px sans-serif";
      ctx.fillText(p.name, x + 80, y + 28);
      ctx.fillStyle = "#FFFFFF"; ctx.font = "500 11px sans-serif";
      ctx.fillText(`${p.pos} | ${meta.n.toUpperCase()}`, x + 80, y + 46);
      
      ctx.save();
      ctx.beginPath(); ctx.arc(x + 38, y + 37, 30, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle = posColor;
      ctx.beginPath(); ctx.arc(x + 38, y + 37, 30, 0, Math.PI*2); ctx.fill();
      const imgUrl = (p.img && p.img !== "") ? p.img : meta.logo;
      if(imgUrl) {
        await new Promise(r => {
          const img = new Image(); img.crossOrigin = "anonymous";
          img.src = imgUrl + (imgUrl.includes('?') ? '&' : '?') + "t=" + Date.now();
          img.onload = () => {
            const sc = Math.max(60/img.width, 60/img.height);
            ctx.drawImage(img, (x+38)-(img.width*sc)/2, (y+37)-(img.height*sc)/2, img.width*sc, img.height*sc);
            r();
          };
          img.onerror = r;
        });
      }
      ctx.restore();
    }
    
    ctx.fillStyle = "#0a0f1a"; 
    ctx.fillRect(0, canvas.height - footerHeightPx, canvas.width, footerHeightPx);
    
    const footerY = canvas.height - (footerHeightPx / 2) + 8;
    const mainText = "FantasyRoster powered by ";
    const brandText = "FantasyNow";
    const plusText = "+";
    
    ctx.font = "bold 20px sans-serif";
    
    // Calculate total width first to center the group
    const widthMain = ctx.measureText(mainText).width;
    const widthBrand = ctx.measureText(brandText).width;
    const widthPlus = ctx.measureText(plusText).width;
    const totalWidth = widthMain + widthBrand + widthPlus;
    
    let currentX = (canvas.width - totalWidth) / 2;
    
    // Draw each part sequentially
    ctx.textAlign = "left";
    
    ctx.fillStyle = "#94a3b8"; 
    ctx.fillText(mainText, currentX, footerY);
    currentX += widthMain;
    
    ctx.fillStyle = "#FFFFFF"; 
    ctx.fillText(brandText, currentX, footerY);
    currentX += widthBrand;
    
    ctx.fillStyle = "#FFA515"; 
    ctx.fillText(plusText, currentX, footerY);
    
    const finalImg = document.getElementById('finalImage');
    finalImg.src = canvas.toDataURL("image/png");
    finalImg.style.display = 'block';
    document.getElementById('dlBtn').style.display = 'block';
    finalImg.scrollIntoView({behavior: 'smooth'});
}
