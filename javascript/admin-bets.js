var BT = {
  season: new Date().getFullYear(),
  week: null,
  tab: 'mine',
  bets: [], books: [], staff: [], board: [], house: null,
  players: null, busy: {}
};

var BT_LAST = { week: null, book: '', units: 1, bettor: null, date: null };

var BT_STATS = {
  QB: [['Pass Yards','pass_yd',1],['Pass TDs','pass_td',1],['Completions','pass_cmp',1],
       ['Pass Attempts','pass_att',1],['Interceptions','pass_int',1],['Rush Yards','rush_yd',1],
       ['Pass + Rush Yards','pass_rush_yd',1],['Anytime TD','any_td',0]],
  RB: [['Rush Yards','rush_yd',1],['Rush Attempts','rush_att',1],['Receptions','rec',1],
       ['Receiving Yards','rec_yd',1],['Rush + Rec Yards','rush_rec_yd',1],
       ['Anytime TD','any_td',0],['First TD','first_td',0]],
  WR: [['Receptions','rec',1],['Receiving Yards','rec_yd',1],['Longest Reception','rec_long',1],
       ['Rush + Rec Yards','rush_rec_yd',1],['Anytime TD','any_td',0],['First TD','first_td',0]],
  TE: [['Receptions','rec',1],['Receiving Yards','rec_yd',1],['Longest Reception','rec_long',1],
       ['Anytime TD','any_td',0],['First TD','first_td',0]],
  K:  [['Kicking Points','kick_pts',1],['Field Goals Made','fgm',1]]
};
function btStatsFor(pos){ return BT_STATS[pos] || BT_STATS.WR; }
function btStatLabel(key){
  var all = [].concat(BT_STATS.QB, BT_STATS.RB, BT_STATS.WR, BT_STATS.TE, BT_STATS.K);
  var hit = all.filter(function(s){ return s[1] === key; })[0];
  return hit ? hit[0] : (key || '');
}

var BT_RESULTS = ['pending','win','loss','push','void'];
var BT_KINDS = [['prop','Player prop'],['spread','Spread'],['total','Total'],
                ['moneyline','Moneyline'],['other','Other']];

/* ---------- formatting ---------- */

function btOdds(v){
  var n = parseInt(String(v).replace(/[^0-9\-+]/g,''), 10);
  return isNaN(n) ? null : n;
}
function btOddsTxt(n){ return n > 0 ? '+' + n : String(n); }
function btUnits(n){ return (Number(n)||0).toFixed(2).replace(/\.00$/,''); }
function btNetTxt(n){
  if(n === null || n === undefined) return '<span class="muted">—</span>';
  var v = Number(n), s = (v>0?'+':'') + v.toFixed(2);
  return '<span class="bt-net '+(v>0?'up':v<0?'down':'')+'">'+s+'</span>';
}
function btRoiTxt(n){
  if(n === null || n === undefined) return '<span class="muted">—</span>';
  var v = Number(n);
  return '<span class="bt-net '+(v>0?'up':v<0?'down':'')+'">'+(v>0?'+':'')+v.toFixed(1)+'%</span>';
}
function btResultPill(r){
  return '<span class="bt-pill bt-'+r+'">'+r.charAt(0).toUpperCase()+r.slice(1)+'</span>';
}
function btWeekLabel(w){
  var pl = {19:'Wild Card',20:'Divisional',21:'Conference',22:'Super Bowl'};
  return pl[w] || ('Week '+w);
}
function btWeekOpts(sel, withAll){
  var h = withAll ? '<option value="">All weeks</option>' : '';
  for(var w=1; w<=22; w++){
    h += '<option value="'+w+'"'+(String(sel)===String(w)?' selected':'')+'>'+btWeekLabel(w)+'</option>';
  }
  return h;
}

function btDescribe(f){
  if(f.bet_type === 'prop'){
    if(!f.player_name || !f.stat_key) return '';
    if(f.side === 'yes' || f.side === 'no'){
      return f.player_name+' '+(f.side==='no'?'No ':'')+btStatLabel(f.stat_key);
    }
    if(f.line === null || f.line === undefined || f.line === '') return '';
    return f.player_name+' '+(f.side==='under'?'u':'o')+f.line+' '+btStatLabel(f.stat_key);
  }
  if(f.bet_type === 'spread'){
    if(!f.team || f.line == null) return '';
    return f.team+' '+(Number(f.line)>0?'+':'')+f.line;
  }
  if(f.bet_type === 'total'){
    if(f.line == null) return '';
    return (f.matchup ? f.matchup+' ' : '')+(f.side==='under'?'u':'o')+f.line;
  }
  if(f.bet_type === 'moneyline') return f.team ? f.team+' ML' : '';
  return f.description || '';
}

/* ---------- player index (shares Start/Sit's cached Sleeper file) ---------- */

async function btPlayers(){
  if(BT.players) return BT.players;
  try{
    var cached = sessionStorage.getItem('ss_players');
    if(cached){ BT.players = JSON.parse(cached); return BT.players; }
  }catch(e){}

  var res = await fetch('https://api.sleeper.app/v1/players/nfl');
  var all = await res.json();
  var keep = {QB:1,RB:1,WR:1,TE:1,K:1};
  var list = [];
  Object.keys(all).forEach(function(id){
    var p = all[id];
    if(!p || !p.team || !keep[p.position]) return;
    list.push({ id:id, n: p.full_name || ((p.first_name||'')+' '+(p.last_name||'')).trim(),
                t: p.team, p: p.position, e: p.espn_id || null });
  });
  list.sort(function(a,b){ return a.n.localeCompare(b.n); });
  BT.players = list;
  try{ sessionStorage.setItem('ss_players', JSON.stringify(list)); }catch(e){}
  return list;
}

/* ---------- load ---------- */

async function loadBets(){
  document.getElementById('content').innerHTML = '<div class="loading">Loading bets…</div>';

  try{
    BT.books = await dbGet('bt_sportsbooks?select=id,name,short_name,sort_order,is_active&order=sort_order');
  }catch(e){ BT.books = []; }
  try{
    BT.staff = await dbGet('staff?select=id,name&order=name');
  }catch(e){ BT.staff = []; }

  if(!can('bets','r') && (BT.tab === 'all' || BT.tab === 'board')) BT.tab = 'mine';
  if(!can('bets','u') && BT.tab === 'books') BT.tab = 'mine';

  btPlayers().catch(function(){});
  await btLoadTab();
}

async function btLoadTab(){
  var args = { p_season: Number(BT.season), p_week: BT.week || null };
  try{
    if(BT.tab === 'grade'){
      BT.bets = (can('bets','u') ? await rpc('bt_board', args) : await rpc('bt_my_bets', args)) || [];
    }else if(BT.tab === 'mine'){
      BT.bets = (await rpc('bt_my_bets', args)) || [];
    }else if(BT.tab === 'all'){
      BT.bets = (await rpc('bt_board', args)) || [];
    }else if(BT.tab === 'board'){
      BT.board = (await rpc('bt_leaderboard', args)) || [];
      BT.house = ((await rpc('bt_house', args)) || [])[0] || {};
    }
  }catch(e){
    toast('Could not load bets: '+(e.message||e), true);
  }
  btRender();
}

/* ---------- render ---------- */

function btRender(){
  topAction(ifCan('bets','c','<button class="btn btn-primary" onclick="btForm()">+ Add bet</button>') ||
            ifCan('bets','u','<button class="btn btn-primary" onclick="btForm()">+ Add bet</button>'));

  var tabs = [['mine','My bets'],['grade','Grade']];
  if(can('bets','r')) tabs.push(['all','All bets'],['board','Leaderboard']);
  if(can('bets','u')) tabs.push(['books','Sportsbooks']);

  var head =
    '<div class="bt-bar">'+
      '<div class="bt-tabs">'+
        tabs.map(function(t){
          var n = (t[0]==='grade' && BT.tab!=='board' && BT.tab!=='books') ? btPendingCount() : 0;
          return '<button class="bt-tab'+(BT.tab===t[0]?' on':'')+'" onclick="btGo(\''+t[0]+'\')">'+
                 t[1]+(n?' <span class="bt-badge">'+n+'</span>':'')+'</button>';
        }).join('')+
      '</div>'+
      '<div class="bt-filters">'+
        '<label>Season <input id="btSeason" class="bt-season" value="'+esc(String(BT.season))+'"></label>'+
        '<label>Week <select id="btWeek">'+btWeekOpts(BT.week, true)+'</select></label>'+
      '</div>'+
    '</div>';

  var body = BT.tab==='books' ? btBooksHtml()
           : BT.tab==='board' ? btLeaderHtml()
           : BT.tab==='grade' ? btGradeHtml()
           : btBetsHtml();

  document.getElementById('content').innerHTML =
    '<div class="panel">'+head+'<div class="bt-body">'+body+'</div></div>';

  var s = document.getElementById('btSeason');
  if(s) s.onchange = function(){ BT.season = this.value.trim(); btLoadTab(); };
  var w = document.getElementById('btWeek');
  if(w) w.onchange = function(){ BT.week = this.value ? Number(this.value) : null; btLoadTab(); };
}

function btGo(tab){ BT.tab = tab; btLoadTab(); }
function btPendingCount(){
  return (BT.bets||[]).filter(function(b){ return b.result === 'pending'; }).length;
}

function btBetsHtml(){
  if(!BT.bets.length){
    return '<div class="empty"><h4>No bets yet</h4><p>Nothing logged for this '+
           (BT.week ? btWeekLabel(BT.week).toLowerCase() : 'season')+'. Use <b>+ Add bet</b> to log one.</p></div>';
  }
  var mine = BT.tab === 'mine';
  var tot = BT.bets.reduce(function(a,b){
    if(b.result !== 'pending' && b.result !== 'void'){
      a.net += Number(b.net||0); a.risk += Number(b.units||0);
    }
    return a;
  }, {net:0, risk:0});

  var h = '<div class="table-wrap"><table class="bt-table"><thead><tr>'+
    '<th>Date</th><th>Wk</th><th>Bet</th><th>Odds</th><th>Book</th>'+
    (mine?'':'<th>Bettor</th>')+
    '<th class="num">Units</th><th>Result</th><th class="num">Net</th><th class="num">ROI</th><th></th>'+
    '</tr></thead><tbody>';

  BT.bets.forEach(function(b){
    var canEdit = can('bets','u') || b.result === 'pending';
    h += '<tr class="bt-row bt-r-'+b.result+'">'+
      '<td class="nowrap">'+esc(fmtDate(b.placed_on))+'</td>'+
      '<td>'+(b.week||'')+'</td>'+
      '<td class="bt-desc"><div class="bt-d">'+esc(b.description)+'</div>'+
        (b.player_team || b.matchup
          ? '<div class="bt-sub">'+esc(b.player_team||'')+
            (b.player_team && b.matchup ? ' · ' : '')+esc(b.matchup||'')+'</div>' : '')+
      '</td>'+
      '<td class="mono">'+btOddsTxt(b.odds)+'</td>'+
      '<td>'+esc(b.sportsbook||'—')+'</td>'+
      (mine?'':'<td>'+esc(b.bettor_name||'—')+'</td>')+
      '<td class="num">'+btUnits(b.units)+'</td>'+
      '<td>'+(b.result==='pending' && canEdit ? btGradeBtns(b.id) : btResultPill(b.result))+'</td>'+
      '<td class="num">'+btNetTxt(b.net)+'</td>'+
      '<td class="num">'+btRoiTxt(b.roi)+'</td>'+
      '<td class="row-actions">'+
        (canEdit?'<button class="btn btn-ghost btn-sm" onclick="btForm(\''+b.id+'\')">Edit</button>':'')+
        ((can('bets','d')||b.result==='pending')
          ?'<button class="btn btn-danger btn-sm" onclick="btDelete(\''+b.id+'\')">Delete</button>':'')+
      '</td></tr>';
  });

  return h+'</tbody><tfoot><tr>'+
    '<td colspan="'+(mine?6:7)+'" class="bt-tot">Graded total</td>'+
    '<td>'+btPendingCount()+' open</td>'+
    '<td class="num">'+btNetTxt(tot.net)+'</td>'+
    '<td class="num">'+btRoiTxt(tot.risk ? tot.net/tot.risk*100 : null)+'</td>'+
    '<td></td></tr></tfoot></table></div>';
}

function btGradeBtns(id){
  return '<span class="bt-grade">'+
    [['win','W'],['loss','L'],['push','P']].map(function(r){
      return '<button class="bt-g bt-g-'+r[0]+'" title="Mark '+r[0]+
             '" onclick="btGrade(\''+id+'\',\''+r[0]+'\')">'+r[1]+'</button>';
    }).join('')+'</span>';
}

function btGradeHtml(){
  var open = (BT.bets||[]).filter(function(b){ return b.result === 'pending'; });
  if(!open.length){
    return '<div class="empty"><h4>Nothing open</h4><p>Every bet for this '+
           (BT.week ? btWeekLabel(BT.week).toLowerCase() : 'season')+' is graded.</p></div>';
  }
  return '<div class="bt-gr">'+open.map(function(b){
    return '<div class="bt-gcard" id="gc-'+b.id+'">'+
      '<div class="bt-gtop">'+
        '<div class="bt-gwho">'+esc(b.bettor_name||'You')+
          ' <span class="bt-gwk">'+btWeekLabel(b.week)+'</span></div>'+
        '<div class="bt-godds">'+btOddsTxt(b.odds)+'</div>'+
      '</div>'+
      '<div class="bt-gdesc">'+esc(b.description)+'</div>'+
      '<div class="bt-gmeta">'+btUnits(b.units)+'u'+
        (b.sportsbook?' · '+esc(b.sportsbook):'')+
        (b.matchup?' · '+esc(b.matchup):'')+'</div>'+
      '<div class="bt-gbtns">'+
        '<button class="bt-gb win" onclick="btGrade(\''+b.id+'\',\'win\')">Win</button>'+
        '<button class="bt-gb loss" onclick="btGrade(\''+b.id+'\',\'loss\')">Loss</button>'+
        '<button class="bt-gb push" onclick="btGrade(\''+b.id+'\',\'push\')">Push</button>'+
        '<button class="bt-gb void" onclick="btGrade(\''+b.id+'\',\'void\')">Void</button>'+
      '</div></div>';
  }).join('')+'</div>';
}

function btLeaderHtml(){
  var hs = BT.house || {};
  var cards = '<div class="cards bt-house">'+
    btStat('Units', btNetTxt(hs.units_net), btUnits(hs.units_risked||0)+'u risked')+
    btStat('ROI', btRoiTxt(hs.roi), 'return on risk')+
    btStat('Record', (hs.wins||0)+'-'+(hs.losses||0)+(hs.pushes?'-'+hs.pushes:''),
           (hs.win_pct!=null?hs.win_pct+'%':'—')+' win rate')+
    btStat('Open', String(hs.pending||0), (hs.bettors||0)+' bettors')+'</div>';

  if(!BT.board || !BT.board.length) return cards+'<div class="empty"><h4>No graded bets yet</h4></div>';

  var h = cards+'<div class="table-wrap"><table class="bt-table"><thead><tr>'+
    '<th>#</th><th>Bettor</th><th class="num">Bets</th><th class="num">W-L-P</th>'+
    '<th class="num">Win %</th><th class="num">Risked</th><th class="num">Units</th><th class="num">ROI</th>'+
    '</tr></thead><tbody>';
  BT.board.forEach(function(r,i){
    h += '<tr><td class="bt-rank">'+(i+1)+'</td>'+
      '<td>'+esc(r.name)+(r.pending?' <span class="muted">('+r.pending+' open)</span>':'')+'</td>'+
      '<td class="num">'+r.bets+'</td>'+
      '<td class="num mono">'+r.wins+'-'+r.losses+(r.pushes?'-'+r.pushes:'')+'</td>'+
      '<td class="num">'+(r.win_pct!=null?r.win_pct+'%':'—')+'</td>'+
      '<td class="num">'+btUnits(r.units_risked)+'u</td>'+
      '<td class="num">'+btNetTxt(r.units_net)+'</td>'+
      '<td class="num">'+btRoiTxt(r.roi)+'</td></tr>';
  });
  return h+'</tbody></table></div>';
}

function btStat(label, value, sub){
  return '<div class="stat bt-stat"><div class="bt-stat-l">'+label+'</div>'+
         '<div class="bt-stat-v">'+value+'</div>'+
         '<div class="bt-stat-s">'+esc(sub||'')+'</div></div>';
}

/* ---------------- add / edit overlay ---------------- */

var BTF = null;

function btq(sel){ return BTF && BTF.bg ? BTF.bg.querySelector(sel) : null; }
function btv(sel){ var e = btq(sel); return e ? String(e.value).trim() : ''; }

async function btForm(id){
  var bet = id ? BT.bets.filter(function(b){ return b.id === id; })[0] : null;
  var canAny = can('bets','u');
  var kind = (bet && bet.bet_type) || 'prop';
  var week = (bet && bet.week) || BT_LAST.week || BT.week || 1;

  await btPlayers().catch(function(){});

  var games = [];
  try{
    games = await dbGet('gp_games?select=*&season=eq.'+Number(BT.season)+'&week=eq.'+week+'&limit=40');
  }catch(e){ games = []; }

  var bettorField = canAny
    ? '<div class="field"><label>Bettor</label><select id="btf-bettor">'+
        BT.staff.map(function(s){
          var sel = bet ? bet.bettor_id===s.id : (BT_LAST.bettor||MY_STAFF_ID)===s.id;
          return '<option value="'+s.id+'"'+(sel?' selected':'')+'>'+esc(s.name)+'</option>';
        }).join('')+'</select></div>'
    : '<input type="hidden" id="btf-bettor" value="'+(MY_STAFF_ID||'')+'">';

  var body =
    '<div class="form-grid">'+
      bettorField+
      '<div class="field"><label>Date</label><input type="date" id="btf-date" value="'+
        esc((bet&&bet.placed_on)||BT_LAST.date||new Date().toISOString().slice(0,10))+'"></div>'+
      '<div class="field"><label>Week</label><select id="btf-week">'+btWeekOpts(week,false)+'</select></div>'+
    '</div>'+
    '<div class="btf-kinds" id="btf-kinds">'+
      BT_KINDS.map(function(k){
        return '<button type="button" class="btf-kind'+(kind===k[0]?' on':'')+
               '" data-kind="'+k[0]+'">'+k[1]+'</button>';
      }).join('')+
    '</div>'+
    '<div id="btf-fields"></div>'+
    '<div class="form-grid btf-price">'+
      '<div class="field"><label>Odds</label><input id="btf-odds" placeholder="-110" value="'+
        (bet?btOddsTxt(bet.odds):'')+'"></div>'+
      '<div class="field"><label>Sportsbook</label><select id="btf-book"><option value="">—</option>'+
        BT.books.filter(function(b){ return b.is_active || (bet && bet.sportsbook_id===b.id); })
        .map(function(b){
          var sel = bet ? bet.sportsbook_id===b.id : BT_LAST.book===b.id;
          return '<option value="'+b.id+'"'+(sel?' selected':'')+'>'+esc(b.name)+'</option>';
        }).join('')+'</select></div>'+
      '<div class="field"><label>Units</label><input type="number" step="0.25" min="0.25" id="btf-units" value="'+
        (bet?btUnits(bet.units):btUnits(BT_LAST.units))+'"></div>'+
      (canAny
        ? '<div class="field"><label>Result</label><select id="btf-result">'+
            BT_RESULTS.map(function(r){
              return '<option value="'+r+'"'+(bet&&bet.result===r?' selected':'')+'>'+
                     r.charAt(0).toUpperCase()+r.slice(1)+'</option>';
            }).join('')+'</select></div>'
        : '<input type="hidden" id="btf-result" value="'+((bet&&bet.result)||'pending')+'">')+
    '</div>'+
    '<div class="btf-prev" id="btf-prev"></div>';

  modal({
    title: bet ? 'Edit bet' : 'Add bet',
    body: body,
    wide: true,
    saveLabel: bet ? 'Save bet' : 'Add bet',
    onReady: function(bg){
      BTF = {
        bg: bg, kind: kind, bet: bet, games: games, keys: null,
        player: (bet && bet.player_id)
          ? { id: bet.player_id, n: bet.player_name, t: bet.player_team, p: bet.player_pos } : null
      };
      btfFields();
      bg.querySelector('#btf-kinds').addEventListener('click', function(e){
        var b = e.target.closest('[data-kind]');
        if(!b) return;
        BTF.kind = b.dataset.kind;
        Array.prototype.forEach.call(this.querySelectorAll('.btf-kind'), function(x){
          x.classList.toggle('on', x === b);
        });
        btfFields();
      });
      ['#btf-odds','#btf-units','#btf-book'].forEach(function(sel){
        var el = bg.querySelector(sel);
        if(el){ el.oninput = btfPreview; el.onchange = btfPreview; }
      });
    },
    onSave: async function(bg){
      BTF.bg = bg;
      var f = btfCollect();
      if(!f.description) throw new Error('Finish the bet — pick a player and a line, a team, or use Other for free text.');
      if(f.odds === null || (f.odds > -100 && f.odds < 100)) throw new Error('Odds must be American, e.g. -110 or +175.');
      if(!(f.units > 0)) throw new Error('Units must be greater than zero.');
      if(!f.bettor_id) throw new Error('No staff record is linked to your login — ask an admin to link it.');
      if(!f.season || !f.week) throw new Error('Pick a season and week.');

      if(bet) await dbPatch('bt_bets?id=eq.'+bet.id, f);
      else await dbPost('bt_bets', f);

      BT_LAST = { week: f.week, book: f.sportsbook_id, units: f.units,
                  bettor: f.bettor_id, date: f.placed_on };
      toast(bet ? 'Bet updated' : 'Bet added');
      btLoadTab();
    }
  });
}

function btfGameKeys(g){
  if(BTF.keys) return BTF.keys;
  var keys = Object.keys(g||{});
  var find = function(re){ return keys.filter(function(k){ return re.test(k); })[0]; };
  BTF.keys = { home: find(/^home(_team|_abbr)?$/i) || find(/home/i),
               away: find(/^away(_team|_abbr)?$/i) || find(/away/i) };
  return BTF.keys;
}

function btfGameOpts(sel){
  return '<option value="">— pick a game —</option>'+(BTF.games||[]).map(function(g){
    var k = btfGameKeys(g);
    if(!k.away || !k.home) return '';
    var lab = g[k.away]+'@'+g[k.home];
    return '<option value="'+g.id+'" data-lab="'+esc(lab)+'" data-a="'+esc(g[k.away])+
           '" data-h="'+esc(g[k.home])+'"'+(sel===g.id?' selected':'')+'>'+esc(lab)+'</option>';
  }).join('');
}

function btfFields(){
  var k = BTF.kind, bet = BTF.bet, el = btq('#btf-fields');
  var side = (bet && bet.side) || 'over';
  var segHtml =
    '<div class="btf-seg" id="btf-sideseg">'+
      '<button type="button" data-side="over"'+(side!=='under'?' class="on"':'')+'>Over</button>'+
      '<button type="button" data-side="under"'+(side==='under'?' class="on"':'')+'>Under</button>'+
    '</div>';

  if(k === 'prop'){
    var p = BTF.player;
    var stats = btStatsFor(p && p.p);
    el.innerHTML =
      '<div class="form-grid">'+
        '<div class="field full btf-psearch">'+
          '<label>Player</label>'+
          '<input id="btf-pq" autocomplete="off" placeholder="Start typing a name…" value="'+
            esc(p && p.n ? p.n+'  ('+p.p+' · '+p.t+')' : '')+'">'+
          '<div class="btf-plist" id="btf-plist"></div>'+
        '</div>'+
        '<div class="field"><label>Prop</label><select id="btf-stat">'+
          stats.map(function(s){
            return '<option value="'+s[1]+'" data-line="'+s[2]+'"'+
                   (bet && bet.stat_key===s[1]?' selected':'')+'>'+s[0]+'</option>';
          }).join('')+'</select></div>'+
        '<div class="field btf-side"><label>Side</label>'+segHtml+'</div>'+
        '<div class="field btf-lf"><label>Line</label>'+
          '<input type="number" step="0.5" id="btf-line" placeholder="18.5" value="'+
          (bet && bet.line!=null ? bet.line : '')+'"></div>'+
      '</div>';

    btfWirePlayer();
    btfWireSide();
    var st = btq('#btf-stat');
    st.onchange = function(){
      var needsLine = this.options[this.selectedIndex].dataset.line === '1';
      btq('.btf-lf').style.display = needsLine ? '' : 'none';
      btq('.btf-side').style.display = needsLine ? '' : 'none';
      btfPreview();
    };
    st.onchange();
    btq('#btf-line').oninput = btfPreview;

  }else if(k === 'other'){
    el.innerHTML = '<div class="form-grid">'+
      '<div class="field full"><label>Bet</label><input id="btf-desc" placeholder="Describe the bet" value="'+
        esc((bet&&bet.description)||'')+'"></div>'+
      '<div class="field"><label>Matchup (optional)</label>'+
        '<input id="btf-matchup" placeholder="NYG@CAR" value="'+esc((bet&&bet.matchup)||'')+'"></div>'+
      '</div>';
    btq('#btf-desc').oninput = btfPreview;

  }else{
    var needsTeam = (k === 'spread' || k === 'moneyline');
    var haveSlate = BTF.games && BTF.games.length;
    el.innerHTML =
      '<div class="form-grid">'+
        '<div class="field full"><label>Game</label>'+
          (haveSlate
            ? '<select id="btf-game">'+btfGameOpts(bet && bet.game_id)+'</select>'
            : '<input id="btf-matchup" placeholder="NYG@CAR" value="'+esc((bet&&bet.matchup)||'')+'">'+
              '<div class="btf-hint">No slate synced for this week yet — type the matchup.</div>')+
        '</div>'+
        (needsTeam
          ? '<div class="field"><label>Team</label>'+
              (haveSlate
                ? '<select id="btf-team"><option value="">— pick —</option></select>'
                : '<input id="btf-team" placeholder="NYG" value="'+esc((bet&&bet.team)||'')+'">')+
            '</div>'
          : '<div class="field btf-side"><label>Side</label>'+segHtml+'</div>')+
        (k === 'moneyline' ? '' :
          '<div class="field"><label>Line</label><input type="number" step="0.5" id="btf-line" placeholder="'+
          (k==='spread'?'-3.5':'44.5')+'" value="'+(bet && bet.line!=null ? bet.line : '')+'"></div>')+
      '</div>';

    var g = btq('#btf-game');
    if(g){ g.onchange = function(){ btfTeams(); btfPreview(); }; btfTeams(); }
    btfWireSide();
    ['#btf-line','#btf-team','#btf-matchup'].forEach(function(sel){
      var x = btq(sel);
      if(x){ x.oninput = btfPreview; x.onchange = btfPreview; }
    });
  }
  btfPreview();
}

function btfTeams(){
  var sel = btq('#btf-team'), g = btq('#btf-game');
  if(!sel || !g || sel.tagName !== 'SELECT') return;
  var o = g.options[g.selectedIndex];
  var cur = (BTF.bet && BTF.bet.team) || '';
  sel.innerHTML = '<option value="">— pick —</option>'+
    (o && o.dataset.a
      ? '<option value="'+o.dataset.a+'"'+(cur===o.dataset.a?' selected':'')+'>'+o.dataset.a+'</option>'+
        '<option value="'+o.dataset.h+'"'+(cur===o.dataset.h?' selected':'')+'>'+o.dataset.h+'</option>'
      : '');
}

function btfWireSide(){
  var seg = btq('#btf-sideseg');
  if(!seg) return;
  seg.addEventListener('click', function(e){
    var b = e.target.closest('[data-side]');
    if(!b) return;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function(x){
      x.classList.toggle('on', x === b);
    });
    btfPreview();
  });
}

function btfWirePlayer(){
  var q = btq('#btf-pq'), list = btq('#btf-plist');

  q.oninput = function(){
    var term = this.value.trim().toLowerCase();
    BTF.player = null;
    if(term.length < 2){ list.innerHTML=''; list.classList.remove('on'); return btfPreview(); }
    var hits = (BT.players||[]).filter(function(p){
      var n = p.n.toLowerCase();
      return n.indexOf(term) === 0 || n.indexOf(' '+term) > -1;
    }).slice(0,8);
    list.innerHTML = hits.map(function(p){
      return '<button type="button" class="btf-pi" data-id="'+p.id+'" data-n="'+esc(p.n)+
             '" data-t="'+p.t+'" data-p="'+p.p+'">'+
             '<span class="btf-pn">'+esc(p.n)+'</span>'+
             '<span class="btf-pm">'+p.p+' · '+p.t+'</span></button>';
    }).join('');
    list.classList.toggle('on', hits.length > 0);
    btfPreview();
  };

  list.onclick = function(e){
    var b = e.target.closest('.btf-pi');
    if(!b) return;
    BTF.player = { id: b.dataset.id, n: b.dataset.n, t: b.dataset.t, p: b.dataset.p };
    q.value = b.dataset.n+'  ('+b.dataset.p+' · '+b.dataset.t+')';
    list.innerHTML=''; list.classList.remove('on');

    var stat = btq('#btf-stat');
    var keep = stat.value;
    stat.innerHTML = btStatsFor(b.dataset.p).map(function(s){
      return '<option value="'+s[1]+'" data-line="'+s[2]+'"'+
             (keep===s[1]?' selected':'')+'>'+s[0]+'</option>';
    }).join('');
    stat.onchange();
  };
}

function btfSide(){
  var on = btq('#btf-sideseg .on');
  return on ? on.dataset.side : null;
}

function btfCollect(){
  var k = BTF.kind;
  var f = {
    season: Number(BT.season),
    week: Number(btv('#btf-week')),
    placed_on: btv('#btf-date'),
    bet_type: k,
    odds: btOdds(btv('#btf-odds')),
    units: Number(btv('#btf-units')),
    sportsbook_id: btv('#btf-book') || null,
    result: btv('#btf-result') || 'pending',
    bettor_id: btv('#btf-bettor') || null,
    game_id: null, matchup: null, team: null,
    player_id: null, player_name: null, player_team: null, player_pos: null,
    stat_key: null, side: null, line: null, description: ''
  };

  var lineEl = btq('#btf-line');
  var line = (lineEl && lineEl.value !== '') ? Number(lineEl.value) : null;

  if(k === 'prop'){
    var p = BTF.player;
    if(p){ f.player_id=p.id; f.player_name=p.n; f.player_team=p.t; f.player_pos=p.p; }
    var st = btq('#btf-stat');
    f.stat_key = st ? st.value : null;
    var needsLine = st && st.options[st.selectedIndex].dataset.line === '1';
    f.side = needsLine ? btfSide() : 'yes';
    f.line = needsLine ? line : null;

  }else if(k === 'other'){
    f.description = btv('#btf-desc');
    f.matchup = btv('#btf-matchup') || null;

  }else{
    var g = btq('#btf-game');
    if(g){
      var o = g.options[g.selectedIndex];
      if(o && o.value){ f.game_id = o.value; f.matchup = o.dataset.lab; }
    }
    if(!f.matchup) f.matchup = btv('#btf-matchup') || null;
    f.team = btv('#btf-team') || null;
    f.side = (k === 'total') ? btfSide() : null;
    f.line = (k === 'moneyline') ? null : line;
  }

  if(k !== 'other') f.description = btDescribe(f);
  return f;
}

function btfPreview(){
  var el = btq('#btf-prev');
  if(!el) return;
  var f = btfCollect();
  if(!f.description){
    el.innerHTML = '<span class="btf-wait">The bet will read out here as you fill it in.</span>';
    return;
  }
  var bk = BT.books.filter(function(b){ return b.id === f.sportsbook_id; })[0];
  el.innerHTML = '<span class="btf-pl">'+esc(f.description)+'</span>'+
    (f.odds!=null?'<span class="btf-po">'+btOddsTxt(f.odds)+'</span>':'')+
    '<span class="btf-pu">'+btUnits(f.units)+'u</span>'+
    (bk?'<span class="btf-pb">'+esc(bk.short_name||bk.name)+'</span>':'');
}

/* ---------------- grade + delete ---------------- */

async function btGrade(id, result){
  if(BT.busy[id]) return;
  BT.busy[id] = true;
  var card = document.getElementById('gc-'+id);
  if(card) card.classList.add('going');
  try{
    await dbPatch('bt_bets?id=eq.'+id, { result: result });
    toast('Marked '+result);
    await btLoadTab();
  }catch(e){
    if(card) card.classList.remove('going');
    toast('Could not grade that bet: '+(e.message||e), true);
  }
  BT.busy[id] = false;
}

function btDelete(id){
  var b = BT.bets.filter(function(x){ return x.id === id; })[0];
  confirmDelete(b ? esc(b.description) : 'this bet', async function(){
    await dbDel('bt_bets?id=eq.'+id);
    toast('Bet deleted');
    btLoadTab();
  });
}

/* ---------------- sportsbooks ---------------- */

function btBooksHtml(){
  var h = '<div class="bt-pad">'+
    ifCan('bets','u','<button class="btn btn-primary btn-sm" onclick="btBookForm()">Add sportsbook</button>')+
    '</div><div class="table-wrap"><table class="bt-table"><thead><tr>'+
    '<th>Name</th><th>Short</th><th class="num">Order</th><th>Active</th><th></th></tr></thead><tbody>';
  BT.books.forEach(function(b){
    h += '<tr><td>'+esc(b.name)+'</td><td class="mono">'+esc(b.short_name||'')+'</td>'+
      '<td class="num">'+b.sort_order+'</td>'+
      '<td>'+(b.is_active?'<span class="bt-pill bt-win">Active</span>':'<span class="bt-pill">Off</span>')+'</td>'+
      '<td class="row-actions">'+
        ifCan('bets','u','<button class="btn btn-ghost btn-sm" onclick="btBookForm(\''+b.id+'\')">Edit</button>')+
      '</td></tr>';
  });
  return h+'</tbody></table></div>';
}

function btBookForm(id){
  var b = id ? BT.books.filter(function(x){ return x.id === id; })[0] : null;
  modal({
    title: b ? 'Edit sportsbook' : 'Add sportsbook',
    body: '<div class="form-grid">'+
      '<div class="field"><label>Name</label><input id="bkf-name" value="'+esc((b&&b.name)||'')+'"></div>'+
      '<div class="field"><label>Short name</label><input id="bkf-short" value="'+esc((b&&b.short_name)||'')+'"></div>'+
      '<div class="field"><label>Sort order</label><input type="number" id="bkf-order" value="'+((b&&b.sort_order)||100)+'"></div>'+
      '<div class="field"><label>Active</label><select id="bkf-active">'+
        '<option value="true"'+(!b||b.is_active?' selected':'')+'>Yes</option>'+
        '<option value="false"'+(b&&!b.is_active?' selected':'')+'>No</option></select></div></div>',
    onSave: async function(bg){
      var name = bg.querySelector('#bkf-name').value.trim();
      if(!name) throw new Error('Name is required.');
      var payload = {
        name: name,
        short_name: bg.querySelector('#bkf-short').value.trim() || null,
        sort_order: Number(bg.querySelector('#bkf-order').value) || 100,
        is_active: bg.querySelector('#bkf-active').value === 'true'
      };
      if(b) await dbPatch('bt_sportsbooks?id=eq.'+b.id, payload);
      else await dbPost('bt_sportsbooks', payload);
      toast('Saved');
      loadBets();
    }
  });
}