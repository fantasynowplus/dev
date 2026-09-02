let BP = { season:null, rows:[], staff:[], guests:[], players:null, pick:[] };
const BP_POS = ['QB','RB','WR','TE'];

function bpState(){
  if(BP.season) return Promise.resolve();
  return fetch('https://api.sleeper.app/v1/state/nfl')
    .then(r=>r.json()).catch(()=>({}))
    .then(s=>{ BP.season = Number(s.season)||new Date().getFullYear(); });
}

async function loadBoldPredictions(){
  topAction(ifCan('bold_predictions','c','<button class="btn btn-primary" onclick="bpForm()">+ Add prediction</button>'));
  await bpState();
  const [rows, staff, guests] = await Promise.all([
    dbGet('bp_predictions?select=*&season=eq.'+BP.season+'&order=sort_order.asc,created_at.asc'),
    dbGet('staff?select=id,name,headshot&order=name.asc'),
    dbGet('guests?select=id,name&order=name.asc')
  ]);
  BP.rows = rows||[]; BP.staff = staff||[]; BP.guests = guests||[];
  renderBoldPredictions();
}

function bpPlayers(){
  if(BP.players) return Promise.resolve(BP.players);
  try{ const c=sessionStorage.getItem('ss_players'); if(c){ BP.players=JSON.parse(c); return Promise.resolve(BP.players); } }catch(e){}
  return fetch('https://api.sleeper.app/v1/players/nfl').then(r=>r.json()).then(all=>{
    const out=[];
    Object.keys(all).forEach(id=>{
      const p=all[id];
      if(!p||!p.position||BP_POS.indexOf(p.position)<0||!p.team) return;
      out.push({id:id, n:p.full_name||((p.first_name||'')+' '+(p.last_name||'')).trim(), t:p.team, p:p.position, e:p.espn_id||''});
    });
    out.sort((a,b)=>a.n.localeCompare(b.n));
    BP.players=out;
    try{ sessionStorage.setItem('ss_players', JSON.stringify(out)); }catch(e){}
    return out;
  });
}

function bpRenderChips(bg){
  const wrap = bg.querySelector('#bpChips');
  if(!wrap) return;
  wrap.innerHTML = BP.pick.map((p,i)=>
    '<button type="button" class="bp-chip" data-i="'+i+'">'+esc(p.name)+
    (p.team?' <em>'+esc(p.team)+'</em>':'')+' <span>&times;</span></button>').join('');
  bg.querySelector('[name="players"]').value = JSON.stringify(BP.pick);
}

function bpBindSearch(bg, list){
  const q = bg.querySelector('[name="player_q"]');
  const res = bg.querySelector('#bpRes');
  const chips = bg.querySelector('#bpChips');
  if(!q||!res) return;
  bpRenderChips(bg);

  q.addEventListener('input', ()=>{
    const term=q.value.trim().toLowerCase();
    if(term.length<2){ res.innerHTML=''; return; }
    res.innerHTML = list.filter(p=>p.n.toLowerCase().indexOf(term)>=0)
      .slice(0,8).map(p=>'<button type="button" class="ss-hit" data-id="'+p.id+'" data-espn="'+p.e+
        '" data-team="'+p.t+'" data-pos="'+p.p+'" data-name="'+esc(p.n)+'">'+esc(p.n)+
        ' <span class="muted">'+p.p+' '+p.t+'</span></button>').join('');
  });

  res.addEventListener('click', e=>{
    const b=e.target.closest('.ss-hit'); if(!b) return;
    if(!BP.pick.some(x=>x.id===b.dataset.id)){
      BP.pick.push({id:b.dataset.id, name:b.dataset.name, espn:b.dataset.espn, team:b.dataset.team});
      bpRenderChips(bg);
    }
    q.value=''; res.innerHTML=''; q.focus();
  });

  chips.addEventListener('click', e=>{
    const c=e.target.closest('.bp-chip'); if(!c) return;
    BP.pick.splice(Number(c.dataset.i),1);
    bpRenderChips(bg);
  });
}

function bpShift(d){ BP.season = BP.season + d; loadBoldPredictions(); }

function bpSlotName(slot){
  const r = BP.rows.find(x=>x.featured_slot===slot);
  return r ? r.author_name : 'Empty slot '+slot;
}

function bpCardRow(r){
  const who = esc(r.author_name) + (r.guest_id ? ' <span class="chip">Guest</span>' : '');
  return '<tr><td><span class="bp-pos bp-'+r.position+'">'+r.position+'</span></td>'+
    '<td><strong>'+who+'</strong></td>'+
    '<td>'+(r.player_name?'<strong>'+esc(r.player_name)+'</strong><br>':'')+esc(r.prediction)+'</td>'+
    '<td>'+(r.featured_slot?badge('Column '+r.featured_slot,'var(--orange)'):'—')+'</td>'+
    '<td>'+bpResultBtns(r)+'</td>'+
    '<td><div class="row-actions">'+
      ifCan('bold_predictions','u','<button class="btn btn-ghost btn-sm" onclick=\'bpForm("'+r.id+'")\'>Edit</button>')+
      ifCan('bold_predictions','d','<button class="btn btn-danger btn-sm" onclick=\'bpDelete("'+r.id+'")\'>Delete</button>')+
    '</div></td></tr>';
}

function bpFeaturedCol(slot){
  const mine = BP.rows.filter(r=>r.featured_slot===slot);
  const cells = BP_POS.map(p=>{
    const r = mine.find(x=>x.position===p);
    return '<div class="bp-slot'+(r?'':' empty')+'">'+
      '<span class="bp-pos bp-'+p+'">'+p+'</span>'+
      (r ? '<span class="bp-txt">'+(r.player_name?'<b>'+esc(r.player_name)+'</b> — ':'')+esc(r.prediction)+'</span>'+
           bpResultBtns(r)+
           ifCan('bold_predictions','u','<button class="btn btn-ghost btn-sm" onclick=\'bpForm("'+r.id+'")\'>Edit</button>')
         : '<span class="bp-txt muted">Not entered</span>'+
           ifCan('bold_predictions','c','<button class="btn btn-ghost btn-sm" onclick=\'bpForm(null,'+slot+',"'+p+'")\'>Add</button>'))+
    '</div>';
  }).join('');
  return '<div class="panel bp-col"><div class="bp-colhead">'+esc(bpSlotName(slot))+'</div>'+cells+'</div>';
}

function renderBoldPredictions(){
  const others = BP.rows.filter(r=>!r.featured_slot)
    .sort((a,b)=>BP_POS.indexOf(a.position)-BP_POS.indexOf(b.position) || a.author_name.localeCompare(b.author_name));
  document.getElementById('content').innerHTML =
    '<div class="cal-toolbar">'+
      '<button class="btn btn-ghost btn-sm" onclick="bpShift(-1)">&lsaquo;</button>'+
      '<span class="cal-month">'+BP.season+' Season</span>'+
      '<button class="btn btn-ghost btn-sm" onclick="bpShift(1)">&rsaquo;</button>'+
      '<span class="count-pill" style="margin-left:auto">'+BP.rows.length+' this season</span>'+
    '</div>'+
    '<div class="bp-cols">'+bpFeaturedCol(1)+bpFeaturedCol(2)+'</div>'+
    '<div class="panel"><div class="table-wrap"><table><thead><tr>'+
      '<th>Pos</th><th>Who</th><th>Prediction</th><th>Placement</th><th>Result</th><th></th>'+
    '</tr></thead><tbody>'+
    (others.length ? others.map(bpCardRow).join('')
      : '<tr><td colspan="6"><div class="empty"><h4>No other predictions yet</h4>'+
        '<p>Add staff or guest predictions and they\'ll be listed here by position.</p>'+
        ifCan('bold_predictions','c','<button class="btn btn-primary" onclick="bpForm()">+ Add prediction</button>')+
        '</div></td></tr>')+
    '</tbody></table></div></div>';
}

function bpResultBtns(r){
  if(!can('bold_predictions','u')) return r.result ? '<span class="bp-rtag '+r.result+'">'+(r.result==='hit'?'HIT':'MISS')+'</span>' : '';
  return '<div class="bp-res">'+
    '<button class="bp-rbtn hit'+(r.result==='hit'?' on':'')+'" title="Hit" onclick=\'bpSetResult("'+r.id+'","hit")\'>&#10003;</button>'+
    '<button class="bp-rbtn miss'+(r.result==='miss'?' on':'')+'" title="Miss" onclick=\'bpSetResult("'+r.id+'","miss")\'>&#10007;</button></div>';
}

async function bpSetResult(id, v){
  const cur = BP.rows.find(x=>x.id===id);
  const next = (cur && cur.result===v) ? null : v;
  await dbPatch('bp_predictions?id=eq.'+id, {result:next});
  await loadBoldPredictions();
  toast(next ? ('Marked '+next) : 'Result cleared');
}

function bpAuthorOptions(sel){
  const s = BP.staff.map(x=>'<option value="staff:'+x.id+'"'+(sel==='staff:'+x.id?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  const g = BP.guests.map(x=>'<option value="guest:'+x.id+'"'+(sel==='guest:'+x.id?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  return '<option value="">— choose —</option>'+
    (s?'<optgroup label="Staff">'+s+'</optgroup>':'')+
    (g?'<optgroup label="Guests">'+g+'</optgroup>':'');
}

function bpForm(id, presetSlot, presetPos){
  const r = id ? BP.rows.find(x=>x.id===id) : {};
  const sel = r.staff_id ? 'staff:'+r.staff_id : r.guest_id ? 'guest:'+r.guest_id : '';
  const slot = r.featured_slot != null ? String(r.featured_slot) : (presetSlot!=null?String(presetSlot):'');
  const pos = r.position || presetPos || 'QB';
  BP.pick = Array.isArray(r.players) && r.players.length ? r.players.slice()
          : (r.player_name ? [{id:r.player_id||'', name:r.player_name, espn:r.espn_id||'', team:r.player_team||''}] : []);
  modal({title:id?'Edit prediction':'Add bold prediction', wide:true, saveLabel:id?'Save changes':'Add prediction',
    body:'<div class="form-grid">'+
      '<div class="field"><label>Who</label><select name="author">'+bpAuthorOptions(sel)+'</select></div>'+
      '<div class="field"><label>Position</label><select name="position">'+
        BP_POS.map(p=>'<option'+(pos===p?' selected':'')+'>'+p+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Placement</label><select name="slot">'+
        '<option value=""'+(slot===''?' selected':'')+'>List (everyone else)</option>'+
        '<option value="1"'+(slot==='1'?' selected':'')+'>Featured column 1</option>'+
        '<option value="2"'+(slot==='2'?' selected':'')+'>Featured column 2</option>'+
      '</select></div>'+
      '<div class="field"><label>Sort order</label><input name="sort_order" type="number" value="'+(r.sort_order||0)+'"></div>'+
      '<div class="field full"><label>Player(s)</label>'+
        '<input name="player_q" class="ss-search" autocomplete="off" placeholder="Search players\u2026">'+
        '<div class="ss-results" id="bpRes"></div>'+
        '<div class="bp-chips" id="bpChips"></div>'+
        '<input type="hidden" name="players" value="">'+
        '<div class="ss-picked muted">Click a result to add. Click a chip to remove.</div></div>'+
      '<div class="field full"><label>Prediction</label><textarea name="prediction" rows="3">'+esc(r.prediction||'')+'</textarea></div>'+
    '</div>',
    onReady:(bg)=>{ bpPlayers().then(list=>bpBindSearch(bg,list)); },
    onSave:async(bg)=>{
      const author = val(bg,'author');
      const prediction = val(bg,'prediction');
      if(!author) throw new Error('Pick who made the prediction');
      if(!prediction) throw new Error('Prediction text is required');
      const [kind,aid] = author.split(':');
      const list = kind==='staff' ? BP.staff : BP.guests;
      const found = list.find(x=>x.id===aid);
      const slotVal = val(bg,'slot');
      const body = {
        season:BP.season,
        position:val(bg,'position'),
        featured_slot: slotVal===''?null:Number(slotVal),
        staff_id: kind==='staff'?aid:null,
        guest_id: kind==='guest'?aid:null,
        author_name: found?found.name:'Unknown',
        prediction: prediction,
        players: BP.pick,
        player_name: BP.pick.map(x=>x.name).join(' & ')||null,
        player_id: BP.pick[0] ? BP.pick[0].id : null,
        espn_id: BP.pick[0] ? BP.pick[0].espn : null,
        player_team: BP.pick[0] ? BP.pick[0].team : null,
        sort_order: Number(val(bg,'sort_order'))||0
      };
      if(id) await dbPatch('bp_predictions?id=eq.'+id, body);
      else    await dbPost('bp_predictions', body);
      await loadBoldPredictions();
      toast(id?'Prediction updated':'Prediction added');
    }});
}

function bpDelete(id){
  confirmDelete('this prediction', async()=>{
    await dbDel('bp_predictions?id=eq.'+id);
    await loadBoldPredictions();
    toast('Prediction deleted');
  });
}