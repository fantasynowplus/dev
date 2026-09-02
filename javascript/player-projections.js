(function(){
  var DEFAULTS={pass_yards:0.04,pass_td:4,interceptions:-2,rush_yards:0.1,rush_td:6,receptions:1,rec_yards:0.1,rec_td:6,te_prem:0};
  var PRESETS={
    ppr:{},
    half:{receptions:0.5},
    standard:{receptions:0},
    superflex:{pass_td:6}
  };
  var FIELDS=['pass_yards','pass_td','interceptions','rush_yards','rush_td','receptions','rec_yards','rec_td','te_prem'];
  var STORE='fnp-scoring-v1';
  var ALL=[],PAYLOAD=null,sortKey='pts',sortAsc=false,rules=load(),MODE='week',CACHE={};

  function load(){
    try{var s=JSON.parse(localStorage.getItem(STORE));if(s&&typeof s==='object')return Object.assign({},DEFAULTS,s);}catch(e){}
    return Object.assign({},DEFAULTS);
  }
  function save(){try{localStorage.setItem(STORE,JSON.stringify(rules));}catch(e){}}

  function labelFor(r){
    for(var k in PRESETS){
      var t=Object.assign({},DEFAULTS,PRESETS[k]),same=true;
      for(var i=0;i<FIELDS.length;i++){if(Math.abs((r[FIELDS[i]]||0)-(t[FIELDS[i]]||0))>1e-9){same=false;break;}}
      if(same)return k==='half'?'Half PPR':k==='ppr'?'PPR':k==='standard'?'Standard':'Superflex';
    }
    return 'Custom';
  }

  function weights(pos){
    var w={pass_yards:rules.pass_yards,pass_td:rules.pass_td,interceptions:rules.interceptions,
           rush_yards:rules.rush_yards,rush_td:rules.rush_td,rec_yards:rules.rec_yards,rec_td:rules.rec_td,
           receptions:rules.receptions+(pos==='TE'?(rules.te_prem||0):0)};
    return w;
  }

  function score(p){
    var w=weights(p.pos),keys=p.keys,cov=p.cov,v=[],i,j,mean=0;
    for(i=0;i<keys.length;i++){v[i]=w[keys[i]]||0;mean+=v[i]*(p.proj[keys[i]]||0);}
    var varr=0,idx=0;
    for(i=0;i<keys.length;i++){
      for(j=i;j<keys.length;j++){varr+=(i===j?1:2)*v[i]*v[j]*cov[idx];idx++;}
    }
    var sd=Math.sqrt(Math.max(varr,0));
    return {pts:mean,sd:sd,floor:mean+(p.z10||-1.2)*sd,ceil:mean+(p.z90||1.35)*sd};
  }

  function line(p){
    var s=p.proj,f=function(n,d){return (n||0).toFixed(d===undefined?0:d);};
    if(p.pos==='QB')return f(s.completions)+'/'+f(s.pass_att)+', '+f(s.pass_yards)+' yd, '+f(s.pass_td,1)+' TD, '+f(s.rush_yards)+' rush';
    if(p.pos==='RB')return f(s.rush_att)+' car, '+f(s.rush_yards)+' yd, '+f(s.receptions,1)+' rec, '+f(s.rec_yards)+' yd';
    return f(s.receptions,1)+'/'+f(s.targets,1)+' tgt, '+f(s.rec_yards)+' yd, '+f(s.rec_td,1)+' TD';
  }

  function render(){
    var pos=document.getElementById('ppPos').value,
        team=document.getElementById('ppTeam').value,
        q=document.getElementById('ppSearch').value.trim().toLowerCase(),
        rows=[];

    ALL.forEach(function(p){
      if(pos&&p.pos!==pos)return;
      if(team&&p.team!==team)return;
      if(q&&p.name.toLowerCase().indexOf(q)<0)return;
      var s=score(p);
      rows.push({p:p,pts:s.pts,floor:s.floor,ceil:s.ceil});
    });

    rows.sort(function(a,b){
      var x,y;
      if(sortKey==='name'){x=a.p.name;y=b.p.name;}
      else if(sortKey==='pos'){x=a.p.pos;y=b.p.pos;}
      else if(sortKey==='opp'){
        if(MODE==='season'){x=a.p.games||0;y=b.p.games||0;}
        else {x=a.p.opp;y=b.p.opp;}
      }
      else if(sortKey==='floor'){x=a.floor;y=b.floor;}
      else if(sortKey==='ceil'){x=a.ceil;y=b.ceil;}
      else {x=a.pts;y=b.pts;}
      if(x<y)return sortAsc?-1:1;
      if(x>y)return sortAsc?1:-1;
      return 0;
    });

    var byPos={};
    rows.forEach(function(r){(byPos[r.p.pos]=byPos[r.p.pos]||[]).push(r.pts);});
    for(var k in byPos)byPos[k].sort(function(a,b){return a-b;});
    function posRank(pos,v){
      var arr=byPos[pos];
      if(!arr||arr.length<4)return 0.5;
      var lo=0,hi=arr.length;
      while(lo<hi){var m=(lo+hi)>>1;if(arr[m]<v)lo=m+1;else hi=m;}
      return lo/(arr.length-1);
    }

    var html=rows.map(function(r){
      var p=r.p;
      var c=projColor(posRank(p.pos,r.pts));
      return '<tr>'+
        '<td><span class="pp-name">'+esc(p.name)+'</span><span class="pp-sub">'+
          '<span class="pp-mpos pp-'+esc(p.pos)+'">'+esc(p.pos)+'</span>'+
          esc(p.team)+'<span class="pp-mmatch"> '+(MODE==='season'?(p.games||17)+' games':(p.home?'vs ':'@ ')+esc(p.opp))+'</span></span></td>'+
        '<td><span class="pp-pos pp-'+esc(p.pos)+'">'+esc(p.pos)+'</span></td>'+
        '<td class="pp-stats">'+(MODE==='season'?(p.games||17)+' games':(p.home?'vs ':'@ ')+esc(p.opp))+'</td>'+
        '<td class="pp-num pp-floor">'+Math.max(0,r.floor).toFixed(1)+'</td>'+
        '<td class="pp-num pp-ceil">'+r.ceil.toFixed(1)+'</td>'+
        '<td><span class="pp-projchip" style="color:'+c.fg+';background:'+c.bg+';border-color:'+c.br+'">'+r.pts.toFixed(1)+'</span>'+
          (MODE==='season'&&p.games?'<span class="pp-ppg">'+(r.pts/p.games).toFixed(1)+' per game</span>':'')+'</td>'+
        '<td class="pp-stats">'+esc(line(p))+'</td>'+
      '</tr>'+
      '<tr class="pp-lrow"><td colspan="7">'+esc(line(p))+'</td></tr>';
    }).join('');

    document.getElementById('ppBody').innerHTML=html;
    document.getElementById('ppEmpty').hidden=rows.length>0;
    document.getElementById('ppCount').textContent='Showing '+rows.length+' of '+ALL.length+' players';
    document.getElementById('ppScoringTag').textContent=labelFor(rules);
  }

  var RAMP=[[234,78,61],[75,143,224],[66,244,176]];
  function projColor(t){
    t=Math.max(0,Math.min(1,t));
    var seg=t<0.5?0:1,f=t<0.5?t/0.5:(t-0.5)/0.5,a=RAMP[seg],b=RAMP[seg+1],rgb=[];
    for(var i=0;i<3;i++)rgb[i]=Math.round(a[i]+(b[i]-a[i])*f);
    return {fg:'rgb('+rgb.join(',')+')',
            bg:'rgba('+rgb.join(',')+',.11)',
            br:'rgba('+rgb.join(',')+',.34)'};
  }

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

  function syncInputs(){
    FIELDS.forEach(function(f){var el=document.getElementById('s_'+f);if(el)el.value=rules[f];});
    var lab=labelFor(rules);
    document.querySelectorAll('.pp-preset').forEach(function(b){
      var t=b.dataset.preset;
      var match=(t==='ppr'&&lab==='PPR')||(t==='half'&&lab==='Half PPR')||(t==='standard'&&lab==='Standard')||(t==='superflex'&&lab==='Superflex');
      b.setAttribute('aria-pressed',match?'true':'false');
    });
  }

  function bind(){
    FIELDS.forEach(function(f){
      var el=document.getElementById('s_'+f);
      if(el)el.addEventListener('input',function(){
        var v=parseFloat(el.value);rules[f]=isNaN(v)?0:v;save();syncInputs();render();
      });
    });
    document.querySelectorAll('.pp-preset').forEach(function(b){
      b.addEventListener('click',function(){
        rules=Object.assign({},DEFAULTS,PRESETS[b.dataset.preset]);save();syncInputs();render();
      });
    });
    ['ppPos','ppTeam','ppSearch'].forEach(function(id){
      var el=document.getElementById(id);
      el.addEventListener(el.tagName==='SELECT'?'change':'input',render);
    });
    document.querySelectorAll('.pp-mode').forEach(function(b){
      b.addEventListener('click',function(){switchMode(b.dataset.mode);});
    });
    document.getElementById('ppImport').addEventListener('click',importScoring);
    document.getElementById('ppLeague').addEventListener('change',function(){
      setMsg('','');
    });
    document.querySelectorAll('table.pp thead th[data-sort]').forEach(function(th){
      th.addEventListener('click',function(){
        var k=th.dataset.sort;
        if(sortKey===k)sortAsc=!sortAsc;else{sortKey=k;sortAsc=(k==='name'||k==='pos'||k==='opp');}
        document.querySelectorAll('table.pp thead th').forEach(function(o){o.classList.remove('pp-active','pp-asc');});
        th.classList.add('pp-active');if(sortAsc)th.classList.add('pp-asc');
        render();
      });
    });
  }

  function setMsg(text,kind){
    var m=document.getElementById('ppSleeperMsg');
    m.textContent=text;
    m.className='pp-sleeper-msg'+(kind?' pp-'+kind:'');
  }

  function token(){return localStorage.getItem('sb-auth-token');}
  function sbHeaders(){return {apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token()};}

  function applyPayload(data){
    PAYLOAD=data;ALL=data.players||[];
    var teams=[];ALL.forEach(function(p){if(teams.indexOf(p.team)<0)teams.push(p.team);});
    teams.sort();
    var sel=document.getElementById('ppTeam'),keep=sel.value;
    sel.innerHTML='<option value="">All teams</option>';
    teams.forEach(function(t){
      var o=document.createElement('option');o.value=t;o.textContent=t;
      if(t===keep)o.selected=true;
      sel.appendChild(o);
    });
    document.getElementById('ppCol3').textContent=MODE==='season'?'Games':'Matchup';

    var lock=document.getElementById('ppLock');
    if(MODE==='season'&&data.locks_at){
      var when=new Date(data.locks_at),locked=Date.now()>=when.getTime(),
          d=when.toLocaleDateString(undefined,{month:'long',day:'numeric'});
      lock.hidden=false;
      lock.innerHTML=locked
        ? '<b>Locked preseason benchmark.</b> These are the season projections we published before kickoff on '+d+
          '. They do not update for injuries, trades or usage changes — the point is to have a fixed line to measure the season against. For current numbers, switch to This week.'
        : '<b>Preseason benchmark.</b> Still updating daily as rosters and lines firm up. It locks for good at kickoff on '+d+'.';
    } else {
      lock.hidden=true;
    }
    var when=data.generated_at?new Date(data.generated_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
    document.getElementById('ppMeta').textContent=
      ALL.length+' players · '+(MODE==='season'?'full season · ':'this week · ')+
      (data.n_sims||0).toLocaleString()+' sims per game'+(when?' · updated '+when:'');
  }

  function loadProjections(){
    if(CACHE[MODE]){applyPayload(CACHE[MODE]);return Promise.resolve();}
    var id=MODE==='season'?2:1;
    return fetch(SUPABASE_URL+'/rest/v1/player_proj?id=eq.'+id+'&select=data',{headers:sbHeaders()})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(function(j){
        if(!j.length||!j[0].data)throw new Error('empty');
        CACHE[MODE]=j[0].data;
        applyPayload(j[0].data);
      });
  }

  function switchMode(next){
    if(next===MODE)return;
    MODE=next;
    document.querySelectorAll('.pp-mode').forEach(function(b){
      b.setAttribute('aria-pressed',b.dataset.mode===MODE?'true':'false');
    });
    document.getElementById('ppBody').innerHTML='';
    document.getElementById('ppEmpty').hidden=true;
    loadProjections().then(render).catch(function(err){
      document.getElementById('ppEmpty').hidden=false;
      document.getElementById('ppEmpty').textContent=
        err.message==='empty'
          ? (MODE==='season'
              ? 'Season projections have not been published yet. They rebuild every Tuesday.'
              : 'Projections for this week are not published yet. Check back after the daily update.')
          : 'Could not load projections. Refresh the page to try again.';
    });
  }

  function loadLeagues(){
    var sel=document.getElementById('ppLeague');
    fetch(SUPABASE_URL+'/rest/v1/sleeper_leagues?select=*',{headers:sbHeaders()})
      .then(function(r){return r.ok?r.json():[];})
      .then(function(rows){
        sel.innerHTML='';
        if(!rows.length){
          sel.innerHTML='<option value="">No synced leagues</option>';
          setMsg('Sync your Sleeper account from your profile to pull scoring straight from your league.','');
          return;
        }
        var opt=document.createElement('option');opt.value='';opt.textContent='Choose a league…';sel.appendChild(opt);
        rows.forEach(function(row){
          var id=row.league_id||row.sleeper_league_id||row.id;
          var nm=row.name||row.league_name||('League '+id);
          if(!id)return;
          var o=document.createElement('option');o.value=id;o.textContent=nm;sel.appendChild(o);
        });
      })
      .catch(function(){sel.innerHTML='<option value="">Could not load leagues</option>';});
  }

  function importScoring(){
    var id=document.getElementById('ppLeague').value;
    if(!id){setMsg('Pick a league first.','bad');return;}
    setMsg('Reading your league settings…','');
    fetch('https://api.sleeper.app/v1/league/'+id)
      .then(function(r){if(!r.ok)throw new Error();return r.json();})
      .then(function(lg){
        var s=lg.scoring_settings||{};
        function pick(k,d){return typeof s[k]==='number'?s[k]:d;}
        rules={
          pass_yards:pick('pass_yd',DEFAULTS.pass_yards),
          pass_td:pick('pass_td',DEFAULTS.pass_td),
          interceptions:pick('pass_int',DEFAULTS.interceptions),
          rush_yards:pick('rush_yd',DEFAULTS.rush_yards),
          rush_td:pick('rush_td',DEFAULTS.rush_td),
          receptions:pick('rec',DEFAULTS.receptions),
          rec_yards:pick('rec_yd',DEFAULTS.rec_yards),
          rec_td:pick('rec_td',DEFAULTS.rec_td),
          te_prem:pick('bonus_rec_te',0)
        };
        save();syncInputs();render();
        document.getElementById('ppScoringTag').textContent=lg.name||'My league';
        setMsg('Scoring loaded from '+(lg.name||'your league')+'. The board is rescored.','ok');
      })
      .catch(function(){setMsg('Could not reach Sleeper for that league. Try again in a moment.','bad');});
  }

  function start(){
    document.getElementById('ppApp').hidden=false;
    syncInputs();bind();
    loadProjections().then(function(){render();loadLeagues();})
      .catch(function(err){
        document.getElementById('ppBody').innerHTML='';
        document.getElementById('ppEmpty').hidden=false;
        document.getElementById('ppEmpty').textContent =
          err.message==='empty'
            ? 'Projections for this week are not published yet. Check back after the daily update.'
            : 'Could not load projections. Refresh the page to try again.';
      });
  }

  function gate(){
    document.getElementById('ppGate').hidden=false;
    document.getElementById('ppLogin').addEventListener('click',function(){
      var m=document.getElementById('loginBackdrop');
      if(m)m.style.display='flex';else window.location.href='login';
    });
  }

  function boot(tries){
    if(typeof auth==='undefined'||typeof SUPABASE_URL==='undefined'){
      if(tries>60)return gate();
      return setTimeout(function(){boot((tries||0)+1);},100);
    }
    if(auth.isAuthenticated&&auth.isAuthenticated()&&token())start();else gate();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){boot(0);});
  else boot(0);
})();
