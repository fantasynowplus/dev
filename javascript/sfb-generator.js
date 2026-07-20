const MFL_YEAR = '2026';
const CLOUDFLARE_WORKER_URL = 'https://sfb.fantasynowplus.workers.dev';

function getMFLProxyUrl(type, leagueId) {
    return `${CLOUDFLARE_WORKER_URL}?TYPE=${type}&LEAGUE_ID=${leagueId}`;
}

const SFB16_LEAGUES = [
    { id: '42801', name: '#SFB16 - Baseball Stars' },
    { id: '46308', name: '#SFB16 - Crazy Taxi' },
    { id: '23484', name: '#SFB16 - Double dragon' },
    { id: '39518', name: '#SFB16 - Double dribble' },
    { id: '54792', name: '#SFB16 - Duck Hunt' },
    { id: '73136', name: '#SFB16 - Excitebike' },
    { id: '14494', name: '#SFB16 - Frogger' },
    { id: '61959', name: '#SFB16 - Ice Hockey' },
    { id: '43844', name: '#SFB16 - Metroid' },
    { id: '41323', name: '#SFB16 - Mutant League Football' },
    { id: '65583', name: '#SFB16 - NBA Jam (Berry)' },
    { id: '15797', name: '#SFB16 - NHL 2021' },
    { id: '72117', name: '#SFB16 - Pitfall' },
    { id: '55743', name: '#SFB16 - Pong' },
    { id: '25949', name: '#SFB16 - Rampage' },
    { id: '44962', name: '#SFB16 - Tetris' },
    { id: '38735', name: '#SFB16 - Zelda' }
];

function handlePlatformChange() {
    const platform = document.getElementById('platform').value;
    const sleeperInputs = document.getElementById('sleeperInputs');
    const mflInputs = document.getElementById('mflInputs');

    if (platform === 'sleeper') {
        sleeperInputs.style.display = 'block';
        mflInputs.style.display = 'none';
    } else {
        sleeperInputs.style.display = 'none';
        mflInputs.style.display = 'block';
    }
}

async function handleMFLLeagueChange() {
    const leagueId = document.getElementById('mflLeague').value;
    const franchiseSelect = document.getElementById('mflFranchise');
    
    if (!leagueId) {
        franchiseSelect.innerHTML = '<option value="">Select a franchise</option>';
        return;
    }

    franchiseSelect.innerHTML = '<option value="">Loading franchises...</option>';

    try {
        const res = await fetch(getMFLProxyUrl('league', leagueId));
        const data = await res.json();
        
        if (!data.league || !data.league.franchises || !data.league.franchises.franchise) {
            alert("Could not load franchises for this league");
            franchiseSelect.innerHTML = '<option value="">Select a franchise</option>';
            return;
        }

        const franchises = Array.isArray(data.league.franchises.franchise) 
            ? data.league.franchises.franchise 
            : [data.league.franchises.franchise];

        franchiseSelect.innerHTML = '<option value="">Select a franchise</option>';
        franchises.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = `${f.name} (${f.id})`;
            franchiseSelect.appendChild(option);
        });
    } catch (e) {
        console.error("Error loading franchises:", e);
        alert("Error loading franchises: " + e.message);
        franchiseSelect.innerHTML = '<option value="">Select a franchise</option>';
    }
}

async function generateGraphic() {
    const platform = document.getElementById('platform').value;
    const loader = document.getElementById('loader');

    loader.style.display = 'block';
    loader.innerText = "Syncing draft data...";

    try {
        if (platform === 'sleeper') {
            const username = document.getElementById('username').value;
            if (!username) return alert("Enter your Sleeper username");
            await handleSleeper(username);
        } else {
            const leagueId = document.getElementById('mflLeague').value;
            const franchiseId = document.getElementById('mflFranchise').value;
            if (!leagueId || !franchiseId) return alert("Select both league and franchise");
            await handleMFL(leagueId, franchiseId);
        }
    } catch (e) {
        console.error("Detailed Error:", e);
        alert("Error fetching data: " + e.message); 
    } finally {
        loader.style.display = 'none';
    }
}

async function handleSleeper(username) {
    const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
    const user = await userRes.json();
    
    const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2026`);
    const leagues = await leaguesRes.json();
    
    const sfbLeague = leagues.find(l => l.name && l.name.startsWith("#SFB16"));
    if (!sfbLeague) return alert("No #SFB16 league found for this user.");
    
    const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${sfbLeague.league_id}`);
    const leagueData = await leagueRes.json();
    
    if (!leagueData.draft_id) return alert("No draft found for this league");
    
    const picksRes = await fetch(`https://api.sleeper.app/v1/draft/${leagueData.draft_id}/picks`);
    const allPicks = await picksRes.json();
    
    const myPicks = allPicks
        .filter(p => p.picked_by === user.user_id)
        .sort((a, b) => a.pick_no - b.pick_no);
    
    if (myPicks.length === 0) return alert("No picks found for this user");
    
    draw(myPicks, user.display_name, sfbLeague.name, allPicks);
}

async function handleMFL(leagueId, franchiseId) {
    const leagueRes = await fetch(getMFLProxyUrl('league', leagueId));
    const leagueData = await leagueRes.json();
    
    const draftRes = await fetch(getMFLProxyUrl('draftResults', leagueId));
    const draftData = await draftRes.json();
    
    const playersRes = await fetch(getMFLProxyUrl('players', leagueId));
    const playersData = await playersRes.json();
    
    if (!leagueData.league || !leagueData.league.franchises || !leagueData.league.franchises.franchise) return alert("Could not load league data");
    if (!draftData.draftResults) return alert("No draft results found");
    if (!playersData.players || !playersData.players.player) return alert("Could not load player data");
    
    const franchises = Array.isArray(leagueData.league.franchises.franchise) 
        ? leagueData.league.franchises.franchise 
        : [leagueData.league.franchises.franchise];
    
    const managerFranchise = franchises.find(f => f.id === franchiseId);
    if (!managerFranchise) return alert("Franchise not found");
    
    const managerName = managerFranchise.name;
    const leagueName = leagueData.league.name;
    
    // Handle both draftPick (completed draft) and draftUnit (in-progress draft)
    // For draftUnit, the picks are at draftUnit.draftPick
    const draftPicksRaw = draftData.draftResults.draftPick || draftData.draftResults.draftUnit.draftPick;
    if (!draftPicksRaw) return alert("No draft data found");
    
    const draftPicks = Array.isArray(draftPicksRaw)
        ? draftPicksRaw
        : [draftPicksRaw];
    
    const players = Array.isArray(playersData.players.player)
        ? playersData.players.player
        : [playersData.players.player];
    
    const playerMap = {};
    players.forEach(p => {
        playerMap[p.id] = p;
    });
    
    const myPicks = draftPicks
        .filter(p => p.franchise === franchiseId)
        .sort((a, b) => a.pickOverallNumber - b.pickOverallNumber)
        .map((p, index) => {
            const player = playerMap[p.player];
            return {
                pick_no: p.pickOverallNumber,
                metadata: {
                    position: player?.position || "UNK",
                    team: player?.nfl_team || "",
                    first_name: player?.name?.split(/\s+/)[0] || "Unknown",
                    last_name: player?.name?.split(/\s+/).slice(1).join(" ") || ""
                }
            };
        });
    
    if (myPicks.length === 0) return alert("No picks found for this franchise");
    
    draw(myPicks, managerName, leagueName, draftPicks);
}

function draw(picks, managerName, leagueName, allPicks) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const imgTag = document.getElementById('finalImage');

    canvas.width = 1000;
    canvas.height = 650; 

    const sfbLogo = new Image();
    const secondLogo = new Image();
    
    let imagesLoaded = 0;
    function imageLoadedCallback() {
        imagesLoaded++;
        if (imagesLoaded === 2) {
            renderBoard(ctx, picks, managerName, leagueName, sfbLogo, secondLogo, canvas.height, allPicks);
            imgTag.src = canvas.toDataURL("image/png");
            imgTag.style.display = 'block';
            document.getElementById('downloadBtn').style.display = 'block';
        }
    }

    sfbLogo.src = "assets/images/SFB.png";
    sfbLogo.onload = imageLoadedCallback;
    sfbLogo.onerror = () => { sfbLogo.failed = true; imageLoadedCallback(); };

    secondLogo.src = "assets/images/fantasycares.png";
    secondLogo.onload = imageLoadedCallback;
    secondLogo.onerror = () => { secondLogo.failed = true; imageLoadedCallback(); };
}

function getSnakeDraftPosition(pickNo) {
    const LEAGUE_SIZE = 12;
    const round = Math.floor((pickNo - 1) / LEAGUE_SIZE) + 1;
    const slot = (pickNo - 1) % LEAGUE_SIZE + 1;
    
    return `${round}.${String(slot).padStart(2, '0')}`;
}

function getPositionDraftNumber(allPicks, playerPickNo) {
    const targetPick = allPicks.find(p => (p.pick_no || p.pickOverallNumber) === playerPickNo);
    if (!targetPick || !targetPick.metadata) return 1;
    
    const position = targetPick.metadata.position;
    let count = 0;
    
    for (let pick of allPicks) {
        const pickNum = pick.pick_no || pick.pickOverallNumber;
        if (pickNum < playerPickNo && pick.metadata && pick.metadata.position === position) {
            count++;
        }
    }
    
    return count + 1;
}

function renderBoard(ctx, picks, manager, league, sfbLogo, secondLogo, canvasHeight, allPicks) {
    ctx.fillStyle = "#0f172a"; 
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const targetHeight = 70; 
    const targetY = 15;
    let currentX = 25;

    if (sfbLogo && !sfbLogo.failed) {
        const scale = targetHeight / sfbLogo.height;
        const logoWidth = sfbLogo.width * scale;
        ctx.drawImage(sfbLogo, currentX, targetY, logoWidth, targetHeight);
        currentX += logoWidth + 15; 
    }

    if (secondLogo && !secondLogo.failed) {
        const scale = targetHeight / secondLogo.height;
        const secondWidth = secondLogo.width * scale;
        ctx.drawImage(secondLogo, currentX, targetY, secondWidth, targetHeight);
        currentX += secondWidth + 20; 
    }

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(currentX, 20);
    ctx.lineTo(currentX, 80);
    ctx.stroke();
    currentX += 25; 

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "normal 34px sans-serif";
    ctx.fillText(manager, currentX, 48); 
    ctx.font = "normal 16px sans-serif";
    ctx.fillText(league, currentX, 74);

    if (picks && Array.isArray(picks)) {
        picks.forEach((p, i) => {
            if (!p || i >= 20) return; 
            const isRightCol = i >= 10;
            const colX = isRightCol ? 500 : 0;
            const y = 100 + ((i % 10) * 50);
            
            const posRaw = p.metadata.position || "UNK";
            const posDraftNum = getPositionDraftNumber(allPicks, p.pick_no);
            const snakeDraftPos = getSnakeDraftPosition(p.pick_no);
            const teamAbbr = (p.metadata?.team || "").toUpperCase();
            
            let color = "#475569";
            if (posRaw.includes("QB")) color = "#FCDAD7";       
            else if (posRaw.includes("RB")) color = "#D2F4E2";  
            else if (posRaw.includes("WR")) color = "#D2DCFF";  
            else if (posRaw.includes("TE")) color = "#FFF3CD";  
            else if (posRaw.includes("K") || posRaw.includes("DEF")) color = "#E9D5FF";

            ctx.fillStyle = color;
            ctx.fillRect(colX, y, 500, 50);
            ctx.fillStyle = "#0f172a";
            ctx.textAlign = "left";
            ctx.font = "normal 14px sans-serif";
            ctx.fillText(snakeDraftPos, colX + 15, y + 33);
            ctx.font = "bold 15px sans-serif";
            ctx.fillText(posRaw + posDraftNum, colX + 65, y + 33);
            ctx.font = "normal 22px sans-serif"; 
            ctx.fillText(p.metadata.first_name + " " + p.metadata.last_name, colX + 135, y + 33);
            ctx.font = "bold 14px sans-serif";
            ctx.fillText(teamAbbr, colX + 455, y + 33);
        });
    }

    drawFooter(ctx, canvasHeight);
}

function drawFooter(ctx, canvasHeight) {
    const footerHeightPx = 50;
    const footerStartY = canvasHeight - footerHeightPx;
    const footerTextY = footerStartY + 32;
    
    ctx.fillStyle = "#0a0f1a"; 
    ctx.fillRect(0, footerStartY, 1000, footerHeightPx);
    
    const mainText = "SFB16 Roster powered by ";
    const brandText = "FantasyNow";
    const plusText = "+";
    
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "left";
    
    const widthMain = ctx.measureText(mainText).width;
    const widthBrand = ctx.measureText(brandText).width;
    const widthPlus = ctx.measureText(plusText).width;
    const totalWidth = widthMain + widthBrand + widthPlus;
    
    let currentX = (1000 - totalWidth) / 2;
    
    ctx.fillStyle = "#94a3b8"; 
    ctx.fillText(mainText, currentX, footerTextY);
    currentX += widthMain;
    
    ctx.fillStyle = "#FFFFFF"; 
    ctx.fillText(brandText, currentX, footerTextY);
    currentX += widthBrand;
    
    ctx.fillStyle = "#FFA515"; 
    ctx.fillText(plusText, currentX, footerTextY);
}

function downloadImg() {
    const link = document.createElement('a');
    link.download = 'DraftRecap.png';
    link.href = document.getElementById('finalImage').src;
    link.click();
}
