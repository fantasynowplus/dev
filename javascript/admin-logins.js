let LOGINS = [];
async function loadLogins(){
  LOGINS = await rpc('login_activity') || [];
  renderLogins('');
}
function loginBucket(d){
  if(!d) return 'never';
  const days = (Date.now() - new Date(d)) / 86400000;
  if(days <= 7) return 'week';
  if(days <= 30) return 'month';
  return 'old';
}
function renderLogins(q){
  const rows = LOGINS.filter(u=>!q||[u.name,u.email,u.job_title].some(v=>(v||'').toLowerCase().includes(q)));
  const n = b => LOGINS.filter(u=>loginBucket(u.last_seen)===b).length;
  const stat=(k,v,color)=>'<div class="stat"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="bar" style="background:'+color+'"></div></div>';
  document.getElementById('content').innerHTML =
    '<div class="cards">'+
      stat('Total users',LOGINS.length,'var(--orange)')+
      stat('Last 7 days',n('week'),'var(--green)')+
      stat('Last 30 days',n('week')+n('month'),'var(--aqua)')+
      stat('Never logged in',n('never'),'var(--muted)')+
    '</div>'+
    toolbar('Search users\u2026','<span class="count-pill" style="margin-left:auto">'+rows.length+' of '+LOGINS.length+'</span>')+
    '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Last login</th></tr></thead><tbody>'+
    (rows.length ? rows.map(u=>
      '<tr><td><div style="display:flex;align-items:center;gap:9px">'+
        avatarHtml({name:u.name, headshot:u.avatar_url},'mini-avatar',accentFor(u.name||u.email||'?'))+
        '<strong>'+esc(u.name||'\u2014')+'</strong></div>'+
        (u.job_title?'<div style="font-size:12px;color:var(--muted);padding-left:29px">'+esc(u.job_title)+'</div>':'')+
      '</td>'+
      '<td>'+esc(u.email||'\u2014')+'</td>'+
      '<td>'+(u.is_staff?badge('Staff','var(--orange)'):badge('Member','var(--sky)'))+'</td>'+
      '<td>'+(u.last_seen
        ? '<strong>'+esc(timeAgo(u.last_seen))+'</strong><div style="font-size:12px;color:var(--muted)">'+fmtDate(u.last_seen)+'</div>'
        : badge('Never','var(--muted)'))+'</td></tr>').join('')
      : '<tr><td colspan="4"><div class="empty"><h4>No users match</h4></div></td></tr>')+
    '</tbody></table></div></div>';
  bindSearch(renderLogins);
}

async function lastLoginHtml(){
  let rows = [];
  try { rows = await rpc('recent_logins', { p_limit: 6 }) || []; } catch(e) { rows = []; }
  if(!rows.length) return '<div class="empty">No logins recorded yet.</div>';
  return rows.map(r => {
    const nm = r.name || r.email || 'Unknown';
    return '<div class="ll-row">'+
      avatarHtml({name:nm, headshot:r.avatar_url}, 'll-av', accentFor(nm))+
      '<div style="min-width:0">'+
        '<div class="ll-name">'+esc(nm)+'</div>'+
        '<div class="ll-title">'+esc(r.job_title || '\u2014')+'</div>'+
      '</div>'+
      '<div class="ll-when">'+esc(timeAgo(r.last_seen))+'</div>'+
    '</div>';
  }).join('');
}
