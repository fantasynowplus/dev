const MFL_YEAR = '2026';

async function generateGraphic() {
    const username = document.getElementById('username').value;
    const loader = document.getElementById('loader');

    if (!username) return alert("Enter your Sleeper username");

    loader.style.display = 'block';
    loader.innerText = "Syncing draft data...";

    try {
        await handleSleeper(username);
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
    const myPicks = allPicks.filter(p => p.picked_by === user.user_id);
    
    if (myPicks.length === 0) return alert("No picks found for this user");
    
    draw(myPicks, user.display_name, sfbLeague.name);
}

function draw(picks, managerName, leagueName) {
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
            renderBoard(ctx, picks, managerName, leagueName, sfbLogo, secondLogo, canvas.height);
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

function renderBoard(ctx, picks, manager, league, sfbLogo, secondLogo, canvasHeight) {
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
            ctx.fillText(`${p.round}.${p.draft_slot}`, colX + 15, y + 33);
            ctx.font = "bold 15px sans-serif";
            ctx.fillText(posRaw, colX + 65, y + 33);
            ctx.font = "normal 22px sans-serif"; 
            ctx.fillText(p.metadata.first_name + " " + p.metadata.last_name, colX + 135, y + 33);
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
