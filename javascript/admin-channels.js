let CHANNELS=[];
async function loadChannels(){
  topAction(ifCan('channels','c','<button class="btn btn-primary" onclick="channelForm()">+ Add channel</button>'));
  CHANNELS = await dbGet('channels?select=*,shows(id)&order=name.asc')||[];
  const content=document.getElementById('content');
  if(!CHANNELS.length){content.innerHTML='<div class="empty"><h4>No channels yet</h4><p>Create a channel to house your shows and link out to its YouTube page.</p>'+ifCan('channels','c','<button class="btn btn-primary" onclick="channelForm()">+ Add channel</button>')+'</div>';return;}
  content.innerHTML='<div class="yt-grid">'+CHANNELS.map(c=>
    '<div class="yt-card"><h4>'+esc(c.name)+'</h4>'+
    '<div class="yt-sub">'+(c.shows?c.shows.length:0)+' show'+((c.shows&&c.shows.length===1)?'':'s')+
    (c.youtube_channel_id?' · <span class="mono">'+esc(c.youtube_channel_id)+'</span>':'')+'</div>'+
    (c.description?'<p style="font-size:13.5px;color:var(--muted);line-height:1.5;margin:0 0 14px">'+esc(c.description)+'</p>':'')+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn btn-ghost btn-sm" onclick=\'viewChannel("'+c.id+'")\'>View</button>'+
      (c.youtube_url?'<a class="btn btn-navy btn-sm" href="'+esc(c.youtube_url)+'" target="_blank" rel="noopener">Open on YouTube</a>':'')+
      ifCan('channels','u','<button class="btn btn-ghost btn-sm" onclick=\'channelForm("'+c.id+'")\'>Edit</button>')+
      ifCan('channels','d','<button class="btn btn-danger btn-sm" onclick=\'channelDelete("'+c.id+'")\'>Delete</button>')+
    '</div></div>').join('')+'</div>';
}
function channelForm(id){
  const c=id?CHANNELS.find(x=>x.id===id):{};
  modal({title:id?'Edit channel':'Add channel',wide:true,saveLabel:id?'Save changes':'Add channel',
    body:'<div class="form-grid">'+
      '<div class="field full"><label>Channel name</label><input name="name" value="'+esc(c.name||'')+'"></div>'+
      '<div class="field"><label>YouTube channel ID</label><input name="youtube_channel_id" placeholder="UC…" value="'+esc(c.youtube_channel_id||'')+'"></div>'+
      '<div class="field"><label>YouTube URL</label><input name="youtube_url" placeholder="https://youtube.com/@…" value="'+esc(c.youtube_url||'')+'"></div>'+
      '<div class="field full"><label>Description</label><textarea name="description">'+esc(c.description||'')+'</textarea></div>'+
    '</div>',
    onSave:async(bg)=>{
      const body={name:val(bg,'name'),youtube_channel_id:val(bg,'youtube_channel_id')||null,
        youtube_url:val(bg,'youtube_url')||null,description:val(bg,'description')};
      if(!body.name)throw new Error('Channel name is required');
      if(id)await dbPatch('channels?id=eq.'+id,body);else await dbPost('channels',body);
      loadChannels();toast(id?'Channel updated':'Channel added');
    }});
}
function channelDelete(id){const c=CHANNELS.find(x=>x.id===id);confirmDelete(esc(c.name),async()=>{
  await dbDel('channels?id=eq.'+id);loadChannels();toast('Channel removed');});}
