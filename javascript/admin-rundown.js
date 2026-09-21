var RD = { topics: [], busy: {} };

async function loadRundown(){
  document.getElementById('content').innerHTML = '<div class="loading">Loading rundown…</div>';
  topAction(ifCan('rundown','c','<button class="btn btn-primary" onclick="rdForm()">+ Add topic</button>'));
  try{
    RD.topics = await dbGet('rundown_topics?select=*&order=sort_order.asc,created_at.asc') || [];
  }catch(e){
    document.getElementById('content').innerHTML =
      '<div class="empty"><h4>Couldn\'t load the rundown</h4><p>'+esc(e.message)+'</p></div>';
    return;
  }
  rdRender();
}

function rdRender(){
  var active = RD.topics.filter(function(t){ return t.status === 'active'; })[0];
  var canRun = can('rundown','u');
  var canEdit = can('rundown','u');
  var canDel = can('rundown','d');

  var head =
    '<div class="rd-live">'+
      (active
        ? '<div><div class="rd-live-k">On now</div><div class="rd-live-v">'+esc(active.title)+'</div>'+
            (active.description ? '<div class="rd-live-d">'+esc(active.description)+'</div>' : '')+'</div>'
        : '<div><div class="rd-live-k">On now</div><div class="rd-live-v muted">Nothing active yet</div></div>')+
      (canRun
        ? '<div class="rd-live-actions">'+
            '<button class="btn btn-primary" onclick="rdNext()">'+(active?'Next topic':'Start rundown')+'</button>'+
            (active ? '<button class="btn btn-ghost" onclick="rdResetTimer()">Reset clock</button>' : '')+
          '</div>'
        : '')+
    '</div>';

  var rows = RD.topics.map(function(t, i){
    return '<tr class="rd-row rd-'+t.status+'">'+
      '<td class="rd-ord">'+
        (canEdit
          ? '<button class="rd-arrow" '+(i===0?'disabled':'')+' onclick="rdMove(\''+t.id+'\',-1)">&uarr;</button>'+
            '<button class="rd-arrow" '+(i===RD.topics.length-1?'disabled':'')+' onclick="rdMove(\''+t.id+'\',1)">&darr;</button>'
          : '')+
      '</td>'+
      '<td><div class="rd-t">'+esc(t.title)+'</div>'+(t.description?'<div class="rd-sub">'+esc(t.description)+'</div>':'')+'</td>'+
      '<td>'+rdStatusPill(t.status)+' <span class="rd-dur">'+(t.duration_seconds||60)+'s</span></td>'+
      '<td class="row-actions">'+
        (canRun && t.status !== 'active' ? '<button class="btn btn-ghost btn-sm" onclick="rdActivate(\''+t.id+'\')">Make active</button>' : '')+
        (canEdit ? '<button class="btn btn-ghost btn-sm" onclick="rdForm(\''+t.id+'\')">Edit</button>' : '')+
        (canDel ? '<button class="btn btn-danger btn-sm" onclick="rdDelete(\''+t.id+'\')">Delete</button>' : '')+
      '</td></tr>';
  }).join('');

  var body = RD.topics.length
    ? '<div class="table-wrap"><table class="bt-table rd-table"><thead><tr><th></th><th>Topic</th><th>Status</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    : '<div class="empty"><h4>No topics yet</h4><p>Add the topics for this show — they\'ll appear here and on the rundown display in this order.</p>'+
      ifCan('rundown','c','<button class="btn btn-primary" onclick="rdForm()">+ Add topic</button>')+'</div>';

  document.getElementById('content').innerHTML = '<div class="panel">'+head+body+'</div>';
}

function rdStatusPill(s){
  var map = { pending:['Up next','bt-pending'], active:['Live','bt-win'], covered:['Covered','bt-void'] };
  var m = map[s] || ['',''];
  return '<span class="bt-pill '+m[1]+'">'+m[0]+'</span>';
}

async function rdNext(){
  if(RD.busy.next) return;
  RD.busy.next = true;
  try{ await rpc('rundown_next', {}); toast('Moved to the next topic'); await loadRundown(); }
  catch(e){ toast('Could not advance the rundown: '+(e.message||e), true); }
  RD.busy.next = false;
}

async function rdActivate(id){
  if(RD.busy[id]) return;
  RD.busy[id] = true;
  try{ await rpc('rundown_activate', { p_id: id }); toast('Topic is live'); await loadRundown(); }
  catch(e){ toast('Could not switch topics: '+(e.message||e), true); }
  RD.busy[id] = false;
}

async function rdResetTimer(){
  try{ await rpc('rundown_reset_timer', {}); toast('Clock reset'); await loadRundown(); }
  catch(e){ toast('Could not reset the clock: '+(e.message||e), true); }
}

async function rdMove(id, dir){
  var i = RD.topics.findIndex(function(t){ return t.id === id; });
  var j = i + dir;
  if(i < 0 || j < 0 || j >= RD.topics.length) return;
  var a = RD.topics[i], b = RD.topics[j];
  try{
    await dbPatch('rundown_topics?id=eq.'+a.id, { sort_order: b.sort_order });
    await dbPatch('rundown_topics?id=eq.'+b.id, { sort_order: a.sort_order });
    await loadRundown();
  }catch(e){ toast('Could not reorder: '+(e.message||e), true); }
}

function rdDelete(id){
  var t = RD.topics.filter(function(x){ return x.id === id; })[0];
  confirmDelete(t ? esc(t.title) : 'this topic', async function(){
    await dbDel('rundown_topics?id=eq.'+id);
    toast('Topic deleted');
    loadRundown();
  });
}

function rdForm(id){
  var t = id ? RD.topics.filter(function(x){ return x.id === id; })[0] : null;
  var maxSort = RD.topics.reduce(function(m,x){ return Math.max(m, x.sort_order||0); }, 0);

  modal({
    title: t ? 'Edit topic' : 'Add topic',
    saveLabel: t ? 'Save topic' : 'Add topic',
    body:
      '<div class="form-grid">'+
        '<div class="field full"><label>Topic</label><input id="rdf-title" maxlength="120" value="'+esc((t&&t.title)||'')+'"></div>'+
        '<div class="field full"><label>Description (this is what reads out on the stream banner) <span class="rd-count" id="rdf-count">0/100</span></label>'+
          '<textarea id="rdf-desc" maxlength="100">'+esc((t&&t.description)||'')+'</textarea></div>'+
        '<div class="field"><label>Clock (seconds)</label><input type="number" min="5" step="5" id="rdf-dur" value="'+((t&&t.duration_seconds)||60)+'"></div>'+
        '<div class="field full"><label>Top image (auto-cropped to 16:9)</label>'+
          '<input type="file" id="rdf-img" accept="image/*">'+
          '<div class="rd-imgprev" id="rdf-imgprev">'+((t&&t.image_url)?'<img src="'+esc(t.image_url)+'">':'')+'</div>'+
          '<input type="hidden" id="rdf-imgurl" value="'+esc((t&&t.image_url)||'')+'">'+
        '</div>'+
      '</div>',
    onReady: function(bg){
      var d = bg.querySelector('#rdf-desc'), c = bg.querySelector('#rdf-count');
      var upd = function(){ c.textContent = d.value.length+'/100'; };
      d.oninput = upd; upd();

      bg.querySelector('#rdf-img').onchange = async function(e){
        var file = e.target.files[0];
        if(!file) return;
        var prev = bg.querySelector('#rdf-imgprev');
        prev.innerHTML = '<span class="rd-sub">Cropping…</span>';
        try{
          var url = await rdUploadCropped(file);
          bg.querySelector('#rdf-imgurl').value = url;
          prev.innerHTML = '<img src="'+esc(url)+'">';
        }catch(err){
          prev.innerHTML = '<span class="rd-sub">Couldn\'t upload that image.</span>';
          toast('Image upload failed: '+(err.message||err), true);
        }
      };
    },
    onSave: async function(bg){
      var title = bg.querySelector('#rdf-title').value.trim();
      var desc = bg.querySelector('#rdf-desc').value.trim();
      if(!title) throw new Error('Give the topic a title.');
      if(desc.length > 100) throw new Error('Keep the description to 100 characters.');
      var dur = Number(bg.querySelector('#rdf-dur').value) || 60;
      var img = bg.querySelector('#rdf-imgurl').value.trim();
      var payload = { title: title, description: desc || null, duration_seconds: dur, image_url: img || null };
      if(t) await dbPatch('rundown_topics?id=eq.'+t.id, payload);
      else await dbPost('rundown_topics', Object.assign({ sort_order: maxSort+10, created_by: ME.id }, payload));
      toast(t ? 'Topic updated' : 'Topic added');
      loadRundown();
    }
  });
}

function rdUploadCropped(file){
  return new Promise(function(resolve, reject){
    var img = new Image();
    var reader = new FileReader();
    reader.onerror = function(){ reject(new Error('Could not read that file.')); };
    reader.onload = function(){
      img.onerror = function(){ reject(new Error('Not a readable image.')); };
      img.onload = function(){
        var W = 1280, H = 720;
        var srcRatio = img.width / img.height, tgtRatio = W / H;
        var sx, sy, sw, sh;
        if(srcRatio > tgtRatio){ sh = img.height; sw = sh * tgtRatio; sx = (img.width - sw) / 2; sy = 0; }
        else { sw = img.width; sh = sw / tgtRatio; sx = 0; sy = (img.height - sh) / 2; }
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        canvas.toBlob(function(blob){
          if(!blob){ reject(new Error('Could not process that image.')); return; }
          var name = 'topic-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.jpg';
          var cfg = sbCfg();
          fetch(cfg.url+'/storage/v1/object/rundown/'+name, {
            method:'POST',
            headers:{ 'apikey':cfg.key, 'Authorization':'Bearer '+(cfg.token||cfg.key), 'Content-Type':'image/jpeg' },
            body: blob
          }).then(function(res){
            if(!res.ok) return res.text().then(function(t){ throw new Error(res.status+' '+t); });
            resolve(cfg.url+'/storage/v1/object/public/rundown/'+name);
          }).catch(reject);
        }, 'image/jpeg', 0.9);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
