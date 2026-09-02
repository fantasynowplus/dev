let RANK_TAB='grid';
let RANK_PAGES=[], RANK_ANALYSTS=[], RANK_LINKS=[], RANK_STAFF=[], RANK_HIDDEN={};

const ROSTER_ATTRS={filters:'data-filters (standard)', expert:'data-expert (IDP-style)'};

async function loadRankings(){
  const [pages,analysts,links]=await Promise.all([
    dbGet('ranking_pages?select=*&order=sort_order.asc'),
    dbGet('ranking_analysts?select=*&order=sort_order.asc,name.asc'),
    dbGet('ranking_page_analysts?select=*&order=sort_order.asc')
  ]);
  RANK_PAGES=pages||[]; RANK_ANALYSTS=analysts||[]; RANK_LINKS=links||[];
  try{ RANK_STAFF=await dbGet('staff?select=id,name&order=name.asc')||[]; }catch(e){ RANK_STAFF=[]; }
  RANK_HIDDEN={};
  try{
    (await dbGet('ranking_directory_hidden?select=*')||[]).forEach(h=>{
      (RANK_HIDDEN[h.page_id]=RANK_HIDDEN[h.page_id]||[]).push(h.analyst_id);
    });
  }catch(e){}
  renderRankings();
}

function rankTab(t){ RANK_TAB=t; renderRankings(); }

function renderRankings(){
  const tabs=[['grid','Display grid'],['pages','Pages'],['analysts','Analysts']];
  topAction(
    RANK_TAB==='pages'    ? ifCan('rankings','c','<button class="btn btn-primary" onclick="rankPageForm()">+ Add page</button>') :
    RANK_TAB==='analysts' ? ifCan('rankings','c','<button class="btn btn-primary" onclick="rankAnalystForm()">+ Add analyst</button>') : ''
  );
  const body = RANK_TAB==='pages' ? rankPagesHtml() : RANK_TAB==='analysts' ? rankAnalystsHtml() : rankGridHtml();
  document.getElementById('content').innerHTML=
    '<div class="onb-tabs">'+tabs.map(([k,l])=>'<button class="'+(RANK_TAB===k?'on':'')+'" onclick="rankTab(\''+k+'\')">'+esc(l)+'</button>').join('')+'</div>'+body;
}

function rankLink(pageId,analystId){ return RANK_LINKS.find(l=>l.page_id===pageId&&l.analyst_id===analystId); }
function rankRosterLinks(pageId){
  return RANK_LINKS.filter(l=>l.page_id===pageId).slice().sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
}
function rankRosterIds(pageId){
  return rankRosterLinks(pageId).map(l=>{
    const a=RANK_ANALYSTS.find(x=>x.id===l.analyst_id);
    return (a && a.is_active) ? (l.fp_id_override||a.fp_id) : null;
  }).filter(Boolean);
}
function rankAttrs(p){
  const ids=rankRosterIds(p.id).join(':');
  const filters = p.roster_attr==='filters' ? [ids,(p.extra_filters||'')].filter(Boolean).join(':') : (p.extra_filters||'');
  const expert  = p.roster_attr==='expert'  ? ids : (p.primary_expert||'');
  return {filters:filters||'—', expert:expert||'—'};
}

function rankGridHtml(){
  if(!RANK_PAGES.length) return '<div class="empty"><h4>No rankings pages</h4><p>Add a page first, then choose who appears on it.</p>'+ifCan('rankings','c','<button class="btn btn-primary" onclick="rankTab(\'pages\')">Go to Pages</button>')+'</div>';
  if(!RANK_ANALYSTS.length) return '<div class="empty"><h4>No analysts</h4><p>Add analysts with their FantasyPros IDs to build the grid.</p>'+ifCan('rankings','c','<button class="btn btn-primary" onclick="rankTab(\'analysts\')">Go to Analysts</button>')+'</div>';

  const editable=can('rankings','u');
  const head='<tr><th>Analyst</th>'+RANK_PAGES.map(p=>
    '<th><div class="rank-head">'+
      '<span class="rh-name">'+esc(p.name)+'</span>'+
      '<span class="rh-meta">'+rankRosterIds(p.id).length+' selected</span>'+
      (p.is_active===false?badge('Hidden','var(--muted)'):'')+
      ifCan('rankings','u','<button class="btn btn-ghost btn-sm" onclick=\'rankPageForm("'+p.id+'")\'>Settings</button>')+
    '</div></th>').join('')+'</tr>';

  const body=RANK_ANALYSTS.map(a=>{
    const cells=RANK_PAGES.map(p=>{
      const l=rankLink(p.id,a.id);
      const ov=l&&l.fp_id_override?'<div class="rank-mono">'+esc(l.fp_id_override)+'</div>':'';
      return '<td><input type="checkbox"'+(l?' checked':'')+(editable?'':' disabled')+
        ' onchange=\'rankToggle("'+p.id+'","'+a.id+'",this)\'>'+ov+'</td>';
    }).join('');
    return '<tr class="'+(a.is_active===false?'rk-off':'')+'"><td>'+esc(a.name)+
      ' <span class="rank-mono">'+esc(a.fp_id)+'</span>'+
      (a.is_active===false?' '+badge('Inactive','var(--muted)'):'')+'</td>'+cells+'</tr>';
  }).join('');

  const out='<div class="rank-out">'+RANK_PAGES.map(p=>{
    const at=rankAttrs(p);
    return '<div class="ro"><div class="ro-t"><h4>'+esc(p.name)+'</h4>'+
      '<span class="rank-mono">'+esc(p.wtype)+'</span>'+
      '<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick=\'rankLiveOutput("'+esc(p.slug)+'")\'>Live output</button></div>'+
      '<div class="ro-r"><span class="ro-l">filters</span><code>'+esc(at.filters)+'</code></div>'+
      '<div class="ro-r"><span class="ro-l">expert</span><code>'+esc(at.expert)+'</code></div></div>';
  }).join('')+'</div>';

  return '<div class="panel"><div class="panel-head"><h3>Who displays where</h3>'+
    '<span class="count-pill" style="margin-left:auto">'+RANK_ANALYSTS.length+' analysts &middot; '+RANK_PAGES.length+' pages</span></div>'+
    '<div class="table-wrap"><table class="role-matrix"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></div>'+
    out;
}

async function rankToggle(pageId,analystId,el){
  if(!can('rankings','u')){ el.checked=!el.checked; return; }
  el.disabled=true;
  try{
    if(el.checked){
      const max=RANK_LINKS.filter(l=>l.page_id===pageId).reduce((m,l)=>Math.max(m,l.sort_order||0),0);
      const rows=await dbPost('ranking_page_analysts',{page_id:pageId,analyst_id:analystId,sort_order:max+10});
      RANK_LINKS.push((rows&&rows[0])||{page_id:pageId,analyst_id:analystId,sort_order:max+10,fp_id_override:null});
    }else{
      await dbDel('ranking_page_analysts?page_id=eq.'+pageId+'&analyst_id=eq.'+analystId);
      RANK_LINKS=RANK_LINKS.filter(l=>!(l.page_id===pageId&&l.analyst_id===analystId));
    }
    renderRankings();
  }catch(e){ el.checked=!el.checked; el.disabled=false; toast(e.message,true); }
}

function rankPagesHtml(){
  if(!RANK_PAGES.length) return '<div class="empty"><h4>No rankings pages yet</h4><p>Each page here maps to one FantasyPros widget on the site.</p>'+ifCan('rankings','c','<button class="btn btn-primary" onclick="rankPageForm()">+ Add page</button>')+'</div>';
  const rows=RANK_PAGES.map(p=>'<tr>'+
    '<td><strong>'+esc(p.name)+'</strong>'+(p.is_active===false?' '+badge('Hidden','var(--muted)'):'')+
      '<div class="rank-mono">'+esc(p.page_url)+'</div></td>'+
    '<td><span class="chip">'+esc(p.slug)+'</span></td>'+
    '<td class="mono">'+esc(p.wtype)+'</td>'+
    '<td class="mono">'+esc(p.positions||'—')+'</td>'+
    '<td>'+rankRosterIds(p.id).length+'</td>'+
    '<td class="row-actions">'+
      '<button class="btn btn-ghost btn-sm" onclick=\'rankLiveOutput("'+esc(p.slug)+'")\'>Live output</button>'+
      ifCan('rankings','u','<button class="btn btn-ghost btn-sm" onclick=\'rankPageForm("'+p.id+'")\'>Edit</button>')+
      ifCan('rankings','d','<button class="btn btn-danger btn-sm" onclick=\'rankPageDelete("'+p.id+'")\'>Delete</button>')+
    '</td></tr>').join('');
  return '<div class="panel"><div class="table-wrap"><table><thead><tr>'+
    '<th>Page</th><th>Slug</th><th>Type</th><th>Positions</th><th>Analysts</th><th></th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

function rankPageForm(id){
  const p=id?RANK_PAGES.find(x=>x.id===id):{};
  const isNew=!id;
  const roster=id?rankRosterLinks(id):[];
  const hiddenHtml=!id?'' :
    '<div class="field full"><label>Hide from the staff page</label><div id="rdhList">'+
    RANK_ANALYSTS.map(a=>{
      const on=(RANK_HIDDEN[id]||[]).indexOf(a.id)!==-1;
      return '<label class="rdh-row" style="cursor:pointer">'+
        '<input type="checkbox" class="rdh-c" data-analyst="'+a.id+'"'+(on?' checked':'')+'>'+
        '<span class="rr-n">'+esc(a.name)+'</span>'+
        '<span class="rank-mono">'+esc(a.fp_id)+'</span></label>';
    }).join('')+'</div></div>';
  const rosterHtml=!id?'' :
    '<div class="field full"><label>Roster order &amp; ID overrides</label>'+
    (roster.length?'<div id="rrList">'+roster.map(l=>{
      const a=RANK_ANALYSTS.find(x=>x.id===l.analyst_id)||{};
      return '<div class="rr-row" data-analyst="'+l.analyst_id+'">'+
        '<span class="rr-n">'+esc(a.name||'Unknown')+'</span>'+
        '<span class="rank-mono">'+esc(a.fp_id||'')+'</span>'+
        '<input class="rr-i" placeholder="override" value="'+esc(l.fp_id_override||'')+'">'+
        '<button type="button" class="btn btn-ghost btn-sm" onclick="rankRosterMove(this,-1)">&uarr;</button>'+
        '<button type="button" class="btn btn-ghost btn-sm" onclick="rankRosterMove(this,1)">&darr;</button>'+
      '</div>';
    }).join('')+'</div>'
    :'<div class="rank-mono">Nobody selected yet — use the Display grid tab.</div>')+
    '</div>';

  modal({title:isNew?'Add rankings page':'Edit '+(p.name||'page'),wide:true,saveLabel:isNew?'Add page':'Save changes',
    body:'<div class="form-grid">'+
      '<div class="field"><label>Page name</label><input name="name" placeholder="Redraft Rankings" value="'+esc(p.name||'')+'"></div>'+
      '<div class="field"><label>Slug</label><input name="slug" placeholder="redraft" value="'+esc(p.slug||'')+'"></div>'+
      '<div class="field full"><label>Heading shown on the page</label><input name="heading" placeholder="2026 Redraft Fantasy Football Rankings" value="'+esc(p.heading||'')+'"></div>'+
      '<div class="field"><label>Page URL</label><input name="page_url" placeholder="rankings-redraft" value="'+esc(p.page_url||'')+'"></div>'+
      '<div class="field"><label>Nav order</label><input name="sort_order" type="number" value="'+(p.sort_order!=null?p.sort_order:(RANK_PAGES.length+1)*10)+'"></div>'+
      '<div class="field"><label>Widget type (data-wtype)</label><input name="wtype" placeholder="ST" value="'+esc(p.wtype||'ST')+'"></div>'+
      '<div class="field"><label>Scoring</label><input name="scoring" value="'+esc(p.scoring||'PPR')+'"></div>'+
      '<div class="field full"><label>Positions</label><input name="positions" placeholder="QB:RB:WR:TE:OP" value="'+esc(p.positions||'QB:RB:WR:TE:OP')+'"></div>'+
      '<div class="field"><label>PPR positions</label><input name="ppr_positions" value="'+esc(p.ppr_positions||'')+'"></div>'+
      '<div class="field"><label>Half PPR positions</label><input name="half_positions" value="'+esc(p.half_positions||'')+'"></div>'+
      '<div class="field"><label>Year</label><input name="year" type="number" value="'+(p.year||2026)+'"></div>'+
      '<div class="field"><label>Week</label><input name="week" type="number" value="'+(p.week!=null?p.week:0)+'"></div>'+
      '<div class="field"><label>Height</label><input name="height" value="'+esc(p.height||'800px')+'"></div>'+
      '<div class="field"><label>Roster lives in</label><select name="roster_attr">'+
        Object.keys(ROSTER_ATTRS).map(k=>'<option value="'+k+'"'+((p.roster_attr||'filters')===k?' selected':'')+'>'+esc(ROSTER_ATTRS[k])+'</option>').join('')+
      '</select></div>'+
      '<div class="field"><label>Primary expert</label><input name="primary_expert" placeholder="7357" value="'+esc(p.primary_expert||'')+'"></div>'+
      '<div class="field"><label>Extra filters</label><input name="extra_filters" placeholder="7625" value="'+esc(p.extra_filters||'')+'"></div>'+
      '<div class="field full"><label><input type="checkbox" name="is_active" '+(p.is_active===false?'':'checked')+'> Live on the site</label></div>'+
      rosterHtml+hiddenHtml+
    '</div>',
    onSave:async(bg)=>{
      const body={
        name:val(bg,'name'), slug:val(bg,'slug').toLowerCase(), heading:val(bg,'heading')||null,
        page_url:val(bg,'page_url'), sort_order:parseInt(val(bg,'sort_order')||'0',10),
        wtype:val(bg,'wtype')||'ST', scoring:val(bg,'scoring')||'PPR',
        positions:val(bg,'positions'), ppr_positions:val(bg,'ppr_positions')||null,
        half_positions:val(bg,'half_positions')||null,
        year:parseInt(val(bg,'year')||'2026',10), week:parseInt(val(bg,'week')||'0',10),
        height:val(bg,'height')||'800px',
        roster_attr:bg.querySelector('[name="roster_attr"]').value,
        primary_expert:val(bg,'primary_expert')||null,
        extra_filters:val(bg,'extra_filters')||null,
        is_active:bg.querySelector('[name="is_active"]').checked
      };
      if(!body.name) throw new Error('Page name is required');
      if(!body.slug) throw new Error('Slug is required');
      if(!body.page_url) throw new Error('Page URL is required');
      if(!body.positions) throw new Error('Positions are required');
      if(body.roster_attr==='filters' && !body.primary_expert) throw new Error('A primary expert is required when the roster lives in data-filters');
      if(body.roster_attr==='expert' && !body.extra_filters) throw new Error('Extra filters are required when the roster lives in data-expert');

      if(id){
        await dbPatch('ranking_pages?id=eq.'+id,body);
        const rows=[].slice.call(bg.querySelectorAll('.rr-row'));
        for(let i=0;i<rows.length;i++){
          const aid=rows[i].dataset.analyst;
          const ov=rows[i].querySelector('.rr-i').value.trim();
          await dbPatch('ranking_page_analysts?page_id=eq.'+id+'&analyst_id=eq.'+aid,{sort_order:(i+1)*10,fp_id_override:ov||null});
        }
        await dbDel('ranking_directory_hidden?page_id=eq.'+id);
        const hide=[].slice.call(bg.querySelectorAll('.rdh-c:checked')).map(c=>({page_id:id,analyst_id:c.dataset.analyst}));
        if(hide.length) await dbPost('ranking_directory_hidden',hide);
      } else {
        await dbPost('ranking_pages',body);
      }
      loadRankings(); toast(id?'Page updated':'Page added');
    }});
}

function rankRosterMove(btn,dir){
  const row=btn.closest('.rr-row'), list=row.parentElement;
  const rows=[].slice.call(list.children), i=rows.indexOf(row), j=i+dir;
  if(j<0||j>=rows.length) return;
  if(dir<0) list.insertBefore(row,rows[j]); else list.insertBefore(rows[j],row);
}

function rankPageDelete(id){
  const p=RANK_PAGES.find(x=>x.id===id)||{};
  confirmDelete(esc(p.name||'this page'),async()=>{
    await dbDel('ranking_pages?id=eq.'+id); loadRankings(); toast('Page removed');
  });
}

function rankAnalystsHtml(){
  if(!RANK_ANALYSTS.length) return '<div class="empty"><h4>No analysts yet</h4><p>Add each analyst once with their FantasyPros ID, then assign them to pages in the grid.</p>'+ifCan('rankings','c','<button class="btn btn-primary" onclick="rankAnalystForm()">+ Add analyst</button>')+'</div>';
  const rows=RANK_ANALYSTS.map(a=>{
    const on=RANK_LINKS.filter(l=>l.analyst_id===a.id).length;
    const st=RANK_STAFF.find(s=>s.id===a.staff_id);
    return '<tr class="'+(a.is_active===false?'rk-off':'')+'">'+
      '<td><strong>'+esc(a.name)+'</strong>'+(a.is_active===false?' '+badge('Inactive','var(--muted)'):'')+'</td>'+
      '<td class="mono">'+esc(a.fp_id)+'</td>'+
      '<td>'+(st?'<span class="chip chip-link" onclick=\'viewStaff("'+st.id+'")\'>'+esc(st.name)+'</span>':'<span style="color:var(--muted)">Not linked</span>')+'</td>'+
      '<td>'+on+' of '+RANK_PAGES.length+'</td>'+
      '<td class="row-actions">'+
        ifCan('rankings','u','<button class="btn btn-ghost btn-sm" onclick=\'rankAnalystForm("'+a.id+'")\'>Edit</button>')+
        ifCan('rankings','d','<button class="btn btn-danger btn-sm" onclick=\'rankAnalystDelete("'+a.id+'")\'>Delete</button>')+
      '</td></tr>';
  }).join('');
  return '<div class="panel"><div class="table-wrap"><table><thead><tr>'+
    '<th>Analyst</th><th>FantasyPros ID</th><th>Staff record</th><th>On pages</th><th></th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

function rankAnalystForm(id){
  const a=id?RANK_ANALYSTS.find(x=>x.id===id):{};
  modal({title:id?'Edit '+(a.name||'analyst'):'Add analyst',saveLabel:id?'Save changes':'Add analyst',
    body:'<div class="form-grid">'+
      '<div class="field"><label>Name</label><input name="name" value="'+esc(a.name||'')+'"></div>'+
      '<div class="field"><label>FantasyPros ID</label><input name="fp_id" placeholder="7357" value="'+esc(a.fp_id||'')+'"></div>'+
      '<div class="field full"><label>Name as FantasyPros spells it</label><input name="fp_name" placeholder="Leave blank to use the name above" value="'+esc(a.fp_name||'')+'"></div>'+
      '<div class="field full"><label>Staff record</label><select name="staff_id"><option value="">Not linked</option>'+
        RANK_STAFF.map(s=>'<option value="'+s.id+'"'+(a.staff_id===s.id?' selected':'')+'>'+esc(s.name)+'</option>').join('')+
      '</select></div>'+
      '<div class="field"><label>List order</label><input name="sort_order" type="number" value="'+(a.sort_order!=null?a.sort_order:(RANK_ANALYSTS.length+1)*10)+'"></div>'+
      '<div class="field"><label><input type="checkbox" name="is_active" '+(a.is_active===false?'':'checked')+'> Active</label></div>'+
    '</div>',
    onSave:async(bg)=>{
      const body={name:val(bg,'name'),fp_id:val(bg,'fp_id'),
        fp_name:val(bg,'fp_name')||null,
        staff_id:bg.querySelector('[name="staff_id"]').value||null,
        sort_order:parseInt(val(bg,'sort_order')||'0',10),
        is_active:bg.querySelector('[name="is_active"]').checked};
      if(!body.name) throw new Error('Name is required');
      if(!/^\d+$/.test(body.fp_id)) throw new Error('The FantasyPros ID should be numbers only');
      if(id) await dbPatch('ranking_analysts?id=eq.'+id,body); else await dbPost('ranking_analysts',body);
      loadRankings(); toast(id?'Analyst updated':'Analyst added');
    }});
}

function rankAnalystDelete(id){
  const a=RANK_ANALYSTS.find(x=>x.id===id)||{};
  const on=RANK_LINKS.filter(l=>l.analyst_id===id).length;
  confirmDelete(esc(a.name||'this analyst')+(on?' (on '+on+' page'+(on===1?'':'s')+')':''),async()=>{
    await dbDel('ranking_analysts?id=eq.'+id); loadRankings(); toast('Analyst removed');
  });
}

async function rankLiveOutput(slug){
  let cfg=null;
  try{ cfg=await rpc('rankings_public_config'); }catch(e){ toast(e.message,true); return; }
  const p=(cfg||[]).find(x=>x.slug===slug);
  modal({title:'Live output — '+slug,wide:true,footer:false,
    body: p ? '<p style="margin:0 0 12px;color:var(--muted);font-size:13.5px">This is exactly what the site receives for this page.</p><pre class="rank-pre">'+esc(JSON.stringify(p,null,2))+'</pre>'
            : '<div class="empty"><h4>Not published</h4><p>This page is switched off, so the site falls back to the attributes hardcoded in its HTML.</p></div>'});
}