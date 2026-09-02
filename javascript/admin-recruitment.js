let RECRUITS=[];
const RECRUIT_SELECT='recruits?select=*,contact:staff!recruits_contact_id_fkey(id,name)&order=created_at.desc';
async function loadRecruitment(){
  topAction(ifCan('recruitment','c','<button class="btn btn-primary" onclick="recruitForm()">+ Add recruit</button>'));
  RECRUITS=await dbGet(RECRUIT_SELECT)||[];
  renderRecruits('');
}
function renderRecruits(q){
  const rows=RECRUITS.filter(r=>r.status!=='converted').filter(r=>!q||[r.name,r.email,r.role].some(v=>(v||'').toLowerCase().includes(q)));
  document.getElementById('content').innerHTML=
    toolbar('Search recruits…','<span class="count-pill" style="margin-left:auto">'+rows.length+' of '+RECRUITS.length+'</span>')+
    '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Source</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody>'+
    (rows.length? rows.map(r=>'<tr><td><strong>'+esc(r.name)+'</strong></td><td>'+esc(r.role||'—')+'</td><td>'+esc(r.email||'—')+'</td><td>'+badge(r.source==='website'?'Website':'Manual',r.source==='website'?'var(--aqua)':'var(--muted)')+'</td><td>'+(r.contact?esc(r.contact.name):'—')+'</td><td>'+(r.status==='converted'?badge('Converted','var(--green)'):badge('New','var(--orange)'))+'</td><td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick=\'recruitDetail("'+r.id+'")\'>View</button>'+ifCan('recruitment','u','<button class="btn btn-ghost btn-sm" onclick=\'recruitForm("'+r.id+'")\'>Edit</button>')+((r.status!=='converted'&&can('staff','c'))?'<button class="btn btn-primary btn-sm" onclick=\'convertRecruit("'+r.id+'")\'>Convert</button>':'')+ifCan('recruitment','d','<button class="btn btn-danger btn-sm" onclick=\'recruitDelete("'+r.id+'")\'>Delete</button>')+'</div></td></tr>').join('')
      : '<tr><td colspan="7"><div class="empty"><h4>No recruits yet</h4><p>Add someone interested in joining, or let the website form feed them in.</p>'+ifCan('recruitment','c','<button class="btn btn-primary" onclick="recruitForm()">+ Add recruit</button>')+'</div></td></tr>')+
    '</tbody></table></div></div>';
  bindSearch(renderRecruits);
}
async function recruitForm(id){
  const r=id?RECRUITS.find(x=>x.id===id):{};
  const staffList=await dbGet('staff?select=id,name&order=name.asc')||[];
  const f=(n,l,type,v)=>'<div class="field"><label>'+l+'</label><input name="'+n+'" type="'+(type||'text')+'" value="'+esc(v||'')+'"></div>';
  modal({title:id?'Edit recruit':'Add recruit',wide:true,saveLabel:id?'Save changes':'Add recruit',
    body:'<div class="form-grid">'+f('name','Full name','text',r.name)+f('role','Role','text',r.role)+f('email','Email','email',r.email)+f('phone','Phone number','text',r.phone)+f('dob','Date of birth','date',r.dob)+
      '<div class="field"><label>Point of contact</label><select name="contact_id"><option value="">— none —</option>'+staffList.map(st=>'<option value="'+st.id+'"'+(r.contact_id===st.id?' selected':'')+'>'+esc(st.name)+'</option>').join('')+'</select></div>'+
      '<div class="field full"><label>Why do you want to join?</label><textarea name="reason">'+esc(r.reason||'')+'</textarea></div></div>',
    onSave:async(bg)=>{
      const body={name:val(bg,'name'),role:val(bg,'role'),email:val(bg,'email'),phone:val(bg,'phone'),dob:val(bg,'dob')||null,contact_id:bg.querySelector('[name="contact_id"]').value||null,reason:val(bg,'reason')};
      if(!body.name)throw new Error('Name is required');
      if(id)await dbPatch('recruits?id=eq.'+id,body);else await dbPost('recruits',body);
      RECRUITS=await dbGet(RECRUIT_SELECT)||[];renderRecruits('');toast(id?'Recruit updated':'Recruit added');
    }});
}
async function recruitDetail(id){
  const rows=await dbGet('recruits?select=*,contact:staff!recruits_contact_id_fkey(id,name)&id=eq.'+id);const r=rows&&rows[0];if(!r)return;
  modal({title:r.name,wide:true,footer:false,
    body:'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'+(r.role?'<span class="chip">'+esc(r.role)+'</span>':'')+badge(r.source==='website'?'Website':'Manual',r.source==='website'?'var(--aqua)':'var(--muted)')+(r.status==='converted'?badge('Converted','var(--green)'):badge('New','var(--orange)'))+'</div>'+
      detailRow('Email',r.email?esc(r.email):'—')+detailRow('Phone',r.phone?esc(r.phone):'—')+detailRow('Date of birth',fmtDate(r.dob))+detailRow('Point of contact',r.contact?esc(r.contact.name):'—')+detailRow('Why join?',r.reason?'<div style="line-height:1.6;white-space:pre-wrap">'+esc(r.reason)+'</div>':'—')+detailRow('Applied',fmtDate(r.created_at))+
      ((r.status!=='converted'&&can('staff','c'))?'<div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick=\'document.querySelectorAll(".modal-bg").forEach(x=>x.remove());convertRecruit("'+r.id+'")\'>Convert to staff</button></div>':'')});
}
function recruitDelete(id){const r=RECRUITS.find(x=>x.id===id);confirmDelete(esc(r.name),async()=>{await dbDel('recruits?id=eq.'+id);RECRUITS=RECRUITS.filter(x=>x.id!==id);renderRecruits('');toast('Recruit removed');});}
async function nextSlffId(){
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/next_slff_id',{method:'POST',headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+localStorage.getItem('sb-auth-token'),'Content-Type':'application/json'},body:'{}'});
    if(!r.ok)return '';
    return await r.json()||'';
  }catch(e){return '';}
}

async function convertRecruit(id){
  const rows=await dbGet('recruits?select=*&id=eq.'+id);const rec=rows&&rows[0];if(!rec)return;
  if(rec.status==='converted'){toast('Already converted',true);return;}
  let matches=[];
  try{const parts=[];if(rec.email)parts.push('email.eq.'+encodeURIComponent(rec.email));if(rec.name)parts.push('name.ilike.*'+encodeURIComponent(rec.name)+'*');if(parts.length)matches=await dbGet('profiles?select=id,name,email,slffid&or=('+parts.join(',')+')&limit=5')||[];}catch(e){}
  const exact=rec.email?matches.find(m=>(m.email||'').toLowerCase()===rec.email.toLowerCase()):null;
  const genPw=()=>Math.random().toString(36).slice(2,8)+Math.floor(10+Math.random()*90)+'!';
  const suggestedId=(exact&&exact.slffid)?exact.slffid:await nextSlffId();
  const loginOpts='<option value="create"'+(exact?'':' selected')+'>Create a new login</option>'+
    matches.map(m=>'<option value="link:'+m.id+'"'+((exact&&exact.id===m.id)?' selected':'')+'>Link existing: '+esc(m.name||m.email)+(m.email?' ('+esc(m.email)+')':'')+'</option>').join('')+
    '<option value="none">No login account</option>';
  const today=new Date().toISOString().slice(0,10);
  modal({title:'Convert '+rec.name+' to staff',wide:true,saveLabel:'Convert to staff',
    body:'<p style="margin:0 0 14px;color:var(--muted);font-size:13.5px;line-height:1.5">'+(exact?'Found an existing login for '+esc(exact.email)+' — it will be linked instead of creating a duplicate.':'No existing login matches this recruit, so a new one will be created.')+'</p>'+
      '<div class="form-grid"><div class="field"><label>Start date</label><input name="start_date" type="date" value="'+today+'"></div>'+
      '<div class="field"><label>Department</label><select name="department"><option value="">— none —</option><option>Administration</option><option>Content</option><option>Partnership</option><option>Social Media</option></select></div>'+
      '<div class="field"><label>Login account</label><select name="login">'+loginOpts+'</select></div>'+
      '<div class="field"><label>SLFF ID</label><input name="slffid" value="'+esc(suggestedId)+'" placeholder="auto"></div>'+
      '<div class="field full"><label>Temp password (only used if creating a new login)</label><input name="password" value="'+genPw()+'"></div></div>',
    onSave:async(bg)=>{
      if(bg.dataset.busy==='1')return;
      bg.dataset.busy='1';
      try{
        const fresh=await dbGet('recruits?select=status,staff_id&id=eq.'+id);
        const cur=fresh&&fresh[0];
        if(cur&&cur.status==='converted')throw new Error('This recruit has already been converted');
        const start_date=val(bg,'start_date')||today;
        const login=bg.querySelector('[name="login"]').value;
        const slffid=(val(bg,'slffid')||'').trim();
        if(slffid&&!/^\d+$/.test(slffid))throw new Error('SLFF ID must be numeric');

        let profileId=null,pwShown=null;
        if(login.startsWith('link:')){
          profileId=login.slice(5);
          const ex=matches.find(m=>m.id===profileId);
          if(slffid&&ex&&!ex.slffid){try{await dbPatch('profiles?id=eq.'+profileId,{slffid});}catch(e){console.warn('slffid patch failed',e);}}
        }else if(login==='create'){
          if(!rec.email)throw new Error('This recruit has no email — add one before creating a login');
          const password=val(bg,'password')||genPw();
          const res=await fetch(SUPABASE_URL+'/functions/v1/create-user',{method:'POST',headers:{'Authorization':'Bearer '+localStorage.getItem('sb-auth-token'),'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:rec.email,password,name:rec.name,slffid:slffid||null})});
          const data=await res.json().catch(()=>({}));
          if(!res.ok)throw new Error(data.error||('Failed to create login ('+res.status+')'));
          const newId=data.id||data.user_id;
          if(!newId)throw new Error('create-user returned no id: '+JSON.stringify(data).slice(0,150));
          profileId=newId;
          if(!data.existing)pwShown={email:data.email||rec.email,password:data.password||password};
        }

        let staffId=cur&&cur.staff_id?cur.staff_id:null;
        if(!staffId&&rec.email){
          try{const d=await dbGet('staff?select=id&email=eq.'+encodeURIComponent(rec.email)+'&limit=1');if(d&&d[0])staffId=d[0].id;}catch(e){}
        }
        const staffBody={name:rec.name,email:rec.email,phone:rec.phone,dob:rec.dob||null,role:rec.role,
          department:val(bg,'department')||null,start_date,is_active:true,profile_id:profileId};
        if(staffId)await dbPatch('staff?id=eq.'+staffId,staffBody);
        else{const r=await dbPost('staff',staffBody);staffId=r[0].id;}

        await dbPatch('recruits?id=eq.'+id,{status:'converted',converted_at:new Date().toISOString(),staff_id:staffId});
        document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
        RECRUITS=await dbGet(RECRUIT_SELECT)||[];renderRecruits('');
        toast(rec.name+' converted to staff');
        if(pwShown)modal({title:'Login created',footer:false,body:'<p style="line-height:1.6">Share these with <strong>'+esc(rec.name)+'</strong>:</p>'+detailRow('Email',esc(pwShown.email))+detailRow('Temp password','<span class="mono">'+esc(pwShown.password)+'</span>')});
      }catch(e){ bg.dataset.busy=''; throw e; }
    }});
}
