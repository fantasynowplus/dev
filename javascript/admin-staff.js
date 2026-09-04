let STAFF=[];
async function loadStaff(){
  try{ ORG_TEAMS = await dbGet('teams?select=*&order=name.asc')||[]; }catch(e){}
  topAction('<button class="btn btn-primary" onclick="staffFromProfiles()">+ Add from profiles</button> <button class="btn btn-ghost" onclick="staffForm()">+ Add manually</button>');
  STAFF = await dbGet('staff?select=*&order=name.asc')||[];
  renderStaff('');
  bindSearch(renderStaff);
}
function bindSearch(fn){const i=document.getElementById('searchBox');if(i)i.oninput=()=>fn(i.value.toLowerCase());}
function toolbar(placeholder,rightHTML){
  return '<div class="toolbar"><div class="search">'+
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>'+
    '<input id="searchBox" placeholder="'+placeholder+'"></div>'+(rightHTML||'')+'</div>';
}

const STAFF_COLS = [
  {key:'name', label:'Name', always:true, cell:s=>'<div style="display:flex;align-items:center;gap:9px">'+avatarHtml(s,'mini-avatar',accentFor(s.department))+'<strong>'+esc(s.name)+'</strong>'+(s.profile_id?'<span class="linked-dot" title="Linked to a login profile">\u25CF</span>':'')+'</div>'},
  {key:'role', label:'Role', cell:s=>esc(s.role||'—')},
  {key:'department', label:'Department', cell:s=>s.department?'<span class="chip">'+esc(s.department)+'</span>':'—'},
  {key:'email', label:'Email', cell:s=>esc(s.email||'—')},
  {key:'phone', label:'Phone', cell:s=>esc(s.phone||'—')},
  {key:'dob', label:'Date of birth', cell:s=>fmtDate(s.dob)},
  {key:'start_date', label:'Start', cell:s=>fmtDate(s.start_date)},
  {key:'address', label:'Address', cell:s=>esc(s.address||'—')},
  {key:'account', label:'Account', cell:s=>s.profile_id?badge('Login linked','var(--aqua)'):'<span style="color:var(--muted)">None</span>'},
  {key:'is_active', label:'Status', cell:s=>s.is_active?badge('Active','var(--green)'):badge('Inactive','var(--muted)')},
];
function visibleStaffCols(){
  try{ const v=JSON.parse(localStorage.getItem('fnp-staff-cols')); if(Array.isArray(v)) return v; }catch(e){}
  return ['role','department','email','phone','start_date','is_active'];
}
function saveStaffCols(arr){ try{ localStorage.setItem('fnp-staff-cols', JSON.stringify(arr)); }catch(e){} }
function staffColumnsMenu(ev){
  document.querySelectorAll('.col-menu').forEach(m=>m.remove());
  const vis=visibleStaffCols();
  const menu=document.createElement('div'); menu.className='col-menu';
  menu.innerHTML='<div class="col-menu-h">Show columns</div>'+
    STAFF_COLS.filter(c=>!c.always).map(c=>'<label class="col-menu-item"><input type="checkbox" data-col="'+c.key+'"'+(vis.includes(c.key)?' checked':'')+'><span>'+esc(c.label)+'</span></label>').join('');
  document.body.appendChild(menu);
  const r=ev.currentTarget.getBoundingClientRect();
  menu.style.top=(r.bottom+6+window.scrollY)+'px';
  menu.style.left=Math.min(r.left+window.scrollX, window.innerWidth-200)+'px';
  menu.querySelectorAll('input[data-col]').forEach(cb=>cb.onchange=()=>{
    let cur=visibleStaffCols();
    if(cb.checked){ if(!cur.includes(cb.dataset.col)) cur.push(cb.dataset.col); } else cur=cur.filter(k=>k!==cb.dataset.col);
    saveStaffCols(cur);
    const sb=document.getElementById('searchBox');
    renderStaff(sb?sb.value.toLowerCase():'');
  });
  setTimeout(()=>{ const close=(e)=>{ if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('mousedown',close); } }; document.addEventListener('mousedown',close); },0);
}

async function createLoginForm(id){
  const rows = await dbGet('staff?select=id,name,email,profile_id&id=eq.'+id); const staff=rows&&rows[0]; if(!staff) return;
  if(staff.profile_id){ toast('This person already has a login',true); return; }
  const genPw = ()=>Math.random().toString(36).slice(2,8)+Math.floor(10+Math.random()*90)+'!';
  modal({title:'Create login for '+staff.name, saveLabel:'Create account',
    body:'<p style="margin:0 0 14px;color:var(--muted);font-size:13.5px;line-height:1.5">Creates a login and links it to this staff record. Share the password with them — they can change it later.</p>'+
      '<div class="form-grid">'+
      '<div class="field full"><label>Email</label><input name="email" type="email" value="'+esc(staff.email||'')+'"></div>'+
      '<div class="field full"><label>Temporary password</label><input name="password" value="'+genPw()+'"></div>'+
      '</div>',
    onSave:async(bg)=>{
      const email=val(bg,'email'), password=val(bg,'password');
      if(!email||!password) throw new Error('Email and password are required');
      const res = await fetch(SUPABASE_URL+'/functions/v1/create-user',{
        method:'POST',
        headers:{'Authorization':'Bearer '+localStorage.getItem('sb-auth-token'),'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({email,password,name:staff.name})
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||'Failed to create login');
      const newId=data.id||data.user_id;
      if(!newId) throw new Error('create-user returned no id: '+JSON.stringify(data).slice(0,150));
      await dbPatch('staff?id=eq.'+staff.id,{profile_id:newId});
      STAFF = await dbGet('staff?select=*&order=name.asc')||[];
      document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
      renderStaff('');
      toast('Login created for '+staff.name);
      modal({title:'Login created', footer:false,
        body:'<p style="line-height:1.6;font-size:14px">Share these with <strong>'+esc(staff.name)+'</strong>:</p>'+
          detailRow('Email', esc(data.email||email))+detailRow('Temp password','<span class="mono">'+esc(data.password||password)+'</span>')+
          '<p style="color:var(--muted);font-size:13px;margin-top:12px">They can log in right away and change their password later.</p>'});
    }});
}

function renderStaff(q){
  q=q||'';
  const cols = STAFF_COLS.filter(c=>c.always || visibleStaffCols().includes(c.key));
  const rows=STAFF.filter(s=>!q||[s.name,s.email,s.role,s.department].some(v=>(v||'').toLowerCase().includes(q)));
  const head = cols.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'<th></th>';
  const body = rows.length? rows.map(s=>'<tr>'+cols.map(c=>'<td>'+c.cell(s)+'</td>').join('')+
      '<td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick=\'viewStaff("'+s.id+'")\'>View</button>'+ifCan('staff','u','<button class="btn btn-ghost btn-sm" onclick=\'staffForm("'+s.id+'")\'>Edit</button>')+ifCan('staff','d','<button class="btn btn-danger btn-sm" onclick=\'staffDelete("'+s.id+'")\'>Delete</button>')+'</div></td></tr>').join('')
    : '<tr><td colspan="'+(cols.length+1)+'"><div class="empty"><h4>No staff yet</h4><p>Promote people from your existing profiles, or add someone manually.</p>'+ifCan('staff','c','<button class="btn btn-primary" onclick="staffFromProfiles()">+ Add from profiles</button> <button class="btn btn-ghost" onclick="staffForm()">Add manually</button>')+'</div></td></tr>';
  document.getElementById('content').innerHTML =
    toolbar('Search staff by name, role, department…','<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="staffColumnsMenu(event)">Columns</button> <span class="count-pill">'+rows.length+' of '+STAFF.length+'</span>')+
    '<div class="panel"><div class="table-wrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div></div>';
  const sb=document.getElementById('searchBox'); if(sb&&q){ sb.value=q; }
  bindSearch(renderStaff);
}

async function staffForm(id){
  const s = id? STAFF.find(x=>x.id===id) : {};
  let curRole=null;
  if(s.profile_id){ try{ const pr=await dbGet('profiles?select=role_id&id=eq.'+s.profile_id); curRole=pr&&pr[0]?pr[0].role_id:null; }catch(e){} }
  let hostedShows=[];
  if(id){ try{ const hs=await dbGet('show_hosts?select=show:shows(id,name)&staff_id=eq.'+id); hostedShows=(hs||[]).map(h=>h.show).filter(Boolean); }catch(e){} }
  const f=(n,l,type,v,opts)=>'<div class="field'+(opts&&opts.full?' full':'')+'"><label>'+l+'</label>'+
    (type==='textarea'?'<textarea name="'+n+'">'+esc(v||'')+'</textarea>':'<input name="'+n+'" type="'+(type||'text')+'" value="'+esc(v||'')+'">')+'</div>';
  const roleField = s.profile_id
    ? '<div class="field full"><label>Access role</label><select name="role_id"><option value="">— no access —</option>'+
        ROLES.map(r=>'<option value="'+r.id+'"'+(curRole===r.id?' selected':'')+'>'+esc(r.name)+'</option>').join('')+'</select></div>'
    : '<div class="field full"><label>Access role</label><div style="font-size:13px;color:var(--muted);padding:6px 0">Link a login profile (Add from profiles) to assign dashboard access.</div></div>';
  modal({title:id?'Edit staff':'Add staff',wide:true,saveLabel:id?'Save changes':'Add staff',
    body:'<div class="form-grid">'+
      f('name','Full name','text',s.name)+ f('role','Job title','text',s.role)+
      f('email','Email','email',s.email)+ f('phone','Phone','text',s.phone)+
      f('department','Department','text',s.department)+
      f('headshot','Headshot file','text',s.headshot,{full:true})+
      '<div class="field"><label>Status</label><select name="is_active"><option value="true"'+(s.is_active!==false?' selected':'')+'>Active</option><option value="false"'+(s.is_active===false?' selected':'')+'>Inactive</option></select></div>'+
      '<div class="field"><label>Show on public Team page</label><select name="show_on_team"><option value="true"'+(s.show_on_team!==false?' selected':'')+'>Yes</option><option value="false"'+(s.show_on_team===false?' selected':'')+'>No</option></select></div>'+
      '<div class="field"><label>Reports to</label><select name="manager_id"><option value="">— nobody —</option>'+
        STAFF.filter(x=>x.id!==id).map(x=>'<option value="'+x.id+'"'+(s.manager_id===x.id?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Team</label><select name="team_id"><option value="">— none —</option>'+
        ORG_TEAMS.filter(t=>t.is_active!==false).map(t=>'<option value="'+t.id+'"'+(s.team_id===t.id?' selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></div>'+  
      f('dob','Date of birth','date',s.dob)+ f('start_date','Start date','date',s.start_date)+
      roleField+ f('address','Address','text',s.address,{full:true})+ f('notes','Notes','textarea',s.notes,{full:true})+
    '</div>'+
    (id? '<div style="margin-top:18px"><label style="font-size:12px;font-weight:600;color:var(--navy)">Shows hosted</label>'+
      (hostedShows.length? '<div style="margin-top:6px">'+hostedShows.map(sh=>'<span class="chip">'+esc(sh.name)+'</span>').join('')+'</div>'
        : '<div style="font-size:13px;color:var(--muted);margin-top:4px">Not hosting any shows yet — assign them in the Shows section.</div>')+'</div>' : ''),
    onSave:async(bg)=>{
      const body={name:val(bg,'name'),role:val(bg,'role'),email:val(bg,'email'),phone:val(bg,'phone'),manager_id: bg.querySelector('[name="manager_id"]').value||null, team_id: bg.querySelector('[name="team_id"]').value||null,
        department:val(bg,'department'),address:val(bg,'address'),notes:val(bg,'notes'),
        headshot:val(bg,'headshot')||null,
        dob:val(bg,'dob')||null,start_date:val(bg,'start_date')||null,
        is_active: bg.querySelector('[name="is_active"]').value==='true'};
        show_on_team: bg.querySelector('[name="show_on_team"]').value==='true',
      if(!body.name)throw new Error('Name is required');
      if(id){body.updated_at=new Date().toISOString();await dbPatch('staff?id=eq.'+id,body);}
      else{await dbPost('staff',body);}
      if(s.profile_id){ const sel=bg.querySelector('[name="role_id"]'); if(sel){ await dbPatch('profiles?id=eq.'+s.profile_id,{role_id: sel.value||null}); } }
      STAFF = await dbGet('staff?select=*&order=name.asc')||[];renderStaff('');
      toast(id?'Staff updated':'Staff added');
    }});
}

function staffDelete(id){const s=STAFF.find(x=>x.id===id);confirmDelete(esc(s.name),async()=>{
  await dbDel('staff?id=eq.'+id);STAFF=STAFF.filter(x=>x.id!==id);renderStaff('');toast('Staff removed');});}
async function staffFromProfiles(){
  const all = await dbGet('profiles?select=id,name,email,admin_level&order=name.asc')||[];
  const taken = new Set(STAFF.map(s=>s.profile_id).filter(Boolean));
  const pool = all.filter(p=>!taken.has(p.id));
  const render=(list)=> list.length
    ? list.slice(0,60).map(p=>'<label class="pick"><input type="checkbox" value="'+p.id+'">'+
        '<span class="mini-avatar" style="background:'+accentFor(p.name||p.email)+'">'+initials(p.name||p.email)+'</span>'+
        '<span class="pk-name">'+esc(p.name||'(no name)')+'</span>'+
        '<span class="pk-email">'+esc(p.email||'')+'</span></label>').join('')+
        (list.length>60?'<div class="pk-more">Showing 60 of '+list.length+' — keep typing to narrow.</div>':'')
    : '<div class="pk-empty">'+(pool.length?'No profiles match that search.':'Everyone in profiles is already on staff.')+'</div>';
  modal({title:'Add staff from profiles',wide:true,saveLabel:'Add selected',
    body:'<div class="search" style="max-width:none;margin-bottom:12px">'+
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>'+
      '<input id="pickSearch" placeholder="Search '+pool.length+' profiles by name or email…"></div>'+
      '<div id="pickList" class="pick-list">'+render(pool)+'</div>',
    onReady:(bg)=>{
      const inp=bg.querySelector('#pickSearch');
      inp.oninput=()=>{const q=inp.value.toLowerCase().trim();
        bg.querySelector('#pickList').innerHTML=render(q?pool.filter(p=>((p.name||'')+' '+(p.email||'')).toLowerCase().includes(q)):pool);};
      inp.focus();
    },
    onSave:async(bg)=>{
      const ids=[...bg.querySelectorAll('#pickList input:checked')].map(c=>c.value);
      if(!ids.length)throw new Error('Select at least one profile');
      const rows=ids.map(id=>{const p=pool.find(x=>x.id===id);return {profile_id:id,name:p.name||p.email,email:p.email,is_active:true};});
      await dbPost('staff',rows);
      STAFF = await dbGet('staff?select=*&order=name.asc')||[];renderStaff('');
      toast('Added '+ids.length+' staff member'+(ids.length>1?'s':''));
    }});
}