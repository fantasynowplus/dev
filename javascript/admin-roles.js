async function loadRoles(){
  if(!can('roles','r')){ document.getElementById('content').innerHTML='<div class="empty"><h4>No access</h4><p>You don\'t have permission to manage roles.</p></div>'; return; }
  topAction(ifCan('roles','c','<button class="btn btn-primary" onclick="roleForm()">+ New role</button>'));
  ROLES = await dbGet('roles?select=*&order=name.asc')||[];
  if(!ROLES.length){
    document.getElementById('content').innerHTML='<div class="empty"><h4>No roles yet</h4><p>Create a role and choose what it can do in each section.</p>'+ifCan('roles','c','<button class="btn btn-primary" onclick="roleForm()">+ New role</button>')+'</div>';
    return;
  }
  const cell=(perm,k,a)=> (perm&&perm[k]&&perm[k][a])?'<span class="pm-on">'+a.toUpperCase()+'</span>':'<span class="pm-off">'+a.toUpperCase()+'</span>';
  const head='<tr><th>Section</th>'+ROLES.map(r=>'<th>'+
      '<div class="role-name">'+esc(r.name)+'</div>'+
      (r.description?'<div class="role-desc">'+esc(r.description)+'</div>':'')+
      ((can('roles','u')||can('roles','d'))?'<div style="display:flex;gap:6px;justify-content:center;margin-top:9px">'+
        ifCan('roles','u','<button class="btn btn-ghost btn-sm" onclick=\'roleForm("'+r.id+'")\'>Edit</button>')+
        ifCan('roles','d','<button class="btn btn-danger btn-sm" onclick=\'roleDelete("'+r.id+'")\'>Delete</button>')+'</div>':'')+
    '</th>').join('')+'</tr>';
  const body=resourceGroups().map(g=>
    '<tr class="role-group"><td colspan="'+(ROLES.length+1)+'">'+esc(g.label)+'</td></tr>'+
    g.keys.map(k=>'<tr><td>'+esc(RESOURCES[k])+'</td>'+
      ROLES.map(r=>'<td>'+['c','r','u','d'].map(a=>cell(r.permissions,k,a)).join('')+'</td>').join('')+
    '</tr>').join('')
  ).join('');
  document.getElementById('content').innerHTML =
    '<div class="panel"><div class="table-wrap"><table class="role-matrix"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></div>'+
    '<div id="ppPanel"><div class="empty">Loading individual access…</div></div>';
  loadPersonPerms();
}

/* ---------------- individual access (grants on top of a role) ---------------- */
let PPERMS=[], PPROFILES=[];
async function loadPersonPerms(){
  const host=document.getElementById('ppPanel');
  if(!host) return;
  try{
    PPERMS = await dbGet('profile_perms?select=*,profile:profiles(id,name,email)&order=resource.asc')||[];
  }catch(e){
    host.innerHTML='<div class="panel"><div class="empty"><h4>Individual access unavailable</h4><p>'+esc(e.message)+'</p></div></div>';
    return;
  }
  const rows = PPERMS.map(p=>{
    const nm = (p.profile&&(p.profile.name||p.profile.email))||'Unknown';
    const acts=['c','r','u','d'].map(a=>p[a]?'<span class="pm-on">'+a.toUpperCase()+'</span>':'<span class="pm-off">'+a.toUpperCase()+'</span>').join('');
    return '<tr><td><strong>'+esc(nm)+'</strong>'+(p.note?'<div class="role-desc">'+esc(p.note)+'</div>':'')+'</td>'+
      '<td>'+esc(RESOURCES[p.resource]||p.resource)+'</td>'+
      '<td>'+acts+'</td>'+
      '<td class="row-actions">'+
        ifCan('roles','u','<button class="btn btn-ghost btn-sm" onclick=\'ppForm("'+p.profile_id+'","'+p.resource+'")\'>Edit</button>')+
        ifCan('roles','u','<button class="btn btn-danger btn-sm" onclick=\'ppDelete("'+p.profile_id+'","'+p.resource+'")\'>Remove</button>')+
      '</td></tr>';
  }).join('');

  host.innerHTML =
    '<div class="panel" style="margin-top:18px">'+
      '<div class="panel-head"><h3>Individual access</h3>'+
        ifCan('roles','u','<button class="btn btn-primary btn-sm" onclick="ppForm()">+ Grant access</button>')+
      '</div>'+
      (PPERMS.length
        ? '<div class="table-wrap"><table><thead><tr><th>Person</th><th>Section</th><th>Access</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
        : '<div class="empty"><p>Nobody has extra access yet. Use this to give one person a section their role doesn\'t include — it only ever adds access, never removes it.</p></div>')+
    '</div>';
}

async function ppForm(profileId, resource){
  const existing = (profileId&&resource) ? PPERMS.find(p=>p.profile_id===profileId&&p.resource===resource) : null;
  if(!PPROFILES.length){
    try{ PPROFILES = await dbGet('profiles?select=id,name,email&order=name.asc')||[]; }catch(e){ PPROFILES=[]; }
  }
  const people = PPROFILES.map(p=>'<option value="'+p.id+'"'+(existing&&existing.profile_id===p.id?' selected':'')+'>'+esc(p.name||p.email||p.id)+'</option>').join('');
  const sections = Object.keys(RESOURCES).map(k=>'<option value="'+k+'"'+(existing&&existing.resource===k?' selected':'')+'>'+esc(RESOURCES[k])+'</option>').join('');
  const box=(a,label)=>'<label class="pp-box"><input type="checkbox" data-act="'+a+'"'+(existing&&existing[a]?' checked':'')+'> '+label+'</label>';

  modal({title: existing?'Edit access':'Grant access', wide:true, saveLabel:'Save access',
    body:'<div class="form-grid">'+
      '<div class="field"><label>Person</label><select id="pp-person"'+(existing?' disabled':'')+'>'+people+'</select></div>'+
      '<div class="field"><label>Section</label><select id="pp-res"'+(existing?' disabled':'')+'>'+sections+'</select></div>'+
      '<div class="field full"><label>What they can do</label><div class="pp-boxes">'+
        box('r','Read')+box('c','Create')+box('u','Update')+box('d','Delete')+'</div></div>'+
      '<div class="field full"><label>Note (optional)</label><input id="pp-note" placeholder="Why this person has it" value="'+esc((existing&&existing.note)||'')+'"></div>'+
      '</div>'+
      '<p class="pp-hint">This is added on top of their role. Their role\'s own permissions stay exactly as they are.</p>',
    onSave: async (bg)=>{
      const pid = existing ? existing.profile_id : bg.querySelector('#pp-person').value;
      const res = existing ? existing.resource   : bg.querySelector('#pp-res').value;
      if(!pid||!res) throw new Error('Pick a person and a section.');
      const payload={profile_id:pid, resource:res, c:false, r:false, u:false, d:false,
                     note: bg.querySelector('#pp-note').value.trim()||null};
      bg.querySelectorAll('input[data-act]').forEach(cb=>{ payload[cb.dataset.act]=cb.checked; });
      if(!(payload.c||payload.r||payload.u||payload.d)) throw new Error('Tick at least one thing they can do, or remove the grant instead.');
      await dbDel('profile_perms?profile_id=eq.'+pid+'&resource=eq.'+res);
      await dbPost('profile_perms', payload);
      toast('Access saved');
      loadPersonPerms();
    }});
}

function ppDelete(profileId, resource){
  const p = PPERMS.find(x=>x.profile_id===profileId&&x.resource===resource);
  const nm = (p&&p.profile&&(p.profile.name||p.profile.email))||'this person';
  confirmDelete(esc(nm)+"'s extra access to "+esc(RESOURCES[resource]||resource), async()=>{
    await dbDel('profile_perms?profile_id=eq.'+profileId+'&resource=eq.'+resource);
    toast('Access removed');
    loadPersonPerms();
  });
}

function roleForm(id){
  const r = id? ROLES.find(x=>x.id===id) : {permissions:{}};
  const perm = r.permissions||{};
  const rows = resourceGroups().map(g=>
    '<tr class="pm-group"><td colspan="5">'+esc(g.label)+'</td></tr>'+
    g.keys.map(k=>{
      const p = perm[k]||{};
      return '<tr><td style="font-weight:600">'+RESOURCES[k]+'</td>'+
        ['c','r','u','d'].map(a=>'<td style="text-align:center"><input type="checkbox" data-res="'+k+'" data-act="'+a+'"'+(p[a]?' checked':'')+'></td>').join('')+'</tr>';
    }).join('')
  ).join('');
  modal({title:id?'Edit role':'New role',wide:true,saveLabel:id?'Save role':'Create role',
    body:'<div class="form-grid"><div class="field"><label>Role name</label><input name="name" value="'+esc(r.name||'')+'"></div>'+
      '<div class="field"><label>Description</label><input name="description" value="'+esc(r.description||'')+'"></div></div>'+
      '<table class="perm-matrix"><thead><tr><th>Section</th><th>Create</th><th>Read</th><th>Update</th><th>Delete</th></tr></thead><tbody>'+rows+'</tbody></table>',
    onSave:async(bg)=>{
      const name=val(bg,'name'); if(!name) throw new Error('Role name is required');
      const permissions={};
      bg.querySelectorAll('input[data-res]').forEach(cb=>{ if(cb.checked){ (permissions[cb.dataset.res]=permissions[cb.dataset.res]||{})[cb.dataset.act]=true; } });
      const body={name,description:val(bg,'description'),permissions};
      if(id) await dbPatch('roles?id=eq.'+id,body); else await dbPost('roles',body);
      loadRoles(); toast(id?'Role updated':'Role created');
    }});
}
function roleDelete(id){const r=ROLES.find(x=>x.id===id);confirmDelete('the "'+esc(r.name)+'" role',async()=>{
  await dbDel('roles?id=eq.'+id);loadRoles();toast('Role deleted');});}