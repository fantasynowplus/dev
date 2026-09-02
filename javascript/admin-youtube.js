function ytSwitchTab(btn,paneId){
  const m=btn.closest('.modal');
  m.querySelectorAll('.yt-pane').forEach(p=>p.style.display='none');
  document.getElementById(paneId).style.display='';
  btn.parentElement.querySelectorAll('.yt-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
}
function ytHuman(kind,label){
  const traffic={YT_SEARCH:'YouTube search',RELATED_VIDEO:'Suggested videos',BROWSE:'Browse features',NO_LINK_OTHER:'Direct or unknown',NO_LINK_EMBEDDED:'External embeds',PLAYLIST:'Playlists',YT_CHANNEL:'Channel pages',SUBSCRIBER:'Subscriptions feed',EXT_URL:'External sites',NOTIFICATION:'Notifications',SHORTS:'Shorts feed',YT_OTHER_PAGE:'Other YouTube',ADVERTISING:'Advertising',HASHTAGS:'Hashtags',END_SCREEN:'End screens',ANNOTATION:'Cards & end screens'};
  const device={MOBILE:'Mobile',DESKTOP:'Desktop',TABLET:'Tablet',TV:'TV',GAME_CONSOLE:'Game console',UNKNOWN_PLATFORM:'Unknown'};
  const subbed={SUBSCRIBED:'Subscribed',UNSUBSCRIBED:'Not subscribed'};
  if(kind==='traffic')return traffic[label]||label;
  if(kind==='device')return device[label]||label;
  if(kind==='subscribed')return subbed[label]||label;
  if(kind==='age_gender'){const p=label.split('|');return (p[0]||'').replace('age','')+' · '+({male:'M',female:'F',user_specified:'—',gender_other:'Other'}[p[1]]||p[1]);}
  return label;
}
const fmtHours=m=>Math.round((Number(m)||0)/60).toLocaleString();
const fmtDur=s=>{s=Number(s)||0;const m=Math.floor(s/60);return m+':'+String(Math.round(s%60)).padStart(2,'0');};
function sumWindow(daily,days,field){const c=new Date();c.setDate(c.getDate()-days);const cs=c.toISOString().slice(0,10);return daily.filter(r=>r.date>=cs).reduce((a,r)=>a+(Number(r[field])||0),0);}
function netSubs(daily,days){return sumWindow(daily,days,'subs_gained')-sumWindow(daily,days,'subs_lost');}
function metricBlock(label,a,b,c){return '<div class="yt-metric"><div class="m-label">'+label+'</div><div class="m-row"><span>28 days</span><span>'+a+'</span></div><div class="m-row"><span>90 days</span><span>'+b+'</span></div><div class="m-row"><span>365 days</span><span>'+c+'</span></div></div>';}
function barList(items){if(!items.length)return '<div style="color:var(--muted);font-size:13px">No data yet.</div>';const max=Math.max(...items.map(i=>i.value))||1;return '<div class="bar-list">'+items.map(i=>'<div class="bar-row"><div class="b-label" title="'+esc(i.label)+'">'+esc(i.label)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.max(2,Math.round(i.value/max*100))+'%'+(i.color?';background:'+i.color:'')+'"></div></div><div class="b-val">'+esc(i.valueLabel!=null?i.valueLabel:fmtNum(i.value))+'</div></div>').join('')+'</div>';}
function lineChart(daily,field,days){const c=new Date();c.setDate(c.getDate()-days);const cs=c.toISOString().slice(0,10);const pts=daily.filter(r=>r.date>=cs).map(r=>Number(r[field])||0);if(pts.length<2)return '<div style="color:var(--muted);font-size:13px;padding:12px 0">Not enough data to chart yet.</div>';const w=560,h=120,min=Math.min(...pts),max=Math.max(...pts),rng=(max-min)||1,step=w/(pts.length-1);const coords=pts.map((v,i)=>[i*step,h-6-((v-min)/rng)*(h-16)]);const line=coords.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');return '<svg class="ytchart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><path d="'+line+' L '+w+' '+h+' L 0 '+h+' Z" fill="var(--orange)" opacity="0.10"/><path d="'+line+'" fill="none" stroke="var(--orange)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';}

async function channelAnalytics(id){
  document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
  const [chRow,daily,tops,breaks,snap]=await Promise.all([
    dbGet('channels?select=name&id=eq.'+id),
    dbGet('yt_daily?select=date,views,watch_minutes,subs_gained,subs_lost&channel_id=eq.'+id+'&order=date.asc'),
    dbGet('yt_top_videos?select=*&channel_id=eq.'+id+'&order=views.desc'),
    dbGet('yt_breakdowns?select=*&channel_id=eq.'+id),
    dbGet('youtube_stats?select=subscriber_count,view_count,video_count,fetched_at&channel_id=eq.'+id+'&order=fetched_at.desc&limit=1')
  ]);
  const name=(chRow&&chRow[0]&&chRow[0].name)||'Channel', d=daily||[], latest=(snap&&snap[0])||{};
  const byKind=k=>(breaks||[]).filter(b=>b.kind===k);
  const overview='<div class="yt-metrics">'+
    metricBlock('Views',fmtNum(sumWindow(d,28,'views')),fmtNum(sumWindow(d,90,'views')),fmtNum(sumWindow(d,365,'views')))+
    metricBlock('Watch time (hrs)',fmtHours(sumWindow(d,28,'watch_minutes')),fmtHours(sumWindow(d,90,'watch_minutes')),fmtHours(sumWindow(d,365,'watch_minutes')))+
    metricBlock('Subscribers (net)',(netSubs(d,28)>=0?'+':'')+fmtNum(netSubs(d,28)),(netSubs(d,90)>=0?'+':'')+fmtNum(netSubs(d,90)),(netSubs(d,365)>=0?'+':'')+fmtNum(netSubs(d,365)))+'</div>'+
    '<div class="yt-section-title">Views — last 90 days</div>'+lineChart(d,'views',90)+
    '<div class="yt-section-title">Top videos — last 90 days</div>'+
    ((tops&&tops.length)?tops.map((v,i)=>'<div class="topvid"><span class="tv-n">'+(i+1)+'</span><a class="tv-title" href="https://www.youtube.com/watch?v='+encodeURIComponent(v.video_id)+'" target="_blank" rel="noopener" title="'+esc(v.title)+'">'+esc(v.title)+'</a><span class="tv-stat">'+fmtNum(v.views)+' views · '+fmtDur(v.avg_view_duration)+' avg</span></div>').join(''):'<div style="color:var(--muted);font-size:13px">No video data yet.</div>');
  const traffic=byKind('traffic').map(b=>({label:ytHuman('traffic',b.label),value:Number(b.views)})).sort((a,b)=>b.value-a.value);
  const content='<div class="yt-section-title">How viewers find you — last 28 days</div>'+barList(traffic)+
    '<p style="color:var(--muted);font-size:12.5px;margin-top:16px;line-height:1.5">Shorts / long-form / live splits and the impressions funnel aren\'t exposed by the API — those live only in YouTube Studio.</p>';
  const device=byKind('device').map(b=>({label:ytHuman('device',b.label),value:Number(b.views)})).sort((a,b)=>b.value-a.value);
  const subbed=byKind('subscribed').map(b=>({label:ytHuman('subscribed',b.label),value:Number(b.watch_minutes),valueLabel:fmtHours(b.watch_minutes)+' hrs'}));
  const demo=byKind('age_gender').map(b=>({label:ytHuman('age_gender',b.label),value:Number(b.percent),valueLabel:Number(b.percent).toFixed(1)+'%',color:'var(--violet)'})).sort((a,b)=>b.value-a.value).slice(0,12);
  const audience='<div class="yt-section-title">Devices — last 28 days (by views)</div>'+barList(device)+
    '<div class="yt-section-title">Watch time: subscribed vs not — last 28 days</div>'+barList(subbed)+
    '<div class="yt-section-title">Age & gender — % of views</div>'+barList(demo);
  modal({title:name+' — analytics',wide:true,footer:false,
    body:'<div class="yt-tabs"><button class="yt-tab active" onclick="ytSwitchTab(this,\'ov-'+id+'\')">Overview</button><button class="yt-tab" onclick="ytSwitchTab(this,\'co-'+id+'\')">Content</button><button class="yt-tab" onclick="ytSwitchTab(this,\'au-'+id+'\')">Audience</button></div>'+
      '<div id="ov-'+id+'" class="yt-pane">'+overview+'</div>'+
      '<div id="co-'+id+'" class="yt-pane" style="display:none">'+content+'</div>'+
      '<div id="au-'+id+'" class="yt-pane" style="display:none">'+audience+'</div>'});
}

async function loadYouTube(){
  topAction(ifCan('youtube','c','<button class="btn btn-primary" onclick="snapshotForm()">+ Add snapshot</button>'));
  const cut=new Date(); cut.setDate(cut.getDate()-30); const cutISO=cut.toISOString().slice(0,10);
  const [channels,statsAll,dailyAll]=await Promise.all([
    dbGet('channels?select=id,name,youtube_channel_id&order=name.asc'),
    dbGet('youtube_stats?select=channel_id,subscriber_count,view_count,video_count,fetched_at&order=fetched_at.desc'),
    dbGet('yt_daily?select=channel_id,date,views,watch_minutes,subs_gained,subs_lost&date=gte.'+cutISO+'&order=date.asc')
  ]);
  if(!channels||!channels.length){ document.getElementById('content').innerHTML='<div class="empty"><h4>No channels to track</h4><p>Add a channel first, then record stats for it here.</p>'+ifCan('channels','c','<button class="btn btn-primary" onclick="go(\'channels\')">Go to Channels</button>')+'</div>'; return; }
  const latest={}; (statsAll||[]).forEach(s=>{ if(!latest[s.channel_id]) latest[s.channel_id]=s; });
  const daily=dailyAll||[];
  const totSubs=channels.reduce((a,c)=>a+(latest[c.id]?Number(latest[c.id].subscriber_count)||0:0),0);
  const totViews=channels.reduce((a,c)=>a+(latest[c.id]?Number(latest[c.id].view_count)||0:0),0);
  const totVids=channels.reduce((a,c)=>a+(latest[c.id]?Number(latest[c.id].video_count)||0:0),0);
  const summary='<div class="yt-summary"><h3>All channels combined</h3><div class="s-top">'+
    '<div class="s-stat"><div class="n">'+fmtNum(totSubs)+'</div><div class="l">Subscribers</div></div>'+
    '<div class="s-stat"><div class="n">'+fmtNum(totViews)+'</div><div class="l">Total views</div></div>'+
    '<div class="s-stat"><div class="n">'+fmtNum(totVids)+'</div><div class="l">Videos</div></div>'+
    '<div class="s-stat"><div class="n">'+fmtNum(sumWindow(daily,28,'views'))+'</div><div class="l">Views · 28d</div></div>'+
    '<div class="s-stat"><div class="n">'+fmtHours(sumWindow(daily,28,'watch_minutes'))+'</div><div class="l">Watch hrs · 28d</div></div>'+
    '<div class="s-stat"><div class="n">'+(netSubs(daily,28)>=0?'+':'')+fmtNum(netSubs(daily,28))+'</div><div class="l">Net subs · 28d</div></div>'+
    '</div></div>';
  const cards=channels.map(c=>{const s=latest[c.id]||{};return '<div class="yt-fullcard" onclick=\'channelAnalytics("'+c.id+'")\'><div class="fc-info"><div class="fc-name">'+esc(c.name)+'</div><div class="fc-sub">'+(s.fetched_at?'Updated '+timeAgo(s.fetched_at):'No snapshot yet')+' · click for analytics</div></div><div class="fc-stat"><div class="n">'+fmtNum(s.subscriber_count)+'</div><div class="l">Subscribers</div></div><div class="fc-stat"><div class="n">'+fmtNum(s.view_count)+'</div><div class="l">Views</div></div><div class="fc-stat"><div class="n">'+fmtNum(s.video_count)+'</div><div class="l">Videos</div></div></div>';}).join('');
  document.getElementById('content').innerHTML=summary+cards;
}

function sparkline(vals){
  if(vals.length<2)return '';
  const w=260,h=44,min=Math.min(...vals),max=Math.max(...vals),rng=(max-min)||1;
  const pts=vals.map((v,i)=>[(i/(vals.length-1))*w,h-4-((v-min)/rng)*(h-8)]);
  const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><path d="'+d+'" fill="none" stroke="var(--orange)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
async function snapshotForm(){
  const channels = await dbGet('channels?select=id,name&order=name.asc')||[];
  modal({title:'Add YouTube snapshot',saveLabel:'Save snapshot',
    body:'<div class="form-grid">'+
      '<div class="field full"><label>Channel</label><select name="channel_id">'+channels.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Subscribers</label><input name="subscriber_count" type="number"></div>'+
      '<div class="field"><label>Total views</label><input name="view_count" type="number"></div>'+
      '<div class="field"><label>Videos</label><input name="video_count" type="number"></div>'+
    '</div>',
    onSave:async(bg)=>{
      const channel_id=bg.querySelector('[name="channel_id"]').value;
      if(!channel_id)throw new Error('Pick a channel');
      await dbPost('youtube_stats',{channel_id,
        subscriber_count:val(bg,'subscriber_count')||null,
        view_count:val(bg,'view_count')||null,
        video_count:val(bg,'video_count')||null});
      loadYouTube();toast('Snapshot saved');
    }});
}
