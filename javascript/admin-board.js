let PROJECTS=[], CUR_PROJECT=null, TASKS=[];
const PROJ_SELECT='projects?select=*,owner:staff(id,name)&order=position.asc,created_at.asc';
async function loadBoard(){
  PROJECTS = await dbGet(PROJ_SELECT)||[];
  boardOverview();
}
function boardOverview(){
  CUR_PROJECT=null;
  topAction(ifCan('board','c','<button class="btn btn-primary" onclick="projectForm()">+ New project</button>'));
  const active=PROJECTS.filter(p=>(p.status||'active')==='active');
  const done=PROJECTS.filter(p=>p.status==='completed');
  if(!active.length&&!done.length){ document.getElementById('content').innerHTML='<div class="empty"><h4>No projects yet</h4><p>Create your first project to start tracking work.</p>'+ifCan('board','c','<button class="btn btn-primary" onclick="projectForm()">+ New project</button>')+'</div>'; return; }
  let html = active.length
    ? '<div class="proj-grid">'+active.map(p=>{const pr=PRIORITY[p.priority]||PRIORITY.medium;return '<div class="proj-card" onclick=\'openProject("'+p.id+'")\'><div class="proj-head"><div class="proj-name">'+esc(p.name)+'</div>'+badge(pr.label,pr.color)+'</div>'+(p.description?'<div class="proj-desc">'+esc(p.description)+'</div>':'<div class="proj-desc" style="color:var(--muted);font-style:italic">No description</div>')+'<div class="proj-meta">'+(p.due_date?'<span class="chip">Due '+fmtDate(p.due_date)+'</span>':'')+(p.owner?'<span class="chip">'+esc(p.owner.name)+'</span>':'<span class="chip" style="color:var(--muted)">No owner</span>')+'</div></div>';}).join('')+'</div>'
    : '<div class="empty" style="padding:30px"><p>No active projects.</p>'+ifCan('board','c','<button class="btn btn-primary" onclick="projectForm()">+ New project</button>')+'</div>';
  if(done.length){ html+='<h3 class="proj-section">Completed</h3><div class="panel"><div class="table-wrap"><table><tbody>'+done.map(p=>'<tr class="done-row" onclick=\'openProject("'+p.id+'")\'><td><strong>'+esc(p.name)+'</strong></td><td style="color:var(--muted)">'+(p.owner?esc(p.owner.name):'—')+'</td><td style="text-align:right;color:var(--muted)">'+(p.completed_at?'Completed '+fmtDate(p.completed_at):'Completed')+'</td></tr>').join('')+'</tbody></table></div></div>'; }
  document.getElementById('content').innerHTML=html;
}
function openProject(id){ CUR_PROJECT=id; topAction(ifCan('board','c','<button class="btn btn-primary" onclick="taskForm()">+ New task</button>')); renderBoard(); }

async function renderBoard(){
  const proj=PROJECTS.find(p=>p.id===CUR_PROJECT);
  if(!proj){ boardOverview(); return; }
  TASKS = await dbGet('tasks?select=*,assignee:profiles!tasks_assignee_id_fkey(name)&project_id=eq.'+CUR_PROJECT+'&order=position.asc,created_at.asc')||[];
  const pr=PRIORITY[proj.priority]||PRIORITY.medium, cols=Object.keys(STATUS);
  const statusBtn = proj.status==='completed'
    ? ifCan('board','u','<button class="btn btn-ghost btn-sm" onclick=\'setProjectStatus("'+proj.id+'","active")\'>Reopen</button>')
    : ifCan('board','u','<button class="btn btn-primary btn-sm" onclick=\'setProjectStatus("'+proj.id+'","completed")\'>Mark completed</button>');
  document.getElementById('content').innerHTML=
    '<button class="btn btn-ghost btn-sm" onclick="boardOverview()" style="margin-bottom:16px">&larr; All projects</button>'+
    '<div class="proj-detail"><div class="proj-detail-top"><h2 class="proj-detail-name">'+esc(proj.name)+'</h2>'+badge(pr.label,pr.color)+statusBtn+ifCan('board','u','<button class="btn btn-ghost btn-sm" onclick=\'projectForm("'+proj.id+'")\'>Edit</button>')+'</div>'+
    (proj.description?'<p class="proj-detail-desc">'+esc(proj.description)+'</p>':'')+
    '<div class="proj-detail-meta">'+(proj.due_date?'<span class="chip">Due '+fmtDate(proj.due_date)+'</span>':'')+(proj.owner?'<span class="chip">Owner: '+esc(proj.owner.name)+'</span>':'')+'</div></div>'+
    '<div class="board-top"><select onchange="openProject(this.value)">'+PROJECTS.filter(p=>p.status!=='archived').map(p=>'<option value="'+p.id+'"'+(p.id===CUR_PROJECT?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select><span class="count-pill" style="margin-left:auto">'+TASKS.length+' tasks</span></div>'+
    '<div class="board">'+cols.map(st=>{const items=TASKS.filter(t=>t.status===st);return '<div class="col" data-status="'+st+'"><div class="col-head"><span class="dot" style="background:'+STATUS[st].color+'"></span>'+STATUS[st].label+'<span class="n">'+items.length+'</span></div><div class="col-body">'+items.map(taskCard).join('')+'</div>'+ifCan('board','c','<button class="add-task" onclick=\'taskForm(null,"'+st+'")\'>+ Add task</button>')+'</div>';}).join('')+'</div>';
  wireDnD();
}

async function setProjectStatus(id,status){
  await dbPatch('projects?id=eq.'+id,{status,completed_at:status==='completed'?new Date().toISOString():null});
  PROJECTS=await dbGet(PROJ_SELECT)||[];
  if(status==='completed') boardOverview(); else renderBoard();
  toast(status==='completed'?'Project completed':'Project reopened');
}
function taskCard(t){
  const p=PRIORITY[t.priority]||PRIORITY.medium;
  return '<div class="task" draggable="true" data-id="'+t.id+'" onclick="taskDetail(\''+t.id+'\')">'+
    '<div class="t-title">'+esc(t.title)+'</div>'+
    '<div class="t-meta">'+badge(p.label,p.color)+
      (t.due_date?'<span class="mono" style="font-size:11px;color:var(--muted)">'+fmtDate(t.due_date)+'</span>':'')+
      (t.assignee?'<span class="t-assignee"><span class="mini-avatar">'+initials(t.assignee.name)+'</span></span>':'')+
    '</div></div>';
}
let dragId=null;
function wireDnD(){
  document.querySelectorAll('.task').forEach(el=>{
    el.addEventListener('dragstart',e=>{dragId=el.dataset.id;el.classList.add('dragging');e.stopPropagation();});
    el.addEventListener('dragend',()=>{el.classList.remove('dragging');});
  });
  document.querySelectorAll('.col').forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('drag-over');});
    col.addEventListener('dragleave',()=>col.classList.remove('drag-over'));
    col.addEventListener('drop',async e=>{
      e.preventDefault();col.classList.remove('drag-over');
      const st=col.dataset.status;const t=TASKS.find(x=>x.id===dragId);
      if(!t||t.status===st)return;
      t.status=st;
      try{await dbPatch('tasks?id=eq.'+dragId,{status:st,updated_at:new Date().toISOString()});renderBoard();}
      catch(err){toast('Could not move task',true);}
    });
  });
}
async function projectForm(id){
  const p=id?PROJECTS.find(x=>x.id===id):{};
  const staffList=await dbGet('staff?select=id,name&order=name.asc')||[];
  const opt=(o,cur)=>Object.keys(o).map(k=>'<option value="'+k+'"'+(cur===k?' selected':'')+'>'+o[k].label+'</option>').join('');
  modal({title:id?'Edit project':'New project',wide:true,saveLabel:id?'Save':'Create project',
    body:'<div class="form-grid"><div class="field full"><label>Project name</label><input name="name" value="'+esc(p.name||'')+'"></div>'+
      '<div class="field"><label>Priority</label><select name="priority">'+opt(PRIORITY,p.priority||'medium')+'</select></div>'+
      '<div class="field"><label>Due date</label><input name="due_date" type="date" value="'+esc(p.due_date||'')+'"></div>'+
      '<div class="field"><label>Owner</label><select name="owner_id"><option value="">— none —</option>'+staffList.map(st=>'<option value="'+st.id+'"'+(p.owner_id===st.id?' selected':'')+'>'+esc(st.name)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Status</label><select name="status"><option value="active"'+((p.status||'active')==='active'?' selected':'')+'>Active</option><option value="completed"'+(p.status==='completed'?' selected':'')+'>Completed</option><option value="archived"'+(p.status==='archived'?' selected':'')+'>Archived</option></select></div>'+
      '<div class="field full"><label>Description</label><textarea name="description">'+esc(p.description||'')+'</textarea></div></div>'+
      (id?'<button class="btn btn-danger btn-sm" style="margin-top:14px" onclick=\'projectDelete("'+id+'")\'>Delete project</button>':''),
    onSave:async(bg)=>{
      const statusVal=bg.querySelector('[name="status"]').value;
      const body={name:val(bg,'name'),description:val(bg,'description'),priority:bg.querySelector('[name="priority"]').value,due_date:val(bg,'due_date')||null,owner_id:bg.querySelector('[name="owner_id"]').value||null,status:statusVal,completed_at:statusVal==='completed'?(p.completed_at||new Date().toISOString()):null};
      if(!body.name)throw new Error('Project name is required');
      if(id){ await dbPatch('projects?id=eq.'+id,body); PROJECTS=await dbGet(PROJ_SELECT)||[]; if(CUR_PROJECT)renderBoard(); else boardOverview(); toast('Project updated'); }
      else{ body.created_by=ME.id; const r=await dbPost('projects',body); PROJECTS=await dbGet(PROJ_SELECT)||[]; openProject(r[0].id); toast('Project created'); }
    }});
}
function projectDelete(id){
  document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
  confirmDelete('this project and its tasks',async()=>{
    await dbDel('projects?id=eq.'+id);CUR_PROJECT=null;loadBoard();toast('Project deleted');});
}
function taskForm(id,presetStatus){
  const t=id?TASKS.find(x=>x.id===id):{status:presetStatus||'todo'};
  const opt=(o,cur)=>Object.keys(o).map(k=>'<option value="'+k+'"'+(cur===k?' selected':'')+'>'+o[k].label+'</option>').join('');
  modal({title:id?'Edit task':'New task',wide:true,saveLabel:id?'Save':'Create task',
    body:'<div class="form-grid">'+
      '<div class="field full"><label>Title</label><input name="title" value="'+esc(t.title||'')+'"></div>'+
      '<div class="field"><label>Status</label><select name="status">'+opt(STATUS,t.status)+'</select></div>'+
      '<div class="field"><label>Priority</label><select name="priority">'+opt(PRIORITY,t.priority||'medium')+'</select></div>'+
      '<div class="field"><label>Assignee</label><select name="assignee_id"><option value="">— unassigned —</option>'+ADMINS.map(a=>'<option value="'+a.id+'"'+(t.assignee_id===a.id?' selected':'')+'>'+esc(a.name||a.email)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Due date</label><input name="due_date" type="date" value="'+esc(t.due_date||'')+'"></div>'+
      '<div class="field full"><label>Description</label><textarea name="description">'+esc(t.description||'')+'</textarea></div>'+
    '</div>',
    onSave:async(bg)=>{
      const body={title:val(bg,'title'),status:bg.querySelector('[name="status"]').value,
        priority:bg.querySelector('[name="priority"]').value,
        assignee_id:bg.querySelector('[name="assignee_id"]').value||null,
        due_date:val(bg,'due_date')||null,description:val(bg,'description'),
        updated_at:new Date().toISOString()};
      if(!body.title)throw new Error('Title is required');
      if(id)await dbPatch('tasks?id=eq.'+id,body);
      else{body.project_id=CUR_PROJECT;body.created_by=ME.id;await dbPost('tasks',body);}
      renderBoard();toast(id?'Task updated':'Task created');
    }});
}
async function taskDetail(id){
  const t=TASKS.find(x=>x.id===id);if(!t)return;
  const st=STATUS[t.status]||STATUS.todo,p=PRIORITY[t.priority]||PRIORITY.medium;
  const m=modal({title:t.title,wide:true,footer:false,
    body:'<div class="hs-wrap">'+
        (headshotSrc(s.headshot)
          ? '<img class="hs-img" src="'+esc(headshotSrc(s.headshot))+'" alt="" data-ini="'+esc(initials(s.name))+'">'
          : '<span class="hs-none">'+initials(s.name)+'</span>')+
        '<div class="hs-side"><div class="hs-lbl">Headshot</div>'+
        (s.headshot
          ? '<div class="hs-link"><span class="hs-url" id="hsUrl">'+esc(headshotAbs(s.headshot))+'</span>'+
            '<button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(document.getElementById(\'hsUrl\').textContent).then(()=>toast(\'Link copied\'))">Copy link</button></div>'
          : '<div style="font-size:13px;color:var(--muted)">None set. Commit an image to <span class="mono">assets/staff/</span> and put the filename on the staff record.</div>')+
        '</div></div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'+
      (t.assignee?'<span class="chip">'+esc(t.assignee.name)+'</span>':'')+
      (t.due_date?'<span class="chip">Due '+fmtDate(t.due_date)+'</span>':'')+'</div>'+
      (t.description?'<p style="line-height:1.6;color:#333;white-space:pre-wrap;margin:0 0 6px">'+esc(t.description)+'</p>':'<p style="color:var(--muted);margin:0 0 6px">No description.</p>')+
      '<div style="display:flex;gap:8px;margin:14px 0 8px">'+ifCan('board','u','<button class="btn btn-ghost btn-sm" onclick=\'document.querySelectorAll(".modal-bg").forEach(x=>x.remove());taskForm("'+t.id+'")\'>Edit task</button>')+
      ifCan('board','d','<button class="btn btn-danger btn-sm" onclick=\'taskDelete("'+t.id+'")\'>Delete</button>')+'</div>'+
      '<h4 style="font-size:14px;color:var(--navy);margin:20px 0 4px">Comments</h4>'+
      '<div id="comments"><div class="loading" style="padding:16px">Loading…</div></div>'+
      '<div class="add-comment"><input id="cInput" placeholder="Write a comment…"><button class="btn btn-primary btn-sm" onclick="postComment(\''+t.id+'\')">Post</button></div>'
  });
  m.el.querySelector('#cInput').addEventListener('keydown',e=>{if(e.key==='Enter')postComment(t.id);});
  loadComments(t.id);
}
async function loadComments(taskId){
  const box=document.querySelector('#comments');if(!box)return;
  const rows = await dbGet('task_comments?select=*,author:profiles(name)&task_id=eq.'+taskId+'&order=created_at.asc')||[];
  box.innerHTML = rows.length? rows.map(c=>
    '<div class="comment"><span class="mini-avatar">'+initials(c.author?c.author.name:'?')+'</span>'+
    '<div class="body"><span class="who">'+esc(c.author?c.author.name:'Admin')+'</span><span class="when">'+timeAgo(c.created_at)+'</span>'+
    (c.author_id===ME.id||ME.admin_level>=9?'<button class="del" onclick=\'delComment("'+c.id+'","'+taskId+'")\'>Delete</button>':'')+
    '<p>'+esc(c.body)+'</p></div></div>').join('')
    : '<p style="color:var(--muted);font-size:13.5px;padding:6px 0">No comments yet — start the thread.</p>';
}
async function postComment(taskId){
  const inp=document.querySelector('#cInput');const body=inp.value.trim();if(!body)return;
  inp.value='';
  try{await dbPost('task_comments',{task_id:taskId,author_id:ME.id,body});loadComments(taskId);}
  catch(e){toast('Comment failed',true);inp.value=body;}
}
async function delComment(id,taskId){await dbDel('task_comments?id=eq.'+id);loadComments(taskId);}
function taskDelete(id){
  document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
  confirmDelete('this task',async()=>{await dbDel('tasks?id=eq.'+id);renderBoard();toast('Task deleted');});
}