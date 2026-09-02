async function gateLogin(){
  const email=document.getElementById('gEmail').value.trim();
  const pw=document.getElementById('gPass').value;
  const err=document.getElementById('gErr'); err.textContent='';
  if(!email||!pw){ err.textContent='Enter your email and password.'; return; }
  const btn=document.getElementById('gBtn'); btn.disabled=true; btn.textContent='Signing in…';
  try{
    if(typeof SUPABASE_URL==='undefined') throw new Error('noconfig');
    const res=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{
      method:'POST', headers:{'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email,password:pw})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error_description||data.msg||data.message||'Login failed');
    if(!data.access_token) throw new Error('No token returned');
    localStorage.setItem('sb-auth-token', data.access_token);
    boot();
  }catch(e){
    err.textContent = e.message==='noconfig' ? 'Sign-in isn\'t available (auth.js didn\'t load).' : 'Sign in failed. Check your email and password.';
    btn.disabled=false; btn.textContent='Sign in';
  }
}

function gateMsg(title,msg){
  document.getElementById('gateTitle').textContent=title;
  document.getElementById('gateMsg').textContent=msg;
  document.getElementById('gate').style.display='flex';
  document.getElementById('app').style.display='none';
}
async function waitForConfig(timeout){
  timeout=timeout||5000;const start=Date.now();
  while(Date.now()-start<timeout){
    if(typeof SUPABASE_URL!=='undefined' && typeof SUPABASE_ANON_KEY!=='undefined') return true;
    await new Promise(r=>setTimeout(r,120));
  }
  return false;
}
function decodeJwt(tok){
  try{const seg=tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(decodeURIComponent(escape(atob(seg))));}catch(e){return null;}
}

async function boot(){
  if(!(await waitForConfig())){
    gateMsg('Auth didn\'t load',
      'This page couldn\'t find auth.js (SUPABASE_URL is undefined). Check the <script src="javascript/auth.js"> path is right for where admin.html sits, and open it through your site URL — not a local file:// path.');
    return;
  }
  const token = localStorage.getItem('sb-auth-token');
  if(!token){
    gateMsg('Staff Access Required',
      'Only FantasyNow+ staff has access to login.');
    return;
  }
  const claims = (window.auth && auth.user && auth.user.sub) ? auth.user : decodeJwt(token);
  const uid = claims && claims.sub;
  if(!uid){
    gateMsg('Session problem','Your saved sign-in couldn\'t be read. Log out and back in on the site, then return here.');
    return;
  }
  try{
    const rows = await dbGet('profiles?select=*&id=eq.'+uid);
    ME = rows && rows[0];
  }catch(e){
    gateMsg('Couldn\'t verify access','Signed in, but the profile lookup failed: '+e.message);
    return;
  }
  const lvl = ME && ME.admin_level ? ME.admin_level : 0;
  if(!ME){ gateMsg('Admin access required','Found a session but no matching profile row. Log out and back in on the site.'); return; }
  try{ if(ME.role_id){ const r = await dbGet('roles?select=permissions&id=eq.'+ME.role_id); if(r&&r[0]) PERMS = r[0].permissions||{}; } }catch(e){ PERMS = {}; }
  try{ const merged = await rpc('my_perms'); if(merged && typeof merged==='object') PERMS = merged; }catch(e){}
  try{ MY_STAFF_ID = await rpc('my_staff_id'); }catch(e){ MY_STAFF_ID = null; }
  if(!(lvl>=9 || MY_STAFF_ID || Object.keys(RESOURCES).some(k=>can(k,'r')))){
    gateMsg('No access yet','Your account isn\'t linked to a staff record and has no dashboard permissions. Ask an owner to set you up.');
    return;
  }
  document.getElementById('gate').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('meName').textContent = ME.name || ME.email || 'Admin';
  const meAv = document.getElementById('meAvatar');
  meAv.textContent = initials(ME.name||ME.email);
  if(MY_STAFF_ID){
    dbGet('staff?select=headshot&id=eq.'+MY_STAFF_ID).then(r=>{
      const hs = r && r[0] && r[0].headshot;
      const src = headshotSrc(hs);
      if(!src) return;
      const img = document.createElement('img');
      img.className = 'avatar';
      img.id = 'meAvatar';
      img.src = src;
      img.alt = '';
      img.dataset.ini = initials(ME.name||ME.email);
      meAv.replaceWith(img);
    }).catch(()=>{});
  }
  document.getElementById('logoutBtn').onclick = ()=>{ if(window.auth&&auth.logout)auth.logout(); else {localStorage.removeItem('sb-auth-token');location.href='/';} };

  document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>go(b.dataset.go));

  try{ ADMINS = await dbGet('profiles?select=id,name,email&role_id=not.is.null&order=name.asc') || []; }catch(e){ ADMINS=[]; }
  try{ ROLES = await dbGet('roles?select=*&order=name.asc') || []; }catch(e){ ROLES=[]; }
  document.querySelectorAll('#nav button[data-go]').forEach(b=>{
    const k=b.dataset.go;
    if(RESOURCES[k] && !can(k,'r')) b.style.display='none';
  });
  const myOnbBtn=document.getElementById('navMyOnboarding');
  if(myOnbBtn) myOnbBtn.style.display = MY_STAFF_ID ? '' : 'none';

  dbPatch('profiles?id=eq.'+ME.id,{last_seen:new Date().toISOString()}).catch(()=>{});
  if(!window._fnpHeartbeat){ window._fnpHeartbeat=setInterval(()=>{ if(ME) dbPatch('profiles?id=eq.'+ME.id,{last_seen:new Date().toISOString()}).catch(()=>{}); }, 120000); }

  go('dashboard');
}

function toggleNav(){ document.body.classList.toggle('nav-open'); syncNavToggle(); }
function closeNav(){ document.body.classList.remove('nav-open'); syncNavToggle(); }
function syncNavToggle(){
  const b = document.getElementById('navToggle');
  if(b) b.setAttribute('aria-expanded', document.body.classList.contains('nav-open'));
}
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape' && document.body.classList.contains('nav-open')) closeNav();
});

function go(name){
  closeNav();
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.go===name));
  document.getElementById('pageTitle').textContent = NAV_TITLES[name] || name;
  document.getElementById('topActions').innerHTML='';
  document.getElementById('content').innerHTML='<div class="loading">Loading…</div>';
  if(RESOURCES[name] && !can(name,'r')){
    document.getElementById('content').innerHTML='<div class="empty"><h4>No access</h4><p>You don\'t have permission to view this section.</p></div>';
    return;
  }
  const fn = {dashboard:loadDashboard, staff:loadStaff, subscribers:loadSubscribers, recruitment:loadRecruitment,
    onboarding:loadOnboarding, my_onboarding:loadMyOnboarding, org:loadOrg,
    shows:loadShows, tools:loadTools, channels:loadChannels, youtube:loadYouTube, board:loadBoard, roles:loadRoles, calendar:loadCalendar,
    startsit:loadStartsit, gamepicks:loadGamePicks, logins:loadLogins, rankings:loadRankings, bets: loadBets}[name];
    
  fn().catch(err=>{
    document.getElementById('content').innerHTML =
      '<div class="empty"><h4>Couldn\'t load this</h4><p>'+esc(err.message)+'</p></div>';
  });
}

function topAction(html){document.getElementById('topActions').innerHTML=html;}

function badge(text,color){return '<span class="badge" style="color:'+color+';background:color-mix(in srgb,'+color+' 14%,#fff);border:1px solid color-mix(in srgb,'+color+' 30%,#fff)"><span class="dot" style="background:'+color+'"></span>'+esc(text)+'</span>';}

/* ---------------- MODAL ---------------- */
function modal(opts){
  const bg=document.createElement('div');bg.className='modal-bg';
  bg.innerHTML =
    '<div class="modal'+(opts.wide?' wide':'')+'">'+
      '<div class="modal-head"><h3>'+esc(opts.title)+'</h3><button class="x" aria-label="Close">&times;</button></div>'+
      '<div class="modal-body">'+opts.body+'</div>'+
      (opts.footer===false?'':
        '<div class="modal-foot"><span class="err" id="mErr"></span>'+
        '<button class="btn btn-ghost" data-cancel>Cancel</button>'+
        '<button class="btn btn-primary" data-save>'+esc(opts.saveLabel||'Save')+'</button></div>')+
    '</div>';
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.x').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  const cancel=bg.querySelector('[data-cancel]');if(cancel)cancel.onclick=close;
  const saveBtn=bg.querySelector('[data-save]');
  if(saveBtn&&opts.onSave){
    saveBtn.onclick=async()=>{
      const err=bg.querySelector('#mErr');err.textContent='';
      saveBtn.disabled=true;saveBtn.textContent='Saving…';
      try{ await opts.onSave(bg); close(); }
      catch(e){ console.error(e); err.textContent=e.message; saveBtn.disabled=false;saveBtn.textContent=opts.saveLabel||'Save'; }
    };
  }
  if(opts.onReady)opts.onReady(bg);
  return {el:bg,close};
}
function val(bg,name){const el=bg.querySelector('[name="'+name+'"]');return el?el.value.trim():'';}
function confirmDelete(what,onYes){
  modal({title:'Delete '+what+'?',body:'<p style="margin:0;line-height:1.5;color:var(--muted)">This can\'t be undone.</p>',
    saveLabel:'Delete',onSave:async()=>{await onYes();}});
}

function detailRow(label,val){ return '<div style="display:flex;gap:12px;padding:9px 0;border-top:1px solid var(--line)"><div style="min-width:120px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">'+esc(label)+'</div><div style="flex:1;font-size:14px">'+val+'</div></div>'; }
function viewShow(id){ document.querySelectorAll('.modal-bg').forEach(m=>m.remove()); showDetail(id); }
function viewStaff(id){ document.querySelectorAll('.modal-bg').forEach(m=>m.remove()); staffDetail(id); }
function viewChannel(id){ document.querySelectorAll('.modal-bg').forEach(m=>m.remove()); channelDetail(id); }

async function showDetail(id){
  const rows = await dbGet('shows?select=*,channel:channels(name),host_links:show_hosts(staff(id,name))&id=eq.'+id);
  const s = rows&&rows[0]; if(!s) return;
  const hosts=(s.host_links||[]).map(h=>h.staff).filter(Boolean);
  modal({title:s.name,wide:true,footer:false,
    body:'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'+
        (s.content_type?badge(s.content_type,accentFor(s.content_type)):'')+
        (s.is_active!==false?badge('Active','var(--green)'):badge('Off air','var(--muted)'))+'</div>'+
      detailRow('Hosts', hosts.length? hosts.map(h=>'<span class="chip chip-link" onclick=\'viewStaff("'+h.id+'")\'>'+esc(h.name)+'</span>').join('') : '<span style="color:var(--muted)">None linked</span>')+
      detailRow('Channel', s.channel?esc(s.channel.name):'—')+
      detailRow('Schedule', s.schedule_day?esc(s.schedule_day):'—')+
      (s.description?detailRow('Description','<div style="line-height:1.6;white-space:pre-wrap">'+esc(s.description)+'</div>'):'')+
      (can('shows','u')?'<div style="margin-top:16px"><button class="btn btn-ghost btn-sm" onclick=\'document.querySelectorAll(".modal-bg").forEach(x=>x.remove());showForm("'+s.id+'")\'>Edit show</button></div>':'')
  });
}
async function staffDetail(id){
  const rows = await dbGet('staff?select=*&id=eq.'+id); const s=rows&&rows[0]; if(!s) return;
  let role=null; if(s.profile_id){ try{ const pr=await dbGet('profiles?select=role:roles(name)&id=eq.'+s.profile_id); role=pr&&pr[0]&&pr[0].role?pr[0].role.name:null; }catch(e){} }
  let hosted=[]; try{ const hs=await dbGet('show_hosts?select=show:shows(id,name)&staff_id=eq.'+id); hosted=(hs||[]).map(h=>h.show).filter(Boolean); }catch(e){}
  modal({title:s.name,wide:true,footer:false,
    body:'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'+
        (s.role?'<span class="chip">'+esc(s.role)+'</span>':'')+
        (s.is_active!==false?badge('Active','var(--green)'):badge('Inactive','var(--muted)'))+
        (s.profile_id?badge('Login linked','var(--aqua)'):'')+
        (role?'<span class="chip">Access: '+esc(role)+'</span>':'')+'</div>'+
      detailRow('Email', s.email?esc(s.email):'—')+
      detailRow('Phone', s.phone?esc(s.phone):'—')+
      detailRow('Department', s.department?esc(s.department):'—')+
      detailRow('Start date', fmtDate(s.start_date))+
      detailRow('Date of birth', fmtDate(s.dob))+
      (s.address?detailRow('Address', esc(s.address)):'')+
      detailRow('Shows hosted', hosted.length? hosted.map(sh=>'<span class="chip chip-link" onclick=\'viewShow("'+sh.id+'")\'>'+esc(sh.name)+'</span>').join('') : '<span style="color:var(--muted)">None</span>')+
      (s.notes?detailRow('Notes','<div style="line-height:1.6;white-space:pre-wrap">'+esc(s.notes)+'</div>'):'')+
      '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">'+ifCan('staff','u','<button class="btn btn-ghost btn-sm" onclick=\'document.querySelectorAll(".modal-bg").forEach(x=>x.remove());staffForm("'+s.id+'")\'>Edit</button>')+((!s.profile_id && can('staff','c'))?'<button class="btn btn-navy btn-sm" onclick=\'createLoginForm("'+s.id+'")\'>Create login</button>':'')+'</div>'
  });
}
async function channelDetail(id){
  const rows = await dbGet('channels?select=*,shows(id,name)&id=eq.'+id); const c=rows&&rows[0]; if(!c) return;
  const shows=c.shows||[];
  modal({title:c.name,wide:true,footer:false,
    body:(c.youtube_channel_id?detailRow('YouTube ID','<span class="mono">'+esc(c.youtube_channel_id)+'</span>'):'')+
      (c.youtube_url?detailRow('YouTube URL','<a href="'+esc(c.youtube_url)+'" target="_blank" rel="noopener">'+esc(c.youtube_url)+'</a>'):'')+
      (c.description?detailRow('Description','<div style="line-height:1.6;white-space:pre-wrap">'+esc(c.description)+'</div>'):'')+
      detailRow('Shows ('+shows.length+')', shows.length? shows.map(sh=>'<span class="chip chip-link" onclick=\'viewShow("'+sh.id+'")\'>'+esc(sh.name)+'</span>').join('') : '<span style="color:var(--muted)">None</span>')+
      (can('channels','u')?'<div style="margin-top:16px"><button class="btn btn-ghost btn-sm" onclick=\'document.querySelectorAll(".modal-bg").forEach(x=>x.remove());channelForm("'+c.id+'")\'>Edit</button></div>':'')
  });
}