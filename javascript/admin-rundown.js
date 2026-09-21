var RD = { topics: [], busy: {} };

async function loadRundown(){
  document.getElementById('content').innerHTML = '<div class="loading">Loading rundown…</div>';
  topAction(
    '<button class="btn btn-ghost" onclick="rdNotesView()">Full notes rundown</button>'+
    ifCan('rundown','c','<button class="btn btn-primary" onclick="rdForm()">+ Add topic</button>')
  );
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
            (active ? '<button class="btn btn-ghost" onclick="rdStop()">Stop</button>' : '')+
            '<button class="btn btn-danger" onclick="rdRestart()">Restart rundown</button>'+
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

async function rdStop(){
  try{ await rpc('rundown_stop', {}); toast('Rundown stopped'); await loadRundown(); }
  catch(e){ toast('Could not stop the rundown: '+(e.message||e), true); }
}

function rdRestart(){
  modal({
    title: 'Restart the rundown?',
    body: '<p style="margin:0;line-height:1.5;color:var(--muted)">Every topic goes back to Up next and the clock clears. This can\'t be undone.</p>',
    saveLabel: 'Restart rundown',
    onSave: async function(){
      await rpc('rundown_reset_all', {});
      toast('Rundown reset');
      loadRundown();
    }
  });
}

function rdNotesView(){
  var body = RD.topics.length
    ? RD.topics.map(function(t){
        return '<div class="rd-noteblock">'+
          '<div class="rd-notehead">'+esc(t.title)+' '+rdStatusPill(t.status)+'</div>'+
          (t.description ? '<div class="rd-sub">'+esc(t.description)+'</div>' : '')+
          '<div class="rd-notebody">'+(t.notes ? esc(t.notes).replace(/\n/g,'<br>') : '<span class="rd-sub">No notes</span>')+'</div>'+
        '</div>';
      }).join('')
    : '<div class="empty"><p>No topics yet.</p></div>';
  modal({ title: 'Full rundown notes', wide: true, footer: false, body: '<div class="rd-notes">'+body+'</div>' });
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
        '<div class="field full"><label>Top image</label>'+
          '<input type="file" id="rdf-img" accept="image/*">'+
          '<div class="rd-imgprev" id="rdf-imgprev">'+((t&&t.image_url)?'<img src="'+esc(t.image_url)+'" style="max-width:220px;border-radius:8px;border:1px solid var(--line);display:block">':'')+'</div>'+
          '<input type="hidden" id="rdf-imgurl" value="'+esc((t&&t.image_url)||'')+'">'+
        '</div>'+
        '<div class="field full"><label>Internal notes (host-only — never shown on the broadcast page)</label>'+
          '<textarea id="rdf-notes" style="min-height:110px">'+esc((t&&t.notes)||'')+'</textarea></div>'+
      '</div>',
    onReady: function(bg){
      var d = bg.querySelector('#rdf-desc'), c = bg.querySelector('#rdf-count');
      var upd = function(){ c.textContent = d.value.length+'/100'; };
      d.oninput = upd; upd();

      bg.querySelector('#rdf-img').onchange = async function(e){
        var file = e.target.files[0];
        if(!file) return;
        var url = await rdCropOverlay(file);
        e.target.value = '';
        if(!url) return;
        bg.querySelector('#rdf-imgurl').value = url;
        bg.querySelector('#rdf-imgprev').innerHTML = '<img src="'+esc(url)+'" style="max-width:220px;border-radius:8px;border:1px solid var(--line);display:block">';
      };
    },
    onSave: async function(bg){
      var title = bg.querySelector('#rdf-title').value.trim();
      var desc = bg.querySelector('#rdf-desc').value.trim();
      if(!title) throw new Error('Give the topic a title.');
      if(desc.length > 75) throw new Error('Keep the description to 75 characters.');
      var dur = Number(bg.querySelector('#rdf-dur').value) || 60;
      var img = bg.querySelector('#rdf-imgurl').value.trim();
      var notes = bg.querySelector('#rdf-notes').value.trim();
      var payload = { title: title, description: desc || null, duration_seconds: dur, image_url: img || null, notes: notes || null };
      if(t) await dbPatch('rundown_topics?id=eq.'+t.id, payload);
      else await dbPost('rundown_topics', Object.assign({ sort_order: maxSort+10, created_by: ME.id }, payload));
      toast(t ? 'Topic updated' : 'Topic added');
      loadRundown();
    }
  });
}

function rdCropOverlay(file){
  return new Promise(function(resolve){
    var BOX_W = 480, BOX_H = 270, OUT_W = 1280, OUT_H = 720;
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML =
      '<div class="modal wide">'+
        '<div class="modal-head"><h3>Crop image</h3><button class="x" aria-label="Close">&times;</button></div>'+
        '<div class="modal-body">'+
          '<div class="rd-crop-box" id="rdCropBox" style="position:relative;overflow:hidden;width:'+BOX_W+'px;height:'+BOX_H+'px;margin:0 auto;background:#000;border-radius:10px;cursor:grab;touch-action:none;user-select:none">'+
            '<img id="rdCropImg" draggable="false" style="position:absolute;top:0;left:0;max-width:none;max-height:none">'+
          '</div>'+
          '<div class="rd-crop-zoom" style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:13px;color:var(--muted)"><label>Zoom</label><input type="range" id="rdCropZoom" min="1" max="3" step="0.01" value="1" style="flex:1"></div>'+
        '</div>'+
        '<div class="modal-foot"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Use this crop</button></div>'+
      '</div>';
    document.body.appendChild(bg);
    var close = function(){ bg.remove(); };
    bg.querySelector('.x').onclick = function(){ close(); resolve(null); };
    bg.querySelector('[data-cancel]').onclick = function(){ close(); resolve(null); };

    var imgEl = bg.querySelector('#rdCropImg');
    var zoomEl = bg.querySelector('#rdCropZoom');
    var natW = 0, natH = 0, baseScale = 1, scale = 1, posX = 0, posY = 0;

    function clamp(){
      var rw = natW*scale, rh = natH*scale;
      if(posX > 0) posX = 0;
      if(posY > 0) posY = 0;
      if(posX < BOX_W - rw) posX = BOX_W - rw;
      if(posY < BOX_H - rh) posY = BOX_H - rh;
    }
    function apply(){
      clamp();
      imgEl.style.width = (natW*scale)+'px';
      imgEl.style.height = (natH*scale)+'px';
      imgEl.style.transform = 'translate('+posX+'px,'+posY+'px)';
    }

    var reader = new FileReader();
    reader.onload = function(){
      imgEl.onload = function(){
        natW = imgEl.naturalWidth; natH = imgEl.naturalHeight;
        baseScale = Math.max(BOX_W/natW, BOX_H/natH);
        scale = baseScale;
        posX = (BOX_W - natW*scale)/2;
        posY = (BOX_H - natH*scale)/2;
        apply();
      };
      imgEl.src = reader.result;
    };
    reader.readAsDataURL(file);

    zoomEl.oninput = function(){
      var z = Number(zoomEl.value);
      var cx = BOX_W/2, cy = BOX_H/2;
      var ix = (cx - posX) / scale, iy = (cy - posY) / scale;
      scale = baseScale * z;
      posX = cx - ix*scale;
      posY = cy - iy*scale;
      apply();
    };

    var dragging = false, startX = 0, startY = 0, startPosX = 0, startPosY = 0;
    var box = bg.querySelector('#rdCropBox');
    box.addEventListener('pointerdown', function(e){
      dragging = true; startX = e.clientX; startY = e.clientY; startPosX = posX; startPosY = posY;
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', function(e){
      if(!dragging) return;
      posX = startPosX + (e.clientX - startX);
      posY = startPosY + (e.clientY - startY);
      apply();
    });
    box.addEventListener('pointerup', function(){ dragging = false; });

    bg.querySelector('[data-save]').onclick = function(){
      var btn = bg.querySelector('[data-save]');
      btn.disabled = true; btn.textContent = 'Uploading…';
      var sx = -posX/scale, sy = -posY/scale, sw = BOX_W/scale, sh = BOX_H/scale;
      var canvas = document.createElement('canvas');
      canvas.width = OUT_W; canvas.height = OUT_H;
      canvas.getContext('2d').drawImage(imgEl, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
      canvas.toBlob(function(blob){
        if(!blob){ toast('Could not process that image.', true); btn.disabled = false; btn.textContent = 'Use this crop'; return; }
        var name = 'topic-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.jpg';
        var cfg = sbCfg();
        fetch(cfg.url+'/storage/v1/object/rundown/'+name, {
          method: 'POST',
          headers: { 'apikey': cfg.key, 'Authorization': 'Bearer '+(cfg.token||cfg.key), 'Content-Type': 'image/jpeg' },
          body: blob
        }).then(function(res){
          if(!res.ok) return res.text().then(function(t){ throw new Error(res.status+' '+t); });
          var url = cfg.url+'/storage/v1/object/public/rundown/'+name;
          close(); resolve(url);
        }).catch(function(err){
          toast('Image upload failed: '+(err.message||err), true);
          btn.disabled = false; btn.textContent = 'Use this crop';
        });
      }, 'image/jpeg', 0.9);
    };
  });
}
