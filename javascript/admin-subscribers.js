let SUBS=[];
async function loadSubscribers(){
  topAction('<button class="btn btn-ghost" onclick="exportSubs()">Export CSV</button> '+ifCan('subscribers','c','<button class="btn btn-ghost" onclick="subImport()">Import</button> <button class="btn btn-primary" onclick="subForm()">+ Add subscriber</button>'));
  SUBS = await dbGet('subscribers?select=*&order=subscribed_at.desc')||[];
  renderSubs('');
}
function renderSubs(q){
  const rows=SUBS.filter(s=>!q||[s.name,s.email].some(v=>(v||'').toLowerCase().includes(q)));
  document.getElementById('content').innerHTML =
    toolbar('Search subscribers…','<span class="count-pill" style="margin-left:auto">'+rows.length+' of '+SUBS.length+'</span>')+
    '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Source</th><th>Subscribed</th><th>Status</th><th></th></tr></thead><tbody>'+
    (rows.length? rows.map(s=>
      '<tr><td><strong>'+esc(s.name||'—')+'</strong></td><td>'+esc(s.email)+'</td>'+
      '<td>'+badge(s.source||'manual', s.source==='website'?'var(--aqua)':s.source==='import'?'var(--sky)':'var(--muted)')+'</td>'+
      '<td>'+fmtDate(s.subscribed_at)+'</td>'+
      '<td>'+(s.is_active!==false?badge('Active','var(--green)'):badge('Unsubbed','var(--muted)'))+'</td>'+
      '<td><div class="row-actions">'+ifCan('subscribers','d','<button class="btn btn-danger btn-sm" onclick=\'subDelete("'+s.id+'")\'>Delete</button>')+'</div></td></tr>').join('')
      : '<tr><td colspan="6"><div class="empty"><h4>No subscribers yet</h4><p>Add people manually now. Later, your site\'s subscribe button can feed this list automatically.</p>'+ifCan('subscribers','c','<button class="btn btn-primary" onclick="subForm()">+ Add subscriber</button>')+'</div></td></tr>')+
    '</tbody></table></div></div>';
  bindSearch(renderSubs);
}
function subForm(){
  modal({title:'Add subscriber',saveLabel:'Add subscriber',
    body:'<div class="form-grid"><div class="field"><label>Name</label><input name="name"></div>'+
      '<div class="field"><label>Email</label><input name="email" type="email"></div></div>',
    onSave:async(bg)=>{
      const email=val(bg,'email');if(!email)throw new Error('Email is required');
      await dbPost('subscribers',{name:val(bg,'name'),email,source:'manual'});
      SUBS = await dbGet('subscribers?select=*&order=subscribed_at.desc')||[];renderSubs('');toast('Subscriber added');
    }});
}
function subDelete(id){const s=SUBS.find(x=>x.id===id);confirmDelete(esc(s.email),async()=>{
  await dbDel('subscribers?id=eq.'+id);SUBS=SUBS.filter(x=>x.id!==id);renderSubs('');toast('Subscriber removed');});}
function exportSubs(){
  const rows=[['Name','Email','Source','Subscribed']].concat(SUBS.map(s=>[s.name||'',s.email,s.source||'',s.subscribed_at||'']));
  const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='subscribers.csv';a.click();toast('Exported '+SUBS.length+' subscribers');
}

function parseSubscribers(text){
  const emailRe=/[^\s,;<>()"']+@[^\s,;<>()"']+\.[^\s,;<>()"']+/g;
  const seen=new Set(); const rows=[]; let skipped=0;
  (text||'').split(/\r?\n/).forEach(line=>{
    line=line.trim(); if(!line) return;
    const found=line.match(emailRe); if(!found) return;
    const add=(email,name)=>{ email=email.toLowerCase(); if(seen.has(email)){skipped++;return;} seen.add(email); rows.push({name:(name||'').trim()||null,email,source:'import'}); };
    if(found.length===1){
      const name=line.replace(found[0],'').replace(/[",;<>()]/g,' ').replace(/\s+/g,' ');
      add(found[0],name);
    } else { found.forEach(e=>add(e,'')); }
  });
  return {rows,skipped};
}
function subImport(){
  modal({title:'Import subscribers',wide:true,saveLabel:'Import',
    body:'<p style="margin:0 0 14px;color:var(--muted);font-size:13.5px;line-height:1.55">Upload a CSV or paste a list — one subscriber per line, as <strong>Name, email@example.com</strong> or just the email. Lines without a valid email are ignored, and duplicates are skipped automatically.</p>'+
      '<div class="field full" style="margin-bottom:14px"><label>CSV file</label><input type="file" id="impFile" accept=".csv,text/csv,text/plain"></div>'+
      '<div class="field full"><label>Or paste / review here</label><textarea id="impText" style="min-height:150px;font-family:\'IBM Plex Mono\',monospace;font-size:13px" placeholder="Jane Smith, jane@example.com&#10;john@example.com"></textarea></div>'+
      '<div id="impHint" style="font-size:13px;color:var(--muted);margin-top:10px;font-weight:600"></div>',
    onReady:(bg)=>{
      const ta=bg.querySelector('#impText'), hint=bg.querySelector('#impHint');
      const updateHint=()=>{ const {rows,skipped}=parseSubscribers(ta.value); hint.textContent=rows.length?(rows.length+' valid email'+(rows.length===1?'':'s')+' found'+(skipped?', '+skipped+' duplicate'+(skipped===1?'':'s')+' in list skipped':'')+'.'):''; };
      bg.querySelector('#impFile').onchange=(e)=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ ta.value=r.result; updateHint(); }; r.readAsText(f); };
      ta.oninput=updateHint;
    },
    onSave:async(bg)=>{
      const {rows}=parseSubscribers(bg.querySelector('#impText').value);
      if(!rows.length) throw new Error('No valid emails found to import.');
      const inserted = await api('subscribers?on_conflict=email',{method:'POST',headers:{'Prefer':'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(rows)}) || [];
      const existed = rows.length - inserted.length;
      SUBS = await dbGet('subscribers?select=*&order=subscribed_at.desc')||[];
      renderSubs('');
      toast('Imported '+inserted.length+' new'+(existed>0?' ('+existed+' already existed)':''));
    }});
}
