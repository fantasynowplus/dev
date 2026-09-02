let SHOWS=[];
async function loadShows(){
  topAction(ifCan('shows','c','<button class="btn btn-primary" onclick="showForm()">+ Add show</button>'));
  CHANNELS_CACHE = await dbGet('channels?select=id,name&order=name.asc')||[];
  SHOWS = await dbGet('shows?select=*,channel:channels(name),host_links:show_hosts(staff(id,name))&order=name.asc')||[];
  renderShows('');
}
function renderShows(q){
  const rows=SHOWS.filter(s=>!q||[s.name,s.content_type,(s.host_links||[]).map(h=>h.staff&&h.staff.name).join(' ')].some(v=>(v||'').toLowerCase().includes(q)));
  document.getElementById('content').innerHTML =
    toolbar('Search shows…','<span class="count-pill" style="margin-left:auto">'+rows.length+' shows</span>')+
    '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Show</th><th>Type</th><th>Hosts</th><th>Schedule</th><th>Channel</th><th>Status</th><th></th></tr></thead><tbody>'+
    (rows.length? rows.map(s=>
      '<tr><td><strong>'+esc(s.name)+'</strong></td>'+
      '<td>'+(s.content_type?badge(s.content_type,accentFor(s.content_type)):'—')+'</td>'+
      '<td>'+((s.host_links&&s.host_links.length)?s.host_links.map(h=>'<span class="chip">'+esc(h.staff?h.staff.name:'')+'</span>').join(''):'—')+'</td>'+
      '<td>'+esc(s.schedule_day||'—')+'</td>'+
      '<td>'+esc(s.channel?s.channel.name:'—')+'</td>'+
      '<td>'+(s.is_active!==false?badge('Active','var(--green)'):badge('Off air','var(--muted)'))+'</td>'+
      '<td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick=\'viewShow("'+s.id+'")\'>View</button>'+ifCan('shows','u','<button class="btn btn-ghost btn-sm" onclick=\'showForm("'+s.id+'")\'>Edit</button>')+
      ifCan('shows','d','<button class="btn btn-danger btn-sm" onclick=\'showDelete("'+s.id+'")\'>Delete</button>')+'</div></td></tr>').join('')
      : '<tr><td colspan="7"><div class="empty"><h4>No shows yet</h4><p>Add a show and assign it to one of your channels.</p>'+ifCan('shows','c','<button class="btn btn-primary" onclick="showForm()">+ Add show</button>')+'</div></td></tr>')+
    '</tbody></table></div></div>';
  bindSearch(renderShows);
}

async function showForm(id){
  const s=id?SHOWS.find(x=>x.id===id):{};
  const days=['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const types=['','Podcast','Live Stream','Short','VOD','Interview','Recap'];
  const staffList = await dbGet('staff?select=id,name&order=name.asc')||[];
  const currentHosts = new Set((s.host_links||[]).map(h=>h.staff&&h.staff.id).filter(Boolean));
  const hostPicker = staffList.length
    ? '<div class="pick-list" style="max-height:200px">'+staffList.map(st=>'<label class="pick"><input type="checkbox" data-host="'+st.id+'"'+(currentHosts.has(st.id)?' checked':'')+'><span class="pk-name">'+esc(st.name)+'</span></label>').join('')+'</div>'
    : '<div style="font-size:13px;color:var(--muted)">Add staff members first to assign them as hosts.</div>';
  modal({title:id?'Edit show':'Add show',wide:true,saveLabel:id?'Save changes':'Add show',
    body:'<div class="form-grid">'+
      '<div class="field"><label>Show name</label><input name="name" value="'+esc(s.name||'')+'"></div>'+
      '<div class="field"><label>Content type</label><select name="content_type">'+types.map(t=>'<option'+(s.content_type===t?' selected':'')+'>'+t+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Schedule day</label><select name="schedule_day">'+days.map(d=>'<option'+(s.schedule_day===d?' selected':'')+'>'+d+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Channel</label><select name="channel_id"><option value="">— none —</option>'+CHANNELS_CACHE.map(c=>'<option value="'+c.id+'"'+(s.channel_id===c.id?' selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Status</label><select name="is_active"><option value="true"'+(s.is_active!==false?' selected':'')+'>Active</option><option value="false"'+(s.is_active===false?' selected':'')+'>Off air</option></select></div>'+
      '<div class="field full"><label>Hosts</label>'+hostPicker+'</div>'+
      '<div class="field full"><label>Description</label><textarea name="description">'+esc(s.description||'')+'</textarea></div>'+
    '</div>',
    onSave:async(bg)=>{
      const body={name:val(bg,'name'),content_type:val(bg,'content_type')||null,
        schedule_day:val(bg,'schedule_day')||null,channel_id:val(bg,'channel_id')||null,
        description:val(bg,'description'),is_active:bg.querySelector('[name="is_active"]').value==='true'};
      if(!body.name)throw new Error('Show name is required');
      let showId=id;
      if(id){ await dbPatch('shows?id=eq.'+id,body); }
      else{ const r=await dbPost('shows',body); showId=r[0].id; }
      const hostIds=[...bg.querySelectorAll('input[data-host]:checked')].map(c=>c.dataset.host);
      await dbDel('show_hosts?show_id=eq.'+showId);
      if(hostIds.length) await dbPost('show_hosts', hostIds.map(sid=>({show_id:showId,staff_id:sid})));
      SHOWS = await dbGet('shows?select=*,channel:channels(name),host_links:show_hosts(staff(id,name))&order=name.asc')||[];
      renderShows('');toast(id?'Show updated':'Show added');
    }});
}

function showDelete(id){const s=SHOWS.find(x=>x.id===id);confirmDelete(esc(s.name),async()=>{
  await dbDel('shows?id=eq.'+id);SHOWS=SHOWS.filter(x=>x.id!==id);renderShows('');toast('Show removed');});}
