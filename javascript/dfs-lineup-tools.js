(function(){
  var DK={pass_yards:0.04,pass_td:4,interceptions:-1,rush_yards:0.1,rush_td:6,
          receptions:1,rec_yards:0.1,rec_td:6};
  var CAP=50000,SLOTS=['QB','RB','RB','WR','WR','WR','TE','FLEX'],FLEX={RB:1,WR:1,TE:1};
  var ALL=[],PAYLOAD=null,sortKey='value',sortAsc=false,mode='balanced',locks={},bans={};

  function score(p){
    var keys=p.keys,cov=p.cov,w=[],i,j,mean=0;
    for(i=0;i<keys.length;i++){w[i]=DK[keys[i]]||0;mean+=w[i]*(p.proj[keys[i]]||0);}
    var varr=0,idx=0;
    for(i=0;i<keys.length;i++)for(j=i;j<keys.length;j++){varr+=(i===j?1:2)*w[i]*w[j]*cov[idx];idx++;}
    var sd=Math.sqrt(Math.max(varr,0));
    return {pts:mean,floor:Math.max(0,mean+(p.z10||-1.2)*sd),ceil:mean+(p.z90||1.35)*sd};
  }

  function objective(r){return mode==='cash'?r.floor:mode==='gpp'?r.ceil:r.pts;}

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

  var RAMP=[[75,143,224],[255,165,21],[66,244,176]];
  function chipColor(t){
    t=Math.max(0,Math.min(1,t));
    var seg=t<0.5?0:1,f=t<0.5?t/0.5:(t-0.5)/0.5,a=RAMP[seg],b=RAMP[seg+1],rgb=[];
    for(var i=0;i<3;i++)rgb[i]=Math.round(a[i]+(b[i]-a[i])*f);
    return {fg:'rgb('+rgb.join(',')+')',bg:'rgba('+rgb.join(',')+',.11)',br:'rgba('+rgb.join(',')+',.34)'};
  }

  function pool(){
    return ALL.filter(function(p){return p.salary&&!bans[p.id];}).map(function(p){
      var s=score(p);
      return {p:p,pts:s.pts,floor:s.floor,ceil:s.ceil,value:s.pts/(p.salary/1000)};
    });
  }

  function eligible(rows,slot){
    return rows.filter(function(r){
      return slot==='FLEX'?FLEX[r.p.pos]:r.p.pos===slot;
    });
  }

  function build(){
    var rows=pool(),reserve=Math.max(0,parseInt(document.getElementById('dfsDst').value,10)||0),
        cap=CAP-reserve,stack=document.getElementById('dfsStack').checked,
        avoid=document.getElementById('dfsNoOpp').checked,
        locked=rows.filter(function(r){return locks[r.p.id];});

    if(locked.length>8)return fail('You have more than eight players locked. Unlock a few and build again.');

    var best=null;
    for(var attempt=0;attempt<420;attempt++){
      var lineup=seed(rows,locked,cap,stack,avoid,attempt);
      if(!lineup)continue;
      lineup=improve(lineup,rows,cap,stack,avoid);
      var tot=lineup.reduce(function(a,r){return a+objective(r);},0);
      if(!best||tot>best.total)best={picks:lineup,total:tot};
    }
    if(!best)return fail('No valid lineup fits under the cap with those settings. Try lowering the DST reserve or unlocking a player.');
    show(best.picks,reserve);
  }

  function seed(rows,locked,cap,stack,avoid,attempt){
    var used={},picks=[],spent=0,i;
    locked.forEach(function(r){used[r.p.id]=1;spent+=r.p.salary;});
    if(spent>cap)return null;

    var order=SLOTS.slice(),lockedBySlot=assign(locked);
    if(!lockedBySlot)return null;

    var qb=lockedBySlot.QB?lockedBySlot.QB[0]:null;
    if(!qb){
      var qbs=eligible(rows,'QB').filter(function(r){return !used[r.p.id]&&spent+r.p.salary<=cap;});
      qbs.sort(function(a,b){return objective(b)-objective(a);});
      if(!qbs.length)return null;
      qb=qbs[Math.min(qbs.length-1,Math.floor(Math.random()*Math.min(qbs.length,8*(1+attempt%3))))];
      used[qb.p.id]=1;spent+=qb.p.salary;
    }
    picks.push({slot:'QB',r:qb});

    var remaining=order.slice(1),needStack=stack;
    for(i=0;i<remaining.length;i++){
      var slot=remaining[i],pre=lockedBySlot[slot]&&lockedBySlot[slot].length?lockedBySlot[slot].shift():null;
      if(pre){picks.push({slot:slot,r:pre});if(sameTeam(pre,qb))needStack=false;continue;}
      var left=remaining.length-i,
          cands=eligible(rows,slot).filter(function(r){
            if(used[r.p.id])return false;
            if(spent+r.p.salary+(left-1)*2800>cap)return false;
            if(avoid&&r.p.pos==='RB'&&r.p.team===qb.p.opp)return false;
            return true;
          });
      if(needStack&&i===remaining.length-1){
        var st=cands.filter(function(r){return sameTeam(r,qb);});
        if(st.length)cands=st;
      }
      if(!cands.length)return null;
      cands.sort(function(a,b){return objective(b)/b.p.salary-objective(a)/a.p.salary;});
      var span=Math.max(1,Math.min(cands.length,6+attempt%7)),
          pick=cands[Math.floor(Math.random()*span)];
      used[pick.p.id]=1;spent+=pick.p.salary;
      if(sameTeam(pick,qb))needStack=false;
      picks.push({slot:slot,r:pick});
    }
    if(needStack)return null;
    return picks;
  }

  function assign(locked){
    var by={},i,r;
    for(i=0;i<locked.length;i++){
      r=locked[i];
      var slot=r.p.pos;
      by[slot]=by[slot]||[];by[slot].push(r);
    }
    var counts={QB:1,RB:2,WR:3,TE:1},flex=0;
    for(var k in by){
      var over=by[k].length-(counts[k]||0);
      if(over>0){
        if(!FLEX[k])return null;
        flex+=over;
      }
    }
    if(flex>1)return null;
    return by;
  }

  function sameTeam(a,b){return a.p.team===b.p.team&&a.p.id!==b.p.id;}

  function improve(picks,rows,cap,stack,avoid){
    var used={},spent=0;
    picks.forEach(function(x){used[x.r.p.id]=1;spent+=x.r.p.salary;});
    var qb=picks[0].r,improved=true,guard=0;

    while(improved&&guard++<40){
      improved=false;
      for(var i=0;i<picks.length;i++){
        var cur=picks[i];
        if(locks[cur.r.p.id])continue;
        var room=cap-spent+cur.r.p.salary;
        var cands=eligible(rows,cur.slot).filter(function(r){
          if(used[r.p.id]||r.p.salary>room)return false;
          if(avoid&&r.p.pos==='RB'&&r.p.team===qb.p.opp)return false;
          return objective(r)>objective(cur.r);
        });
        if(!cands.length)continue;
        cands.sort(function(a,b){return objective(b)-objective(a);});
        var next=cands[0];
        if(stack&&i>0&&sameTeam(cur.r,qb)){
          var still=picks.some(function(x,j){return j!==i&&j>0&&sameTeam(x.r,qb);});
          if(!still&&!sameTeam(next,qb))continue;
        }
        delete used[cur.r.p.id];used[next.p.id]=1;
        spent+=next.p.salary-cur.r.p.salary;
        picks[i]={slot:cur.slot,r:next};
        improved=true;
      }
    }
    return picks;
  }

  function fail(msg){
    document.getElementById('dfsLineup').innerHTML='';
    document.getElementById('dfsTotals').innerHTML='';
    document.getElementById('dfsWarn').textContent=msg;
  }

  function show(picks,reserve){
    var sal=0,pts=0,floor=0,ceil=0;
    var html=picks.map(function(x){
      sal+=x.r.p.salary;pts+=x.r.pts;floor+=x.r.floor;ceil+=x.r.ceil;
      return '<tr><td class="dfs-slot">'+x.slot+'</td>'+
        '<td class="dfs-who">'+esc(x.r.p.name)+'<small>'+esc(x.r.p.team)+' '+(x.r.p.home?'vs ':'@ ')+esc(x.r.p.opp)+'</small></td>'+
        '<td class="dfs-sal">$'+x.r.p.salary.toLocaleString()+'</td>'+
        '<td class="dfs-pts">'+x.r.pts.toFixed(1)+'</td></tr>';
    }).join('');
    html+='<tr><td class="dfs-slot">DST</td><td class="dfs-who dfs-open">Pick your own</td>'+
          '<td class="dfs-sal">$'+reserve.toLocaleString()+'</td><td class="dfs-pts">—</td></tr>';
    document.getElementById('dfsLineup').innerHTML=html;

    var left=CAP-sal-reserve;
    document.getElementById('dfsTotals').innerHTML=
      '<div>Salary used<b>$'+(sal+reserve).toLocaleString()+'</b></div>'+
      '<div>Left over<b>$'+left.toLocaleString()+'</b></div>'+
      '<div>Projected<b>'+pts.toFixed(1)+'</b></div>'+
      '<div>Floor → ceiling<b>'+floor.toFixed(0)+' → '+ceil.toFixed(0)+'</b></div>';
    document.getElementById('dfsWarn').textContent=
      left>2500?'Over $2,500 unspent on the skill positions — a pricier DST or a bigger reserve may use the cap better.':'';
  }

  function render(){
    var pos=document.getElementById('dfsPos').value,
        team=document.getElementById('dfsTeam').value,
        q=document.getElementById('dfsSearch').value.trim().toLowerCase(),
        maxSal=parseInt(document.getElementById('dfsMax').value,10)||0,
        rows=[];

    ALL.forEach(function(p){
      if(!p.salary)return;
      if(pos&&p.pos!==pos)return;
      if(team&&p.team!==team)return;
      if(q&&p.name.toLowerCase().indexOf(q)<0)return;
      if(maxSal&&p.salary>=maxSal)return;
      var s=score(p);
      rows.push({p:p,pts:s.pts,floor:s.floor,ceil:s.ceil,value:s.pts/(p.salary/1000)});
    });

    rows.sort(function(a,b){
      var x,y;
      if(sortKey==='name'){x=a.p.name;y=b.p.name;}
      else if(sortKey==='pos'){x=a.p.pos;y=b.p.pos;}
      else if(sortKey==='opp'){x=a.p.opp;y=b.p.opp;}
      else if(sortKey==='salary'){x=a.p.salary;y=b.p.salary;}
      else if(sortKey==='floor'){x=a.floor;y=b.floor;}
      else if(sortKey==='ceil'){x=a.ceil;y=b.ceil;}
      else if(sortKey==='pts'){x=a.pts;y=b.pts;}
      else {x=a.value;y=b.value;}
      if(x<y)return sortAsc?-1:1;
      if(x>y)return sortAsc?1:-1;
      return 0;
    });

    var vals=rows.map(function(r){return r.value;}).sort(function(a,b){return a-b;});
    function pct(v){
      var lo=0,hi=vals.length;
      while(lo<hi){var m=(lo+hi)>>1;if(vals[m]<v)lo=m+1;else hi=m;}
      return vals.length>1?lo/(vals.length-1):0.5;
    }

    document.getElementById('dfsBody').innerHTML=rows.map(function(r){
      var p=r.p,c=chipColor(rows.length>3?pct(r.value):0.5);
      return '<tr class="'+(locks[p.id]?'dfs-locked':bans[p.id]?'dfs-banned':'')+'">'+
        '<td><span class="dfs-name">'+esc(p.name)+'<small><span class="dfs-mpos dfs-'+esc(p.pos)+'">'+esc(p.pos)+'</span>'+esc(p.team)+' '+(p.home?'vs ':'@ ')+esc(p.opp)+'</small></span></td>'+
        '<td><span class="dfs-pos dfs-'+esc(p.pos)+'">'+esc(p.pos)+'</span></td>'+
        '<td class="dfs-num">'+(p.home?'vs ':'@ ')+esc(p.opp)+'</td>'+
        '<td class="dfs-num">$'+p.salary.toLocaleString()+'</td>'+
        '<td class="dfs-num dfs-range">'+r.floor.toFixed(1)+'<em>→</em>'+r.ceil.toFixed(1)+'</td>'+
        '<td class="dfs-num">'+r.pts.toFixed(1)+'</td>'+
        '<td><span class="dfs-chip" style="color:'+c.fg+';background:'+c.bg+';border-color:'+c.br+'">'+r.value.toFixed(2)+'</span></td>'+
        '<td class="dfs-acts">'+
          '<button class="dfs-act" data-lock="'+esc(p.id)+'" title="Lock into lineup" aria-label="Lock '+esc(p.name)+' into lineup" aria-pressed="'+(locks[p.id]?'true':'false')+'">Lock</button>'+
          '<button class="dfs-act dfs-ban" data-ban="'+esc(p.id)+'" title="Fade this player" aria-label="Fade '+esc(p.name)+'" aria-pressed="'+(bans[p.id]?'true':'false')+'">Fade</button>'+
        '</td></tr>';
    }).join('');

    document.getElementById('dfsEmpty').hidden=rows.length>0;
    document.getElementById('dfsCount').textContent='Showing '+rows.length+' priced players';
  }

  function bind(){
    ['dfsPos','dfsTeam','dfsSearch','dfsMax'].forEach(function(id){
      var el=document.getElementById(id);
      el.addEventListener(el.tagName==='SELECT'?'change':'input',render);
    });
    document.querySelectorAll('table.dfs thead th[data-sort]').forEach(function(th){
      th.addEventListener('click',function(){
        var k=th.dataset.sort;
        if(sortKey===k)sortAsc=!sortAsc;else{sortKey=k;sortAsc=(k==='name'||k==='pos'||k==='opp');}
        document.querySelectorAll('table.dfs thead th').forEach(function(o){o.classList.remove('dfs-active','dfs-asc');});
        th.classList.add('dfs-active');if(sortAsc)th.classList.add('dfs-asc');
        render();
      });
    });
    document.getElementById('dfsBody').addEventListener('click',function(e){
      var lk=e.target.closest('[data-lock]'),bn=e.target.closest('[data-ban]');
      if(lk){var id=lk.dataset.lock;if(locks[id])delete locks[id];else{locks[id]=1;delete bans[id];}render();}
      else if(bn){var b=bn.dataset.ban;if(bans[b])delete bans[b];else{bans[b]=1;delete locks[b];}render();}
    });
    document.querySelectorAll('.dfs-mode').forEach(function(b){
      b.addEventListener('click',function(){
        mode=b.dataset.mode;
        document.querySelectorAll('.dfs-mode').forEach(function(o){o.setAttribute('aria-pressed',o===b?'true':'false');});
        render();
      });
    });
    document.getElementById('dfsBuild').addEventListener('click',build);
  }

  function token(){return localStorage.getItem('sb-auth-token');}

  function start(){
    document.getElementById('dfsApp').hidden=false;
    bind();
    fetch(SUPABASE_URL+'/rest/v1/player_proj?id=eq.1&select=data',
          {headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token()}})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(function(j){
        if(!j.length||!j[0].data)throw new Error('empty');
        PAYLOAD=j[0].data;
        ALL=(PAYLOAD.players||[]).map(function(p,i){p.id=p.name+'|'+p.team+'|'+i;return p;});
        var priced=ALL.filter(function(p){return p.salary;});
        var teams=[];priced.forEach(function(p){if(teams.indexOf(p.team)<0)teams.push(p.team);});
        teams.sort();
        var sel=document.getElementById('dfsTeam');
        teams.forEach(function(t){var o=document.createElement('option');o.value=t;o.textContent=t;sel.appendChild(o);});
        var when=PAYLOAD.generated_at?new Date(PAYLOAD.generated_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
        document.getElementById('dfsMeta').textContent=
          priced.length+' priced players · DraftKings Classic'+(when?' · updated '+when:'');
        if(!priced.length){
          document.getElementById('dfsEmpty').hidden=false;
          document.getElementById('dfsEmpty').textContent='No DraftKings salaries in this week\\u2019s data yet.';
          document.getElementById('dfsBuild').disabled=true;
          return;
        }
        render();
      })
      .catch(function(err){
        document.getElementById('dfsEmpty').hidden=false;
        document.getElementById('dfsEmpty').textContent=
          err.message==='empty'
            ? 'Projections for this week are not published yet. Check back after the daily update.'
            : 'Could not load projections. Refresh the page to try again.';
        document.getElementById('dfsBuild').disabled=true;
      });
  }

  function gate(){
    document.getElementById('dfsGate').hidden=false;
    document.getElementById('dfsLogin').addEventListener('click',function(){
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