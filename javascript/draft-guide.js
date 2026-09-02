(function(){
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQMNdMCYh6drs1eoU4P54POt2RMOvvbSIQaCYce9U8_cdCwJcSfG4znrJPFYk2RdMZ23Cw7ZrNTpV-V/pub?gid=807977812&single=true&output=csv";


const rosterCfg = {QB:1,RB:2,WR:2,TE:1,FLEX:1,SFLEX:0,DST:1,K:1,BENCH:7};
let flexType = "WRT";
function buildRosterTemplate(){
  const t=[];
  const flexElig=flexType==="WR"?["WR","RB"]:flexType==="WT"?["WR","TE"]:["RB","WR","TE"];
  const add=(n,slot,elig)=>{for(let i=0;i<n;i++)t.push({slot:slot,eligible:elig});};
  add(rosterCfg.QB,"QB",["QB"]);
  add(rosterCfg.RB,"RB",["RB"]);
  add(rosterCfg.WR,"WR",["WR"]);
  add(rosterCfg.TE,"TE",["TE"]);
  add(rosterCfg.FLEX,"FLEX",flexElig);
  add(rosterCfg.SFLEX,"SFLEX",["QB","RB","WR","TE"]);
  add(rosterCfg.DST,"DST",["DST"]);
  add(rosterCfg.K,"K",["K"]);
  return t;
}
let ROSTER_TEMPLATE = buildRosterTemplate();
const DEFAULT_ROUNDS = ROSTER_TEMPLATE.length + rosterCfg.BENCH;
const SLEEPER = "https://api.sleeper.app/v1";
const teamAlias = {JAX:"JAC"};

let players=[], byId={}, nameIndex={}, dstByTeam={};

function newDraft(){return {history:[],drafted:new Set(),pick:1};}
const drafts = {assist:newDraft(), mock:newDraft()};
const state = {mode:"assist",size:12,slot:6,type:"snake",rounds:DEFAULT_ROUNDS,filter:"ALL",query:"",boardOpen:false,sleeper:{userId:null,draftId:null}};
function D(){return drafts[state.mode];}
const totalPicks=()=>state.rounds*state.size;

const $=id=>document.getElementById(id);
const usernameInput=$("slpUser"), leagueSel=$("slpLeague"), syncStatus=$("slpStatus");
const sizeSel=$("setSize"), slotSel=$("setSlot"), typeSel=$("setType");
const boardView=$("boardView"), boardToggle=$("boardToggle"), planBtn=$("planBtn");

function parseCSV(text){
  const rows=[];let row=[];let field="";let q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=c; }
    else{
      if(c==='"')q=true;
      else if(c===','){row.push(field);field="";}
      else if(c==='\n'){row.push(field);rows.push(row);row=[];field="";}
      else if(c==='\r'){}
      else field+=c;
    }
  }
  if(field.length||row.length){row.push(field);rows.push(row);}
  return rows;
}
function normPos(p){p=(p||"").trim().toUpperCase();if(p==="DEF"||p==="D/ST")return"DST";if(p==="PK")return"K";return p;}
function byeNum(v){const m=String(v||"").match(/\d+/);return m?parseInt(m[0],10):null;}
function normName(s){return String(s||"").toLowerCase().replace(/[.'’]/g,"").replace(/\b(jr|sr|ii|iii|iv|v)\b/g,"").replace(/[^a-z]/g,"");}
function escapeHtml(s){return String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function lastName(n){const p=String(n||"").split(" ");return p.length>1?p.slice(1).join(" "):n;}

function buildPlayers(rows){
  if(!rows.length)return[];
  let start=0;const first=(rows[0][1]||"").trim().toLowerCase();
  if(isNaN(parseInt(first,10)))start=1;
  const out=[];
  for(let i=start;i<rows.length;i++){
    const r=rows[i];if(!r||r.length<5)continue;
    const rank=parseInt((r[1]||"").trim(),10);const name=(r[2]||"").trim();
    if(!name||isNaN(rank))continue;
    out.push({id:"p"+i,posRank:parseInt((r[0]||"").trim(),10)||null,rank:rank,name:name,team:(r[3]||"").trim().toUpperCase(),pos:normPos(r[4]),bye:byeNum(r[6])});
  }
  out.sort((a,b)=>a.rank-b.rank);
  return out;
}
function buildIndexes(){
  byId={};nameIndex={};dstByTeam={};
  players.forEach(p=>{
    byId[p.id]=p;
    if(p.pos==="DST"){if(p.team)dstByTeam[p.team]=p;}
    else{const k=normName(p.name);if(!(k in nameIndex))nameIndex[k]=p;}
  });
}

function isReverse(round,type){
  if(type==="linear")return false;
  if(type==="3rr"){if(round===1)return false;if(round===2)return true;return round%2===1;}
  return round%2===0;
}
function pickNumber(round,slot,size,type){return isReverse(round,type)?(round-1)*size+(size-slot+1):(round-1)*size+slot;}
function myPickSet(){const s=new Set();for(let r=1;r<=state.rounds;r++)s.add(pickNumber(r,state.slot,state.size,state.type));return s;}
function isMyPick(p){return myPickSet().has(p);}
function nextMyPick(from){for(let p=from;p<=totalPicks();p++)if(isMyPick(p))return p;return null;}
function roundOf(p){return Math.floor((p-1)/state.size)+1;}
function availableSorted(pos,d){d=d||D();return players.filter(p=>!d.drafted.has(p.id)&&(pos==="ALL"||p.pos===pos));}

function draftAtCurrent(p,pid){
  const d=D();
  d.history.push({p:p,pid:pid||null,pick:d.pick,mine:isMyPick(d.pick)});
  if(pid)d.drafted.add(pid);
  d.pick++;
  if(state.mode==="mock")runBots();
  renderAll();
}
function runBots(){
  const d=D();let guard=0;
  while(!isMyPick(d.pick)&&d.pick<=totalPicks()&&guard<800){
    guard++;
    const pool=availableSorted("ALL",d);if(!pool.length)break;
    const topN=Math.min(3,pool.length);const roll=Math.random();
    const idx=roll<0.72?0:(roll<0.92?Math.min(1,topN-1):Math.min(2,topN-1));
    const pk=pool[idx];
    d.history.push({p:pk,pid:pk.id,pick:d.pick,mine:false});
    d.drafted.add(pk.id);d.pick++;
  }
}
function undo(){
  const d=D();const last=d.history.pop();if(!last)return;
  if(last.pid)d.drafted.delete(last.pid);
  if(state.mode==="mock"){
    while(d.history.length){const prev=d.history[d.history.length-1];if(prev.mine)break;const pop=d.history.pop();if(pop.pid)d.drafted.delete(pop.pid);}
  }
  d.pick=d.history.length?d.history[d.history.length-1].pick+1:1;
  renderAll();
}
function reset(){const d=D();d.history=[];d.drafted=new Set();d.pick=1;if(state.mode==="mock")runBots();renderAll();}
function resetAll(){drafts.assist=newDraft();drafts.mock=newDraft();if(state.mode==="mock")runBots();renderAll();}
function myPicks(){return D().history.filter(h=>h.mine).map(h=>({...h.p,takenAt:h.pick}));}

function fillRoster(){
  const starters=ROSTER_TEMPLATE.map(t=>({...t,player:null}));const bench=[];
  for(const pl of myPicks()){
    let placed=false;
    for(const s of starters){if(!s.player&&s.eligible.includes(pl.pos)){s.player=pl;placed=true;break;}}
    if(!placed)bench.push(pl);
  }
  return {starters,bench};
}
function letterFor(avg){
  if(avg>=12)return["A+","var(--dg-good)"];
  if(avg>=7)return["A","var(--dg-good)"];
  if(avg>=3)return["B+","var(--dg-good)"];
  if(avg>=0)return["B","var(--dg-accent)"];
  if(avg>=-3)return["B-","var(--dg-accent)"];
  if(avg>=-8)return["C","var(--dg-bad)"];
  return["D","var(--dg-bad)"];
}

function renderClock(){
  const d=D();
  $("clockPick").textContent=`Pick ${d.pick} · Round ${roundOf(d.pick)}`;
  const who=$("clockWho");
  if(d.pick>totalPicks()){who.textContent="Draft complete";who.className="dg-who dg-other";}
  else if(isMyPick(d.pick)){who.textContent="Your pick";who.className="dg-who dg-mine";}
  else{who.textContent="Other team";who.className="dg-who dg-other";}
  const chips=$("chips");chips.innerHTML="";
  for(let r=1;r<=state.rounds;r++){
    const pn=pickNumber(r,state.slot,state.size,state.type);
    const el=document.createElement("div");
    el.className="dg-chip"+(pn<d.pick?" dg-done":"")+(pn===nextMyPick(d.pick)?" dg-current":"");
    el.innerHTML=`<div class="r">R${r}</div><div class="p">${pn}</div>`;
    chips.appendChild(el);
  }
}
function rankLabel(p){
  if(state.filter!=="ALL"&&p.posRank)return `<span class="dg-rk">${p.posRank}</span>`;
  const sub=(p.posRank&&p.pos)?` <span class="dg-sub">(${p.pos}${p.posRank})</span>`:"";
  return `<span class="dg-rk">${p.rank}${sub}</span>`;
}
function renderList(){
  const d=D();const list=$("list");const q=state.query.trim().toLowerCase();
  let pool=availableSorted(state.filter,d);
  if(q)pool=pool.filter(p=>p.name.toLowerCase().includes(q)||p.team.toLowerCase().includes(q));
  if(!pool.length){list.innerHTML='<div class="dg-empty">No players match.</div>';return;}
  const nextPick=nextMyPick(d.pick);const gap=nextPick?nextPick-d.pick:0;
  const liveIds=new Set(availableSorted("ALL",d).slice(0,gap).map(p=>p.id));
  list.innerHTML=pool.map(p=>{
    const live=liveIds.has(p.id)?" dg-live":"";const fa=p.team==="FA"?" dg-fa":"";
    const bye=p.bye?`Bye ${p.bye}`:"";
    return `<div class="dg-row${live}${fa}" data-id="${p.id}">
      ${rankLabel(p)}
      <div class="dg-nm">${p.name}</div>
      <span class="dg-pos ${p.pos.toLowerCase()}">${p.pos}</span>
      <div style="text-align:right"><span class="dg-pos dg-tm">${p.team}</span><div class="dg-bye">${bye}</div></div>
    </div>`;
  }).join("");
}
function availRow(p,i){
  return `<li data-id="${p.id}">
    <span class="dg-n">${i+1}</span>
    <span class="dg-pos ${p.pos.toLowerCase()}">${p.pos}</span>
    <span>${p.name} <span class="dg-lt">${p.team}</span></span>
    <span class="dg-ark">${p.rank}</span>
  </li>`;
}
function renderAvail(){
  const d=D();const pool=availableSorted("ALL",d);
  $("availCount").textContent=`${pool.length} left`;
  $("availNow").innerHTML=pool.slice(0,7).map((p,i)=>availRow(p,i)).join("")||'<li class="dg-lt">—</li>';
  const nextPick=nextMyPick(d.pick+1);const nextEl=$("availNext");const hint=$("pickHint");
  if(!nextPick){nextEl.innerHTML='<li class="dg-lt">No more picks for you.</li>';return;}
  const consumed=nextPick-d.pick;const others=isMyPick(d.pick)?consumed-1:consumed;
  nextEl.innerHTML=pool.slice(consumed,consumed+7).map((p,i)=>availRow(p,i)).join("")||'<li class="dg-lt">—</li>';
  hint.innerHTML=`About <b>${others}</b> players typically come off before pick <b>${nextPick}</b>. Anyone above is likely still there based on our redraft rankings.`;
}
function renderRoster(){
  const {starters,bench}=fillRoster();const byeCounts={};
  starters.forEach(s=>{if(s.player&&s.player.bye)byeCounts[s.player.bye]=(byeCounts[s.player.bye]||0)+1;});
  $("starters").innerHTML=starters.map(s=>{
    const p=s.player;const clash=p&&p.bye&&byeCounts[p.bye]>1?" dg-clash":"";
    if(!p)return `<div class="dg-rrow"><span class="dg-slot">${s.slot}</span><span class="dg-pn dg-none">Empty</span><span class="dg-rrk">—</span></div>`;
    const rk=(typeof p.rank==="number")?p.rank:"—";const bye=p.bye?" · B"+p.bye:"";
    return `<div class="dg-rrow${clash}"><span class="dg-slot">${s.slot}</span><span class="dg-pn">${p.name} <small>${p.team}</small></span><span class="dg-rrk">${rk}${bye}</span></div>`;
  }).join("");
  let benchHtml="";
  for(let i=0;i<rosterCfg.BENCH;i++){
    const p=bench[i];
    if(p){const rk=(typeof p.rank==="number")?p.rank:"—";benchHtml+=`<div class="dg-rrow"><span class="dg-slot">BE</span><span class="dg-pn">${p.name} <small>${p.team}</small></span><span class="dg-rrk">${rk}</span></div>`;}
    else benchHtml+=`<div class="dg-rrow"><span class="dg-slot">BE</span><span class="dg-pn dg-none">Empty</span><span class="dg-rrk">—</span></div>`;
  }
  for(let i=rosterCfg.BENCH;i<bench.length;i++){
    const p=bench[i];const rk=(typeof p.rank==="number")?p.rank:"—";
    benchHtml+=`<div class="dg-rrow"><span class="dg-slot">BE+</span><span class="dg-pn">${p.name} <small>${p.team}</small></span><span class="dg-rrk">${rk}</span></div>`;
  }
  $("bench").innerHTML=benchHtml;
  $("rosterCount").textContent=`${myPicks().length} of ${state.rounds} filled`;
}
function renderGrade(){
  const picks=myPicks();const scored=picks.filter(p=>typeof p.rank==="number");
  const big=$("gradeBig"),cap=$("gradeCap"),meter=$("gradeMeter"),valLine=$("valLine");
  if(!scored.length){big.textContent="—";big.style.color="var(--dg-ink)";cap.textContent="Make a pick to begin";meter.style.width="50%";return;}
  let total=0;scored.forEach(p=>{total+=(p.takenAt-p.rank);});
  const avg=total/scored.length;const [letter,color]=letterFor(avg);
  big.textContent=letter;big.style.color=color;
  cap.textContent=avg>=0?`+${avg.toFixed(1)} avg value`:`${avg.toFixed(1)} avg reach`;
  meter.style.width=Math.max(4,Math.min(96,50+avg*3.2))+"%";
  valLine.innerHTML=`Across <b>${scored.length}</b> pick${scored.length>1?"s":""}, you're averaging <b>${avg>=0?"+":""}${avg.toFixed(1)}</b> slots ${avg>=0?"of value":"of reach"} versus overall rank.`;
}
function renderBoard(){
  if(!state.boardOpen)return;
  const d=D();const map={};d.history.forEach(h=>{map[h.pick]=h;});
  let cells='<div class="dg-th"></div>';
  for(let sl=1;sl<=state.size;sl++)cells+=`<div class="dg-th${sl===state.slot?' mine':''}">${sl}</div>`;
  for(let r=1;r<=state.rounds;r++){
    cells+=`<div class="dg-rl">R${r}</div>`;
    for(let sl=1;sl<=state.size;sl++){
      const pn=pickNumber(r,sl,state.size,state.type);const h=map[pn];
      const cur=pn===d.pick?" cur":"";const mine=sl===state.slot?" mine":"";
      if(h){
        const p=h.p;const pos=(p.pos||"").toLowerCase();
        const parts=String(p.name||"").trim().split(" ");
        const first=parts.length>1?parts[0]:"";
        const last=parts.length>1?parts.slice(1).join(" "):p.name;
        const meta=`#${pn}`+(p.team?" · "+p.team:"")+(p.bye?" · B"+p.bye:"");
        cells+=`<div class="dg-tile ${pos}${cur}${mine}"><div class="dg-tile-top"><span class="dg-tile-meta">${escapeHtml(meta)}</span><span class="dg-tile-pos">${p.pos||""}</span></div><div class="dg-tile-nm"><span class="dg-fn">${escapeHtml(first)}</span><span class="dg-ln">${escapeHtml(last)}</span></div></div>`;
      }else{
        cells+=`<div class="dg-tile empty${cur}${mine}"><span class="dg-tile-meta">#${pn}</span></div>`;
      }
    }
  }
  boardView.innerHTML=`<div class="dg-board-scroll"><div class="dg-board-grid" style="grid-template-columns:1.9rem repeat(${state.size},minmax(0,1fr))">${cells}</div></div>`;
}
function renderAll(){renderClock();renderList();renderAvail();renderRoster();renderGrade();renderBoard();}

function setModeButtons(){
  document.querySelectorAll("#modes button").forEach(x=>x.classList.toggle("dg-active",x.dataset.mode===state.mode));
  planBtn.hidden=state.mode!=="assist";
}
function toggleBoard(){state.boardOpen=!state.boardOpen;boardView.hidden=!state.boardOpen;boardToggle.classList.toggle("dg-active",state.boardOpen);renderBoard();}
function planAhead(){
  const src=drafts.assist;
  drafts.mock={history:src.history.map(h=>({...h})),drafted:new Set(src.drafted),pick:src.pick};
  state.mode="mock";setModeButtons();runBots();renderAll();
}

function setSync(t,warn){syncStatus.textContent=t;syncStatus.classList.toggle("dg-warn",!!warn);}
async function currentSeason(){
  try{const s=await(await fetch(`${SLEEPER}/state/nfl`)).json();return s.league_season||s.season||String(new Date().getFullYear());}
  catch(e){return String(new Date().getFullYear());}
}
async function sleeperConnect(){
  const u=usernameInput.value.trim();if(!u){setSync("Enter a username.",true);return;}
  setSync("Connecting…");
  try{
    const ur=await fetch(`${SLEEPER}/user/${encodeURIComponent(u)}`);
    if(!ur.ok)throw 0;const user=await ur.json();if(!user||!user.user_id)throw 0;
    state.sleeper.userId=user.user_id;
    const season=await currentSeason();
    const leagues=await(await fetch(`${SLEEPER}/user/${user.user_id}/leagues/nfl/${season}`)).json();
    const redraft=(leagues||[]).filter(l=>l.draft_id&&l.settings&&l.settings.type!==2);
        if(!redraft.length){setSync(`No redraft leagues found for ${season}.`,true);leagueSel.hidden=true;return;}
        leagueSel.innerHTML='<option value="">Select league…</option>'+redraft.map(l=>`<option value="${l.draft_id}">${escapeHtml(l.name)}</option>`).join("");
        leagueSel.hidden=false;
        setSync(`${redraft.length} redraft league(s) found — pick one.`);
  }catch(e){setSync("Could not reach Sleeper. Check the username.",true);}
}
function applyDraftSettings(draft){
  const s=draft.settings||{};
  state.size=s.teams||state.size;
  state.rounds=s.rounds||state.rounds;
  let type="snake";
  if(draft.type==="linear")type="linear";
  else if((s.reversal_round||0)===3)type="3rr";
  state.type=type;
  const mySlot=(draft.draft_order||{})[state.sleeper.userId];
  if(mySlot)state.slot=mySlot;
  drafts.mock=newDraft();
  sizeSel.value=String(state.size);typeSel.value=type;buildSlotOptions();slotSel.value=String(state.slot);
}
async function sleeperLoadLeague(){
  const draftId=leagueSel.value;if(!draftId)return;
  setSync("Loading draft…");
  try{
    const draft=await(await fetch(`${SLEEPER}/draft/${draftId}`)).json();
    state.sleeper.draftId=draftId;applyDraftSettings(draft);await sleeperRefresh();
  }catch(e){setSync("Could not load that draft.",true);}
}
function loadSleeperPicks(picks){
  const d=drafts.assist;d.history=[];d.drafted=new Set();
  picks.sort((a,b)=>a.pick_no-b.pick_no);
  for(const pk of picks){
    const md=pk.metadata||{};const posRaw=(md.position||"").toUpperCase();let mp=null;
    if(posRaw==="DEF"||posRaw==="DST"){let t=(pk.player_id||md.team||"").toUpperCase();t=teamAlias[t]||t;mp=dstByTeam[t]||null;}
    else{mp=nameIndex[normName(((md.first_name||"")+" "+(md.last_name||"")).trim())]||null;}
    const p=mp||{name:((md.first_name||"")+" "+(md.last_name||"")).trim()||"Unknown",team:(md.team||"").toUpperCase(),pos:normPos(md.position||""),rank:null,bye:null};
    d.history.push({p:p,pid:mp?mp.id:null,pick:pk.pick_no,mine:pk.draft_slot===state.slot});
    if(mp)d.drafted.add(mp.id);
  }
  d.pick=picks.length+1;
}
async function sleeperRefresh(){
  if(!state.sleeper.draftId){setSync("Connect a league first.",true);return;}
  setSync("Syncing picks…");
  try{
    const picks=await(await fetch(`${SLEEPER}/draft/${state.sleeper.draftId}/picks`)).json();
    loadSleeperPicks(picks||[]);state.mode="assist";setModeButtons();
    setSync(`Synced ${(picks||[]).length} pick(s) · ${new Date().toLocaleTimeString()}`);
    renderAll();
  }catch(e){setSync("Sync failed. Try Refresh again.",true);}
}

$("list").addEventListener("click",e=>{const row=e.target.closest(".dg-row");if(!row)return;if(D().pick>totalPicks())return;draftAtCurrent(byId[row.dataset.id],row.dataset.id);});
document.querySelectorAll(".dg-avail").forEach(ul=>ul.addEventListener("click",e=>{const li=e.target.closest("li");if(!li||!li.dataset.id)return;if(D().pick>totalPicks())return;draftAtCurrent(byId[li.dataset.id],li.dataset.id);}));
$("pills").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;document.querySelectorAll("#pills button").forEach(x=>x.classList.remove("dg-active"));b.classList.add("dg-active");state.filter=b.dataset.pos;renderList();});
$("search").addEventListener("input",e=>{state.query=e.target.value;renderList();});
$("modes").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;state.mode=b.dataset.mode;setModeButtons();if(state.mode==="mock"&&drafts.mock.history.length===0)runBots();renderAll();});
sizeSel.addEventListener("change",e=>{state.size=parseInt(e.target.value,10);buildSlotOptions();resetAll();});
slotSel.addEventListener("change",e=>{state.slot=parseInt(e.target.value,10);resetAll();});
typeSel.addEventListener("change",e=>{state.type=e.target.value;resetAll();});
$("undoBtn").addEventListener("click",undo);
$("resetBtn").addEventListener("click",reset);
$("slpConnect").addEventListener("click",sleeperConnect);
leagueSel.addEventListener("change",sleeperLoadLeague);
$("slpRefresh").addEventListener("click",sleeperRefresh);
boardToggle.addEventListener("click",toggleBoard);
planBtn.addEventListener("click",planAhead);

function buildSlotOptions(){
  const cur=state.slot;slotSel.innerHTML="";
  for(let i=1;i<=state.size;i++){const o=document.createElement("option");o.value=i;o.textContent=i;slotSel.appendChild(o);}
  state.slot=cur<=state.size?cur:1;slotSel.value=state.slot;
}
function finishLoad(text,isLive){
  players=buildPlayers(parseCSV(text));buildIndexes();
  const note=$("dataNote");
  if(isLive){note.textContent=`${players.length} players · FantasyNow+ Redraft Rankings`;note.classList.remove("dg-warn");}
  else{note.textContent="Sample data · sheet fetch failed";note.classList.add("dg-warn");}
  renderAll();
}
function cfgInt(id){const v=parseInt($(id).value,10);return isNaN(v)||v<0?0:v;}
function applyRoster(){
  rosterCfg.QB=cfgInt("cfgQB");rosterCfg.RB=cfgInt("cfgRB");rosterCfg.WR=cfgInt("cfgWR");rosterCfg.TE=cfgInt("cfgTE");
  rosterCfg.FLEX=cfgInt("cfgFLEX");rosterCfg.SFLEX=cfgInt("cfgSFLEX");rosterCfg.DST=cfgInt("cfgDST");rosterCfg.K=cfgInt("cfgK");rosterCfg.BENCH=cfgInt("cfgBENCH");
  flexType=$("cfgFlexType").value;
  ROSTER_TEMPLATE=buildRosterTemplate();
  state.rounds=ROSTER_TEMPLATE.length+rosterCfg.BENCH;
  resetAll();
}
["cfgQB","cfgRB","cfgWR","cfgTE","cfgFLEX","cfgFlexType","cfgSFLEX","cfgDST","cfgK","cfgBENCH"].forEach(id=>$(id).addEventListener("change",applyRoster));
(function(){
  const m=$("rosterModal");
  const open=()=>{m.hidden=false;};
  const close=()=>{m.hidden=true;};
  $("rosterGearBtn").addEventListener("click",open);
  $("rosterCloseBtn").addEventListener("click",close);
  m.addEventListener("click",e=>{if(e.target.dataset.close)close();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!m.hidden)close();});
})();
buildSlotOptions();slotSel.value=String(state.slot);setModeButtons();
fetch(CSV_URL).then(r=>{if(!r.ok)throw new Error(r.status);return r.text();}).then(t=>finishLoad(t,true)).catch(()=>finishLoad(SAMPLE,false));
})();

