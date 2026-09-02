async function loadDashboard(){
  const [staff,subs,shows,channels,tasks] = await Promise.all([
    dbGet('staff?select=id,is_active'),
    dbGet('subscribers?select=id,is_active'),
    dbGet('shows?select=id'),
    dbGet('channels?select=id'),
    dbGet('tasks?select=id,status')
  ]);
  const activeTasks=(tasks||[]).filter(t=>t.status!=='done').length;
  const lastLogins = await lastLoginHtml();
  const recentTasks = await dbGet('tasks?select=title,status,updated_at,project:projects(name)&order=updated_at.desc&limit=6')||[];
  let onbCount=null;
  if(can('onboarding','r')){ try{ onbCount=((await rpc('onboarding_list',{p_include_completed:false}))||[]).length; }catch(e){ onbCount=null; } }

  const stat=(k,v,color)=>'<div class="stat"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="bar" style="background:'+color+'"></div></div>';
  document.getElementById('content').innerHTML =
    '<div class="cards">'+
      stat('Staff',(staff||[]).length,'var(--orange)')+
      (onbCount===null?'':stat('In onboarding',onbCount,'var(--yellow)'))+
      stat('Subscribers',(subs||[]).length,'var(--aqua)')+
      stat('Shows',(shows||[]).length,'var(--violet)')+
      stat('Channels',(channels||[]).length,'var(--pink)')+
      stat('Open tasks',activeTasks,'var(--sky)')+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="panel"><div class="panel-head"><h3>Recent activity</h3></div>'+
        (recentTasks.length? '<div class="table-wrap"><table><tbody>'+recentTasks.map(t=>
          '<tr><td>'+esc(t.title)+'<div style="font-size:12px;color:var(--muted)">'+esc(t.project?t.project.name:'')+'</div></td>'+
          '<td>'+badge(STATUS[t.status]?STATUS[t.status].label:t.status,STATUS[t.status]?STATUS[t.status].color:'var(--muted)')+'</td>'+
          '<td class="mono" style="color:var(--muted);text-align:right">'+timeAgo(t.updated_at)+'</td></tr>').join('')+
          '</tbody></table></div>' : '<div class="empty" style="padding:30px"><p>No tasks yet. Head to the Project Board to start one.</p></div>')+
      '</div>'+
      '<div class="panel"><div class="panel-head"><h3>Last login</h3></div>'+
        '<div style="padding:0 16px 8px">'+lastLogins+'</div>'+
      '</div>'+
    '</div>';
}
