let ORG=[];
let ORG_TEAMS=[];
let ORG_TAB='chart';

async function loadOrg(){
  ORG = await rpc('org_chart')||[];
  try{ ORG_TEAMS = await dbGet('teams?select=*&order=name.asc')||[]; }catch(e){ ORG_TEAMS=[]; }
  renderOrg();
}

function orgTab(t){ ORG_TAB=t; renderOrg(); }

function renderOrg(){
  topAction(ORG_TAB==='teams' ? ifCan('org','c','<button class="btn btn-primary" onclick="teamForm()">+ New team</button>') : '');
  const tabs='<div class="onb-tabs">'+
    '<button class="'+(ORG_TAB==='chart'?'on':'')+'" onclick="orgTab(\'chart\')">Chart</button>'+
    '<button class="'+(ORG_TAB==='teams'?'on':'')+'" onclick="orgTab(\'teams\')">Teams<span class="count-pill" style="margin-left:8px">'+ORG_TEAMS.length+'</span></button>'+
    '</div>';
  document.getElementById('content').innerHTML = tabs + (ORG_TAB==='teams' ? orgTeamsHtml() : orgChartHtml());
}

function orgCard(s){
  return '<div class="org-card" onclick=\'viewStaff("'+s.id+'")\'>'+
    avatarHtml(s,'org-avatar',accentFor(s.name))+
    '<div class="org-name">'+esc(s.name)+'</div>'+
    (s.job_title?'<div class="org-role">'+esc(s.job_title)+'</div>':'')+
    (s.department?'<div class="org-dept">'+esc(s.department)+'</div>':'')+
  '</div>';
}

function orgTeamCard(t,count){
  const click = can('org','u') ? ' onclick=\'teamForm("'+t.id+'")\'' : '';
  return '<div class="org-team"'+click+'>'+
    '<div class="org-team-name">'+esc(t.name)+'</div>'+
    '<div class="org-team-count">'+count+(count===1?' person':' people')+'</div>'+
  '</div>';
}

function orgChartHtml(){
  const people=ORG.filter(s=>s.is_active!==false);
  if(!people.length) return '<div class="empty"><h4>No staff to chart</h4><p>Add active staff, then set who each person reports to on their staff record.</p></div>';
  const byId={}; people.forEach(s=>byId[s.id]=s);
  const teams=ORG_TEAMS.filter(t=>t.is_active!==false);
  const teamById={}; teams.forEach(t=>teamById[t.id]=t);

  const teamsByLead={}, membersByTeam={}, reports={};
  teams.forEach(t=>{
    if(t.lead_staff_id && byId[t.lead_staff_id]) (teamsByLead[t.lead_staff_id]=teamsByLead[t.lead_staff_id]||[]).push(t);
  });
  people.forEach(s=>{
    if(s.team_id && teamById[s.team_id] && teamById[s.team_id].lead_staff_id!==s.id){
      (membersByTeam[s.team_id]=membersByTeam[s.team_id]||[]).push(s); return;
    }
    const key=(s.manager_id && byId[s.manager_id] && s.manager_id!==s.id) ? s.manager_id : '__root';
    (reports[key]=reports[key]||[]).push(s);
  });

  const seen={}, teamSeen={};
    const personNode=(s,stacked)=>{
    if(seen[s.id]) return '';
    seen[s.id]=1;
    const ch=(teamsByLead[s.id]||[]).map(t=>teamNode(t)).join('')+(reports[s.id]||[]).map(x=>personNode(x,stacked)).join('');
    return '<div class="org-node'+(ch&&stacked?' stack':'')+'">'+orgCard(s)+
      (ch?'<div class="org-children'+(stacked?' stacked':'')+'">'+ch+'</div>':'')+'</div>';
  };
  const teamNode=(t)=>{
    if(teamSeen[t.id]) return '';
    teamSeen[t.id]=1;
    const mem=membersByTeam[t.id]||[];
    const ch=mem.map(x=>personNode(x,true)).join('');
    return '<div class="org-node'+(ch?' stack':'')+'">'+orgTeamCard(t,mem.length)+
      (ch?'<div class="org-children stacked">'+ch+'</div>':'')+'</div>';
  };

    let html=(reports['__root']||[]).map(x=>personNode(x)).join('');
  html+=teams.filter(t=>!teamSeen[t.id] && (membersByTeam[t.id]||[]).length).map(t=>teamNode(t)).join('');
  const stranded=people.filter(s=>!seen[s.id]);
  if(stranded.length) html+=stranded.map(x=>personNode(x)).join('');

  const unmanaged=(reports['__root']||[]).length;
  return '<div class="panel" style="padding:4px 0"><div class="org-wrap"><div class="org-roots">'+html+'</div></div></div>'+
    '<div style="font-size:12.5px;color:var(--muted);margin-top:12px;text-align:center">'+
      people.length+' active staff'+(unmanaged>1?' · '+unmanaged+' not placed yet — set "Reports to" or a Team on their staff record':'')+
    '</div>';
}

function orgTeamsHtml(){
  const counts={};
  ORG.filter(s=>s.is_active!==false).forEach(s=>{ if(s.team_id) counts[s.team_id]=(counts[s.team_id]||0)+1; });
  const body=ORG_TEAMS.length? ORG_TEAMS.map(t=>{
    const lead=ORG.find(x=>x.id===t.lead_staff_id);
    return '<tr><td><strong>'+esc(t.name)+'</strong>'+(t.description?'<div style="font-size:12px;color:var(--muted)">'+esc(t.description)+'</div>':'')+'</td>'+
      '<td>'+(lead?'<span class="chip-link" onclick=\'viewStaff("'+lead.id+'")\'>'+esc(lead.name)+'</span>':'—')+'</td>'+
      '<td class="mono">'+(counts[t.id]||0)+'</td>'+
      '<td>'+(t.is_active!==false?badge('Active','var(--green)'):badge('Off','var(--muted)'))+'</td>'+
      '<td><div class="row-actions">'+
        ifCan('org','u','<button class="btn btn-ghost btn-sm" onclick=\'teamForm("'+t.id+'")\'>Edit</button>')+
        ifCan('org','d','<button class="btn btn-danger btn-sm" onclick=\'teamDelete("'+t.id+'")\'>Delete</button>')+
      '</div></td></tr>';
  }).join('')
  : '<tr><td colspan="5"><div class="empty"><h4>No teams yet</h4><p>Create a team, give it a lead, then set people\'s Team on their staff record.</p>'+ifCan('org','c','<button class="btn btn-primary" onclick="teamForm()">+ New team</button>')+'</div></td></tr>';
  return '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Team</th><th>Lead</th><th>People</th><th>Status</th><th></th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

function teamForm(id){
  const t = id ? ORG_TEAMS.find(x=>x.id===id) : {is_active:true};
  if(!t) return;
  const staffOpts=ORG.filter(x=>x.is_active!==false);
  modal({title:id?'Edit team':'New team',wide:true,saveLabel:id?'Save team':'Create team',
    body:'<div class="form-grid">'+
      '<div class="field full"><label>Team name</label><input name="name" value="'+esc(t.name||'')+'"></div>'+
      '<div class="field full"><label>Description</label><textarea name="description">'+esc(t.description||'')+'</textarea></div>'+
      '<div class="field"><label>Team lead</label><select name="lead_staff_id"><option value="">— nobody —</option>'+
        staffOpts.map(x=>'<option value="'+x.id+'"'+(t.lead_staff_id===x.id?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Status</label><select name="is_active"><option value="true"'+(t.is_active!==false?' selected':'')+'>Active</option><option value="false"'+(t.is_active===false?' selected':'')+'>Off</option></select></div>'+
      '</div>'+
      '<p style="margin:16px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5">The team hangs under its lead in the chart. Put people on it by setting their Team on their staff record.</p>',
    onSave:async(bg)=>{
      const name=val(bg,'name'); if(!name) throw new Error('Team name is required');
      const body={name, description:val(bg,'description')||null,
        lead_staff_id: bg.querySelector('[name="lead_staff_id"]').value||null,
        is_active: bg.querySelector('[name="is_active"]').value==='true'};
      if(id) await dbPatch('teams?id=eq.'+id,body); else await dbPost('teams',body);
      await loadOrg();
      toast(id?'Team updated':'Team created');
    }});
}

function teamDelete(id){
  const t=ORG_TEAMS.find(x=>x.id===id); if(!t) return;
  confirmDelete(esc(t.name),async()=>{
    await dbDel('teams?id=eq.'+id);
    await loadOrg();
    toast('Team deleted — its people are now unassigned');
  });
}