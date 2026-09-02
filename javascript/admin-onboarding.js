let ONB=[];
let ONB_TPL=[];
let ONB_STAFF=[];
let ONB_TAB='people';
let ONB_DONE=false;

function onbPct(d,t){return t?Math.round(d/t*100):0;}
function onbBar(d,t){return '<div style="display:flex;align-items:center;gap:10px"><div class="onb-bar" style="flex:1"><span style="width:'+onbPct(d,t)+'%"></span></div><span class="mono" style="font-size:12px;color:var(--muted);white-space:nowrap">'+d+'/'+t+'</span></div>';}
function onbStaffName(id){const s=ONB_STAFF.find(x=>x.id===id);return s?s.name:null;}
function onbItems(staffId){return dbGet('staff_onboarding_items?select=*&staff_id=eq.'+staffId+'&order=category.asc.nullslast,sort_order.asc,title.asc');}

async function loadOnboarding(){
  try{ ONB_STAFF = await dbGet('staff?select=id,name&order=name.asc')||[]; }catch(e){ ONB_STAFF=[]; }
  ONB = await rpc('onboarding_list',{p_include_completed:ONB_DONE})||[];
  if(can('onboarding_template','r')){
    try{ ONB_TPL = await dbGet('onboarding_template_items?select=*&order=category.asc.nullslast,sort_order.asc')||[]; }catch(e){ ONB_TPL=[]; }
  } else { ONB_TPL=[]; }
  if(ONB_TAB==='template' && !can('onboarding_template','r')) ONB_TAB='people';
  renderOnboarding('');
}

function onbTab(t){ ONB_TAB=t; renderOnboarding(''); }
async function onbToggleDone(v){ ONB_DONE=v; ONB = await rpc('onboarding_list',{p_include_completed:ONB_DONE})||[]; renderOnboarding(''); }

function renderOnboarding(q){
  q=q||'';
  topAction(ONB_TAB==='template' ? ifCan('onboarding_template','c','<button class="btn btn-primary" onclick="tplForm()">+ Add step</button>') : '');
  const tabs='<div class="onb-tabs">'+
    '<button class="'+(ONB_TAB==='people'?'on':'')+'" onclick="onbTab(\'people\')">People<span class="count-pill" style="margin-left:8px">'+ONB.length+'</span></button>'+
    (can('onboarding_template','r')?'<button class="'+(ONB_TAB==='template'?'on':'')+'" onclick="onbTab(\'template\')">Template<span class="count-pill" style="margin-left:8px">'+ONB_TPL.length+'</span></button>':'')+
    '</div>';
  document.getElementById('content').innerHTML = tabs + (ONB_TAB==='template' ? onbTemplateHtml() : onbPeopleHtml(q));
  const sb=document.getElementById('searchBox'); if(sb&&q) sb.value=q;
  bindSearch(renderOnboarding);
}

function onbPeopleHtml(q){
  const rows=ONB.filter(r=>!q||[r.name,r.job_title].some(v=>(v||'').toLowerCase().includes(q)));
  const body=rows.length? rows.map(r=>{
    const done=Number(r.required_done||0), tot=Number(r.required_total||0);
    const status = r.onboarding_status==='completed' ? badge('Completed','var(--green)')
      : (tot>0 && done>=tot ? badge('Ready to finish','var(--sky)') : badge('In progress','var(--orange)'));
    return '<tr><td><strong>'+esc(r.name)+'</strong>'+(r.job_title?'<div style="font-size:12px;color:var(--muted)">'+esc(r.job_title)+'</div>':'')+'</td>'+
      '<td>'+fmtDate(r.start_date)+'</td>'+
      '<td style="min-width:180px">'+onbBar(done,tot)+'</td>'+
      '<td>'+status+'</td>'+
      '<td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick=\'onbDetail("'+r.staff_id+'")\'>Open</button></div></td></tr>';
  }).join('')
  : '<tr><td colspan="5"><div class="empty"><h4>Nobody in onboarding</h4><p>Anyone whose onboarding isn\'t marked complete shows up here. Convert a recruit to add someone.</p></div></td></tr>';
  return toolbar('Search people in onboarding…',
      '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin-left:auto;cursor:pointer"><input type="checkbox"'+(ONB_DONE?' checked':'')+' onchange="onbToggleDone(this.checked)"> Show completed</label> <span class="count-pill">'+rows.length+'</span>')+
    '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Start date</th><th>Required progress</th><th>Status</th><th></th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

async function onbDetail(staffId){
  const row=ONB.find(r=>r.staff_id===staffId);
  const items=await onbItems(staffId)||[];
  modal({title:(row?row.name:'Onboarding'),wide:true,footer:false,body:onbDetailBody(staffId,items,row)});
}

function onbDetailBody(staffId,items,row){
  const reqTot=items.filter(i=>i.is_required).length;
  const reqDone=items.filter(i=>i.is_required&&i.is_complete).length;
  const optional=items.length-reqTot;
  const completed = row && row.onboarding_status==='completed';
  let html='<div style="margin-bottom:8px">'+
    (row&&row.email?'<div style="font-size:13px;color:var(--muted);margin:-6px 0 14px">'+esc(row.email)+'</div>':'')+
    (completed?'<div style="margin-bottom:12px">'+badge('Onboarding complete','var(--green)')+'</div>':'')+
    onbBar(reqDone,reqTot)+
    '<div style="font-size:12.5px;color:var(--muted);margin-top:7px">'+reqDone+' of '+reqTot+' required steps done'+(optional>0?' · '+optional+' optional':'')+'</div></div>';
  let cat=null;
  html+=items.map(i=>{
    let out='';
    const c=i.category||'Other';
    if(c!==cat){ cat=c; out+='<div class="onb-cat">'+esc(c)+'</div>'; }
    const resp=i.responsible_staff_id?onbStaffName(i.responsible_staff_id):null;
    const meta=[];
    if(resp) meta.push('Responsible: '+esc(resp));
    if(i.is_complete&&i.completed_at) meta.push('Done '+fmtDate(i.completed_at));
    out+='<div class="onb-item'+(i.is_complete?' done':'')+'">'+
      '<input type="checkbox"'+(i.is_complete?' checked':'')+(can('onboarding','u')?'':' disabled')+' onchange=\'onbToggle("'+i.id+'","'+staffId+'",this.checked)\'>'+
      '<div style="flex:1">'+
        '<div class="onb-t">'+esc(i.title)+(i.is_required?'':' <span class="chip" style="font-size:10px">Optional</span>')+'</div>'+
        (i.description?'<div class="onb-d">'+esc(i.description)+'</div>':'')+
        (meta.length?'<div class="onb-d">'+meta.join(' · ')+'</div>':'')+
        (i.notes?'<div class="onb-d" style="font-style:italic;color:var(--navy)">'+esc(i.notes)+'</div>':'')+
      '</div>'+
      (can('onboarding','u')?'<button class="btn btn-ghost btn-sm" onclick=\'onbNote("'+i.id+'","'+staffId+'")\'>Note</button>':'')+
      ((!i.template_item_id&&can('onboarding','d'))?'<button class="btn btn-danger btn-sm" onclick=\'onbItemDelete("'+i.id+'","'+staffId+'")\'>Remove</button>':'')+
    '</div>';
    return out;
  }).join('');
  if(!items.length) html+='<div class="empty" style="padding:26px"><p>No steps assigned. Build the base checklist on the Template tab.</p></div>';
  html+='<div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap">'+
    ifCan('onboarding','c','<button class="btn btn-ghost btn-sm" onclick=\'onbAddItem("'+staffId+'")\'>+ Add a step for this person</button>')+
    (can('onboarding','u') ? (completed
      ? '<button class="btn btn-ghost btn-sm" onclick=\'onbComplete("'+staffId+'",false)\'>Reopen onboarding</button>'
      : '<button class="btn btn-primary btn-sm" onclick=\'onbComplete("'+staffId+'",true)\'>Mark onboarding complete</button>') : '')+
  '</div>';
  return html;
}

async function onbRefresh(staffId){
  const items=await onbItems(staffId)||[];
  const row=ONB.find(r=>r.staff_id===staffId);
  if(row){
    const req=items.filter(i=>i.is_required);
    row.required_total=req.length; row.required_done=req.filter(i=>i.is_complete).length;
    row.total=items.length; row.done=items.filter(i=>i.is_complete).length;
  }
  const bg=document.querySelector('.modal-bg');
  if(bg){ const b=bg.querySelector('.modal-body'); if(b) b.innerHTML=onbDetailBody(staffId,items,row); }
}

async function onbToggle(itemId,staffId,checked){
  try{
    await dbPatch('staff_onboarding_items?id=eq.'+itemId,{
      is_complete:checked,
      completed_at:checked?new Date().toISOString():null,
      completed_by:checked?(ME?ME.id:null):null
    });
  }catch(e){ toast('Couldn\'t save that step: '+e.message,true); }
  await onbRefresh(staffId);
}

function onbNote(itemId,staffId){
  dbGet('staff_onboarding_items?select=title,notes&id=eq.'+itemId).then(rows=>{
    const it=rows&&rows[0]; if(!it) return;
    modal({title:'Note — '+it.title,saveLabel:'Save note',
      body:'<div class="field full"><label>Note</label><textarea name="notes">'+esc(it.notes||'')+'</textarea></div>',
      onSave:async(bg)=>{
        await dbPatch('staff_onboarding_items?id=eq.'+itemId,{notes:val(bg,'notes')||null});
        await onbRefresh(staffId); toast('Note saved');
      }});
  }).catch(e=>toast(e.message,true));
}

function onbAddItem(staffId){
  modal({title:'Add a step for this person',wide:true,saveLabel:'Add step',
    body:'<p style="margin:0 0 14px;color:var(--muted);font-size:13.5px;line-height:1.5">This step applies to this person only. To add something everyone gets, use the Template tab.</p>'+
      '<div class="form-grid">'+
      '<div class="field full"><label>Title</label><input name="title"></div>'+
      '<div class="field full"><label>Description</label><textarea name="description"></textarea></div>'+
      '<div class="field"><label>Category</label><input name="category" placeholder="Paperwork, Access, Training…"></div>'+
      '<div class="field"><label>Required?</label><select name="is_required"><option value="true">Required</option><option value="false">Optional</option></select></div>'+
      '<div class="field full"><label>Responsible</label><select name="resp"><option value="">— unassigned —</option><option value="self">This person</option>'+
        ONB_STAFF.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join('')+'</select></div>'+
      '</div>',
    onSave:async(bg)=>{
      const title=val(bg,'title'); if(!title) throw new Error('Title is required');
      const r=bg.querySelector('[name="resp"]').value;
      await dbPost('staff_onboarding_items',{
        staff_id:staffId, title, description:val(bg,'description')||null, category:val(bg,'category')||null,
        is_required: bg.querySelector('[name="is_required"]').value==='true',
        responsible_staff_id: r==='self'?staffId:(r||null), sort_order:900
      });
      await onbRefresh(staffId); toast('Step added');
    }});
}

function onbItemDelete(itemId,staffId){
  confirmDelete('this step',async()=>{
    await dbDel('staff_onboarding_items?id=eq.'+itemId);
    await onbRefresh(staffId);
    toast('Step removed');
  });
}

async function onbComplete(staffId,complete){
  const finish=async()=>{
    document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
    await loadOnboarding();
    toast(complete?'Onboarding marked complete':'Onboarding reopened');
  };
  try{
    await rpc('set_onboarding_complete',{p_staff_id:staffId,p_complete:complete,p_force:false});
    await finish();
  }catch(e){
    if(complete && /required/i.test(e.message)){
      modal({title:'Required steps still open',saveLabel:'Complete anyway',
        body:'<p style="margin:0;line-height:1.6;color:var(--muted)">Some required steps aren\'t checked off yet. Mark this person\'s onboarding complete anyway?</p>',
        onSave:async()=>{
          await rpc('set_onboarding_complete',{p_staff_id:staffId,p_complete:true,p_force:true});
          await finish();
        }});
      return;
    }
    toast(e.message,true);
  }
}

function tplGroups(){
  const groups=[], idx={};
  ONB_TPL.forEach(t=>{
    const c=t.category||'Other';
    if(idx[c]===undefined){ idx[c]=groups.length; groups.push({label:c,items:[]}); }
    groups[idx[c]].items.push(t);
  });
  return groups;
}

function onbTemplateHtml(){
  const canOrder=can('onboarding_template','u');
  const body=ONB_TPL.length? tplGroups().map(g=>
    '<tr class="tbl-group"><td colspan="6">'+esc(g.label)+'</td></tr>'+
    g.items.map((t,i)=>{
      const resp = t.responsible_mode==='new_hire' ? 'The new hire'
        : (t.responsible_mode==='specific' ? (onbStaffName(t.responsible_staff_id)||'—') : '—');
      const move = canOrder
        ? '<div class="tpl-move"><button class="btn btn-ghost btn-sm"'+(i===0?' disabled':'')+' onclick=\'tplMove("'+t.id+'",-1)\' title="Move up">&uarr;</button>'+
          '<button class="btn btn-ghost btn-sm"'+(i===g.items.length-1?' disabled':'')+' onclick=\'tplMove("'+t.id+'",1)\' title="Move down">&darr;</button></div>'
        : '';
      return '<tr><td style="width:1%">'+move+'</td>'+
        '<td><strong>'+esc(t.title)+'</strong>'+(t.description?'<div style="font-size:12px;color:var(--muted)">'+esc(t.description)+'</div>':'')+'</td>'+
        '<td>'+(t.is_required?badge('Required','var(--orange)'):badge('Optional','var(--muted)'))+'</td>'+
        '<td>'+esc(resp)+'</td>'+
        '<td>'+(t.is_active?badge('Active','var(--green)'):badge('Off','var(--muted)'))+'</td>'+
        '<td><div class="row-actions">'+
          ifCan('onboarding_template','u','<button class="btn btn-ghost btn-sm" onclick=\'tplForm("'+t.id+'")\'>Edit</button>')+
          ifCan('onboarding_template','d','<button class="btn btn-danger btn-sm" onclick=\'tplDelete("'+t.id+'")\'>Delete</button>')+
        '</div></td></tr>';
    }).join('')
  ).join('')
  : '<tr><td colspan="6"><div class="empty"><h4>No template steps yet</h4><p>Build the base checklist that everyone gets when they join.</p>'+ifCan('onboarding_template','c','<button class="btn btn-primary" onclick="tplForm()">+ Add step</button>')+'</div></td></tr>';
  return '<div class="panel"><div class="panel-head"><h3>Base checklist</h3>'+
      '<span style="margin-left:auto;font-size:12.5px;color:var(--muted)">Adding a step here gives it to everyone still in onboarding</span></div>'+
    '<div class="table-wrap"><table><thead><tr><th></th><th>Step</th><th>Type</th><th>Responsible</th><th>Status</th><th></th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

async function tplMove(id,dir){
  const t=ONB_TPL.find(x=>x.id===id); if(!t) return;
  const cat=t.category||'Other';
  const list=ONB_TPL.filter(x=>(x.category||'Other')===cat);
  const i=list.findIndex(x=>x.id===id), j=i+dir;
  if(j<0||j>=list.length) return;
  list.splice(j,0,list.splice(i,1)[0]);
  try{
    for(let k=0;k<list.length;k++){
      const want=(k+1)*10;
      if(list[k].sort_order!==want) await dbPatch('onboarding_template_items?id=eq.'+list[k].id,{sort_order:want});
    }
  }catch(e){ toast(e.message,true); }
  await loadOnboarding();
}

function tplForm(id){
  const t = id ? ONB_TPL.find(x=>x.id===id) : {is_required:true,is_active:true,responsible_mode:'unassigned',sort_order:(ONB_TPL.length+1)*10};
  const respSel='<select name="resp">'+
    '<option value="unassigned"'+((!t.responsible_mode||t.responsible_mode==='unassigned')?' selected':'')+'>— unassigned —</option>'+
    '<option value="new_hire"'+(t.responsible_mode==='new_hire'?' selected':'')+'>The new hire</option>'+
    ONB_STAFF.map(s=>'<option value="'+s.id+'"'+((t.responsible_mode==='specific'&&t.responsible_staff_id===s.id)?' selected':'')+'>'+esc(s.name)+'</option>').join('')+
    '</select>';
  modal({title:id?'Edit template step':'New template step',wide:true,saveLabel:id?'Save step':'Add step',
    body:'<div class="form-grid">'+
      '<div class="field full"><label>Title</label><input name="title" value="'+esc(t.title||'')+'"></div>'+
      '<div class="field full"><label>Description</label><textarea name="description">'+esc(t.description||'')+'</textarea></div>'+
      '<div class="field"><label>Category</label><input name="category" value="'+esc(t.category||'')+'" placeholder="Paperwork, Access, Training…"></div>'+
      '<div class="field"><label>Order</label><input name="sort_order" type="number" value="'+(t.sort_order||0)+'"></div>'+
      '<div class="field"><label>Required?</label><select name="is_required"><option value="true"'+(t.is_required!==false?' selected':'')+'>Required</option><option value="false"'+(t.is_required===false?' selected':'')+'>Optional</option></select></div>'+
      '<div class="field"><label>Status</label><select name="is_active"><option value="true"'+(t.is_active!==false?' selected':'')+'>Active</option><option value="false"'+(t.is_active===false?' selected':'')+'>Off</option></select></div>'+
      '<div class="field full"><label>Responsible</label>'+respSel+'</div>'+
      '</div>'+
      '<p style="margin:16px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5">'+
      (id?'Edits reach anyone who hasn\'t checked this step off yet. Steps already completed keep their original wording. Set it to Off instead of deleting if you want to retire it without touching existing checklists.'
         :'This step will be added to everyone currently in onboarding, and to everyone who joins from here on.')+'</p>',
    onSave:async(bg)=>{
      const title=val(bg,'title'); if(!title) throw new Error('Title is required');
      const r=bg.querySelector('[name="resp"]').value;
      const body={
        title, description:val(bg,'description')||null, category:val(bg,'category')||null,
        is_required: bg.querySelector('[name="is_required"]').value==='true',
        is_active: bg.querySelector('[name="is_active"]').value==='true',
        responsible_mode: (r==='unassigned'||r==='new_hire')?r:'specific',
        responsible_staff_id: (r==='unassigned'||r==='new_hire')?null:r
      };
      const movedCategory = !id || (t.category||null)!==body.category;
      if(movedCategory){
        const sibs=ONB_TPL.filter(x=>x.id!==id && (x.category||null)===body.category);
        body.sort_order = sibs.length ? Math.max.apply(null,sibs.map(x=>x.sort_order||0))+10 : 10;
      }
      if(id) await dbPatch('onboarding_template_items?id=eq.'+id,body);
      else await dbPost('onboarding_template_items',body);
      await loadOnboarding();
      toast(id?'Template step updated':'Step added to the template');
    }});
}

function tplDelete(id){
  const t=ONB_TPL.find(x=>x.id===id); if(!t) return;
  confirmDelete(esc(t.title),async()=>{
    await dbDel('onboarding_template_items?id=eq.'+id);
    await loadOnboarding();
    toast('Template step removed');
  });
}

async function loadMyOnboarding(){
  const items=await rpc('my_onboarding')||[];
  const status=items.length?items[0].onboarding_status:null;
  const reqTot=items.filter(i=>i.is_required).length;
  const reqDone=items.filter(i=>i.is_required&&i.is_complete).length;
  let cat=null;
  const list=items.map(i=>{
    let out='';
    const c=i.category||'Other';
    if(c!==cat){ cat=c; out+='<div class="onb-cat">'+esc(c)+'</div>'; }
    out+='<div class="onb-item'+(i.is_complete?' done':'')+'">'+
      '<input type="checkbox" disabled'+(i.is_complete?' checked':'')+'>'+
      '<div style="flex:1"><div class="onb-t">'+esc(i.title)+(i.is_required?'':' <span class="chip" style="font-size:10px">Optional</span>')+'</div>'+
      (i.description?'<div class="onb-d">'+esc(i.description)+'</div>':'')+
      (i.is_complete&&i.completed_at?'<div class="onb-d">Done '+fmtDate(i.completed_at)+'</div>':'')+
      '</div></div>';
    return out;
  }).join('');
  document.getElementById('content').innerHTML = items.length
    ? '<div class="panel" style="padding:22px 24px"><div style="max-width:660px">'+
        (status==='completed'?'<div style="margin-bottom:14px">'+badge('Onboarding complete','var(--green)')+'</div>':'')+
        onbBar(reqDone,reqTot)+
        '<div style="font-size:12.5px;color:var(--muted);margin:8px 0 2px">'+reqDone+' of '+reqTot+' required steps done. Your team checks these off as you go.</div>'+
        list+
      '</div></div>'
    : '<div class="empty"><h4>Nothing here yet</h4><p>You don\'t have any onboarding steps assigned.</p></div>';
}