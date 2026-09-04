(function(){
  'use strict';
  var CFG=null, DATA=[], CHANNELS=[], SHOWS=[], ACTIVE={type:'all',id:null};

  function sbCfg(){
    var url=(typeof SUPABASE_URL!=='undefined')?SUPABASE_URL:window.SUPABASE_URL;
    var key=(typeof SUPABASE_ANON_KEY!=='undefined')?SUPABASE_ANON_KEY:window.SUPABASE_ANON_KEY;
    return (url&&key)?{url:url,key:key}:null;
  }
  function esc(s){
    return String(s===null||s===undefined?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function headshotUrl(v){
    if(!v) return 'assets/headshots/placeholder.png';
    if(/^https?:\/\//i.test(v)) return v;
    return v.indexOf('/')>=0 ? v.replace(/^\/+/,'') : 'assets/headshots/'+v;
  }
  function rpc(fn){
    return fetch(CFG.url+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:CFG.key,Authorization:'Bearer '+CFG.key},body:'{}'})
      .then(function(r){ if(!r.ok) throw new Error(fn+' '+r.status); return r.json(); });
  }

  function buildFilters(){
    var chMap={}, swMap={};
    DATA.forEach(function(s){
      (s.shows||[]).forEach(function(sh){
        if(sh.channel_id){ chMap[sh.channel_id]=sh.channel_name; }
        if(sh.show_id){ swMap[sh.show_id]={name:sh.show_name, channel_id:sh.channel_id}; }
      });
    });
    CHANNELS=Object.keys(chMap).map(function(id){return {id:id,name:chMap[id]};}).sort(function(a,b){return a.name.localeCompare(b.name);});
    SHOWS=Object.keys(swMap).map(function(id){return {id:id,name:swMap[id].name};}).sort(function(a,b){return a.name.localeCompare(b.name);});
  }

  function chunkEven(list, maxPerRow){
  if(!list.length) return [];
  var rows=Math.max(1, Math.ceil(list.length/maxPerRow));
  var perRow=Math.ceil(list.length/rows);
  var out=[];
  for(var i=0;i<list.length;i+=perRow){ out.push(list.slice(i,i+perRow)); }
  return out;
}

function filterBtn(type, id, label){
  var on=ACTIVE.type===type&&(id==null||ACTIVE.id===id);
  return '<button class="team-filter-btn'+(on?' on':'')+'" data-type="'+type+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+esc(label)+'</button>';
}

function renderFilters(){
  var el=document.getElementById('teamFilters'); if(!el) return;
  var html='<div class="team-filter-row">'+filterBtn('all',null,'All Staff')+'</div>';

  if(CHANNELS.length){
    html+='<div class="team-filter-section"><div class="team-filter-label-row">Channels</div>';
    chunkEven(CHANNELS,6).forEach(function(row){
      html+='<div class="team-filter-row">'+row.map(function(c){return filterBtn('channel',c.id,c.name);}).join('')+'</div>';
    });
    html+='</div>';
  }

  if(SHOWS.length){
    html+='<div class="team-filter-section"><div class="team-filter-label-row">Shows</div>';
    chunkEven(SHOWS,5).forEach(function(row){
      html+='<div class="team-filter-row">'+row.map(function(s){return filterBtn('show',s.id,s.name);}).join('')+'</div>';
    });
    html+='</div>';
  }

  el.innerHTML=html;
  el.querySelectorAll('.team-filter-btn').forEach(function(b){
    b.addEventListener('click', function(){ ACTIVE={type:b.dataset.type, id:b.dataset.id||null}; renderFilters(); renderCards(); });
  });
}

  function matchesFilter(s){
    if(ACTIVE.type==='all') return true;
    if(!s.shows || !s.shows.length) return false;
    if(ACTIVE.type==='channel') return s.shows.some(function(sh){return sh.channel_id===ACTIVE.id;});
    if(ACTIVE.type==='show') return s.shows.some(function(sh){return sh.show_id===ACTIVE.id;});
    return true;
  }

  function renderCards(){
    var grid=document.getElementById('teamGrid'); if(!grid) return;
    var rows=DATA.filter(matchesFilter);
    if(!rows.length){ grid.innerHTML='<p class="team-empty">No staff match this filter yet.</p>'; return; }
    grid.innerHTML=rows.map(function(s){
      return '<div class="team-card">'+
        '<img src="'+esc(headshotUrl(s.headshot))+'" alt="'+esc(s.name)+'" onerror="this.src=\'assets/headshots/placeholder.png\'">'+
        '<h3>'+esc(s.name)+'</h3>'+
        (s.role?'<p class="team-role">'+esc(s.role)+'</p>':'')+
        (s.department?'<span class="team-dept">'+esc(s.department)+'</span>':'')+
      '</div>';
    }).join('');
  }

  function boot(){
    CFG=sbCfg();
    var grid=document.getElementById('teamGrid');
    if(!CFG){ if(grid) grid.innerHTML='<p class="team-empty">Unable to load the team right now.</p>'; return; }
    rpc('team_public').then(function(rows){
      DATA=rows||[]; buildFilters(); renderFilters(); renderCards();
    }).catch(function(e){
      console.error(e);
      if(grid) grid.innerHTML='<p class="team-empty">Unable to load the team right now.</p>';
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();