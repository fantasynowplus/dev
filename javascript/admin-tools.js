let TOOLS=[], TOOL_SHOWS=[], TOOL_DRAFTS=[];
const TOOL_EDITING=new Set();
const TOOL_SELECT='show_tools?select=*,show_links:show_tool_shows(show:shows(id,name))&order=sort_order.asc,name.asc';

if(!window._msWired){window._msWired=true;
  document.addEventListener('mousedown',e=>{ if(!e.target.closest('.ms')) document.querySelectorAll('.ms-panel').forEach(p=>p.style.display='none'); });}

function msField(key,selected){
  const sel=new Set(selected||[]);
  const names=TOOL_SHOWS.filter(s=>sel.has(s.id)).map(s=>s.name);
  return '<div class="ms" data-ms="'+key+'">'+
    '<button type="button" class="ms-btn" onclick="msToggle(this)"><span class="ms-label">'+esc(names.length?names.join(', '):'Select show(s)…')+'</span><span class="ms-caret">&#9662;</span></button>'+
    '<div class="ms-panel">'+(TOOL_SHOWS.length?TOOL_SHOWS.map(s=>'<label class="ms-opt"><input type="checkbox" value="'+s.id+'"'+(sel.has(s.id)?' checked':'')+' onchange="msSync(this)"><span>'+esc(s.name)+'</span></label>').join(''):'<div class="ms-empty">No shows yet — add one in the Shows section.</div>')+'</div></div>';
}
function msToggle(btn){
  const panel=btn.parentElement.querySelector('.ms-panel');
  const wasOpen=panel.style.display==='block';
  document.querySelectorAll('.ms-panel').forEach(p=>p.style.display='none');
  panel.style.display=wasOpen?'none':'block';
}
function msSync(cb){
  const ms=cb.closest('.ms');
  const names=[...ms.querySelectorAll('input:checked')].map(i=>{const s=TOOL_SHOWS.find(x=>x.id===i.value);return s?s.name:'';}).filter(Boolean);
  ms.querySelector('.ms-label').textContent=names.length?names.join(', '):'Select show(s)…';
}
function msValues(row){ return [...row.querySelectorAll('.ms input:checked')].map(i=>i.value); }

async function loadTools(){
  topAction(ifCan('tools','c','<button class="btn btn-primary" onclick="toolAddRow()">+ Add tool</button>'));
  TOOL_SHOWS = await dbGet('shows?select=id,name&order=name.asc')||[];
  TOOLS = await dbGet(TOOL_SELECT)||[];
  TOOL_DRAFTS=[]; TOOL_EDITING.clear();
  renderTools();
}
function renderTools(){
  const c=document.getElementById('content');
  if(!TOOLS.length && !TOOL_DRAFTS.length){
    c.innerHTML='<div class="empty"><h4>No tools yet</h4><p>Add links to pages like the weekly rankings or waiver wire, and tag which show each one belongs to.</p>'+ifCan('tools','c','<button class="btn btn-primary" onclick="toolAddRow()">+ Add tool</button>')+'</div>';
    return;
  }
  c.innerHTML='<div class="panel tool-panel"><div class="panel-head"><h3>Tools &amp; links</h3><span class="count-pill" style="margin-left:auto">'+TOOLS.length+' link'+(TOOLS.length===1?'':'s')+'</span></div>'+
    '<div class="tool-list">'+
      TOOLS.map((t,i)=>TOOL_EDITING.has(t.id)?toolEditRow(t,false):toolViewRow(t,i)).join('')+
      TOOL_DRAFTS.map(d=>toolEditRow(d,true)).join('')+
    '</div>'+
    (can('tools','c')?'<div style="padding:12px 18px;border-top:1px solid var(--line)"><button class="btn btn-ghost btn-sm" onclick="toolAddRow()">+ Add tool</button></div>':'')+
  '</div>';
}
function toolViewRow(t,i){
  const shows=(t.show_links||[]).map(l=>l.show).filter(Boolean);
  return '<div class="tool-row" data-id="'+t.id+'">'+
    '<div class="tr-main">'+
      '<div class="tr-name">'+esc(t.name)+(t.is_active===false?' '+badge('Hidden','var(--muted)'):'')+'</div>'+
      '<a class="tr-url" href="'+esc(t.url)+'" target="_blank" rel="noopener">'+esc(t.url)+'</a>'+
      (t.description?'<div class="tr-desc">'+esc(t.description)+'</div>':'')+
      '<div class="tr-chips">'+(shows.length?shows.map(s=>'<span class="chip chip-link" onclick=\'viewShow("'+s.id+'")\'>'+esc(s.name)+'</span>').join(''):'<span style="font-size:12.5px;color:var(--muted)">No show assigned</span>')+'</div>'+
    '</div>'+
    '<div class="tr-acts">'+
      ((/start-sit/i.test(t.url||'') && can('startsit','r'))?'<button class="btn btn-primary btn-sm" onclick="go(\'startsit\')">Manage</button>':'')+
      '<a class="btn btn-navy btn-sm" href="'+esc(t.url)+'" target="_blank" rel="noopener">Open</a>'+
      ifCan('tools','u','<button class="btn btn-ghost btn-sm" title="Move up"'+(i===0?' disabled':'')+' onclick=\'toolMove("'+t.id+'",-1)\'>&uarr;</button><button class="btn btn-ghost btn-sm" title="Move down"'+(i===TOOLS.length-1?' disabled':'')+' onclick=\'toolMove("'+t.id+'",1)\'>&darr;</button>')+
      ifCan('tools','u','<button class="btn btn-ghost btn-sm" onclick=\'toolEdit("'+t.id+'")\'>Edit</button>')+
      ifCan('tools','d','<button class="btn btn-danger btn-sm" onclick=\'toolDelete("'+t.id+'")\'>Delete</button>')+
    '</div></div>';
}
function toolEditRow(t,isDraft){
  const key=isDraft?t.key:t.id;
  const sel=isDraft?(t.shows||[]):(t.show_links||[]).map(l=>l.show&&l.show.id).filter(Boolean);
  return '<div class="tool-row editing" '+(isDraft?'data-draft="'+key+'"':'data-id="'+key+'"')+'>'+
    '<div class="tr-fields">'+
      '<input class="tr-in" data-f="name" placeholder="Name — e.g. Weekly Rankings" value="'+esc(t.name||'')+'">'+
      '<input class="tr-in" data-f="url" placeholder="https://fantasynowplus.com/weekly-rankings.html" value="'+esc(t.url||'')+'">'+
      '<input class="tr-in" data-f="description" placeholder="What this link is for" value="'+esc(t.description||'')+'">'+
      msField(key,sel)+
      '<label class="tr-active"><input type="checkbox" data-f="is_active"'+((isDraft||t.is_active!==false)?' checked':'')+'> Active</label>'+
    '</div>'+
    '<div class="tr-acts">'+
      '<button class="btn btn-primary btn-sm" onclick=\''+(isDraft?'toolSaveDraft("'+key+'")':'toolSave("'+key+'")')+'\'>Save</button>'+
      '<button class="btn btn-ghost btn-sm" onclick=\''+(isDraft?'toolCancelDraft("'+key+'")':'toolCancel("'+key+'")')+'\'>Cancel</button>'+
    '</div></div>';
}
function toolCaptureDrafts(){
  TOOL_DRAFTS.forEach(d=>{
    const row=document.querySelector('.tool-row[data-draft="'+d.key+'"]'); if(!row)return;
    d.name=row.querySelector('[data-f="name"]').value;
    d.url=row.querySelector('[data-f="url"]').value;
    d.description=row.querySelector('[data-f="description"]').value;
    d.shows=msValues(row);
  });
}
function toolAddRow(){
  toolCaptureDrafts();
  TOOL_DRAFTS.push({key:'d'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:'',url:'',description:'',shows:[]});
  renderTools();
  setTimeout(()=>{const f=document.querySelectorAll('.tool-row[data-draft] [data-f="name"]');if(f.length)f[f.length-1].focus();},0);
}
function toolEdit(id){ toolCaptureDrafts(); TOOL_EDITING.add(id); renderTools(); }
function toolCancel(id){ toolCaptureDrafts(); TOOL_EDITING.delete(id); renderTools(); }
function toolCancelDraft(key){ toolCaptureDrafts(); TOOL_DRAFTS=TOOL_DRAFTS.filter(d=>d.key!==key); renderTools(); }
function toolRead(row){
  const g=f=>row.querySelector('[data-f="'+f+'"]').value.trim();
  return {name:g('name'),url:g('url'),description:g('description')||null,
    is_active:row.querySelector('[data-f="is_active"]').checked, shows:msValues(row)};
}
async function toolSave(id){
  const row=document.querySelector('.tool-row[data-id="'+id+'"]'); if(!row)return;
  const d=toolRead(row);
  if(!d.name||!d.url){ toast('Name and link are both required',true); return; }
  try{
    await dbPatch('show_tools?id=eq.'+id,{name:d.name,url:d.url,description:d.description,is_active:d.is_active});
    await dbDel('show_tool_shows?tool_id=eq.'+id);
    if(d.shows.length) await dbPost('show_tool_shows', d.shows.map(s=>({tool_id:id,show_id:s})));
    toolCaptureDrafts(); TOOL_EDITING.delete(id);
    TOOLS = await dbGet(TOOL_SELECT)||[];
    renderTools(); toast('Tool saved');
  }catch(e){ toast(e.message,true); }
}
async function toolSaveDraft(key){
  const row=document.querySelector('.tool-row[data-draft="'+key+'"]'); if(!row)return;
  const d=toolRead(row);
  if(!d.name||!d.url){ toast('Name and link are both required',true); return; }
  try{
    const r=await dbPost('show_tools',{name:d.name,url:d.url,description:d.description,is_active:d.is_active,sort_order:TOOLS.length});
    const newId=r[0].id;
    if(d.shows.length) await dbPost('show_tool_shows', d.shows.map(s=>({tool_id:newId,show_id:s})));
    toolCaptureDrafts(); TOOL_DRAFTS=TOOL_DRAFTS.filter(x=>x.key!==key);
    TOOLS = await dbGet(TOOL_SELECT)||[];
    renderTools(); toast('Tool added');
  }catch(e){ toast(e.message,true); }
}
async function toolMove(id,dir){
  const i=TOOLS.findIndex(t=>t.id===id), j=i+dir;
  if(i<0||j<0||j>=TOOLS.length)return;
  const order=TOOLS.slice(); const [m]=order.splice(i,1); order.splice(j,0,m);
  try{
    await Promise.all(order.map((t,k)=>dbPatch('show_tools?id=eq.'+t.id,{sort_order:k})));
    TOOLS = await dbGet(TOOL_SELECT)||[]; renderTools();
  }catch(e){ toast('Could not reorder',true); }
}
function toolDelete(id){
  const t=TOOLS.find(x=>x.id===id);
  confirmDelete(esc(t.name),async()=>{
    await dbDel('show_tools?id=eq.'+id);
    TOOLS=TOOLS.filter(x=>x.id!==id); renderTools(); toast('Tool removed');
  });
}