const GATE_LEVEL = 7;

const NAV_TITLES = {
  dashboard:'Dashboard', staff:'Staff', subscribers:'Subscribers', recruitment:'Recruitment',
  onboarding:'Onboarding', my_onboarding:'My Onboarding', org:'Org chart', logins:'Last login',
  shows:'Shows', tools:'Tools & links', channels:'Channels', youtube:'YouTube Stats', board:'Project Board', roles:'Roles & permissions', startsit: 'Start/Sit Showdown', gamepicks: 'Game Picks', calendar: 'Content calendar', rankings: 'Rankings display', markers: 'Calendar key dates', bets: 'Bets'
};
const STATUS = {
  todo:{label:'To Do',color:'var(--muted)'},
  in_progress:{label:'In Progress',color:'var(--orange)'},
  review:{label:'Review',color:'var(--violet)'},
  done:{label:'Done',color:'var(--green)'},
  blocked:{label:'Blocked',color:'var(--red)'}
};
const PRIORITY = {
  low:{label:'Low',color:'var(--sky)'}, medium:{label:'Medium',color:'var(--muted)'},
  high:{label:'High',color:'var(--orange)'}, urgent:{label:'Urgent',color:'var(--red)'}
};
const ACCENTS = ['var(--violet)','var(--pink)','var(--sky)','var(--green)','var(--yellow)','var(--red)','var(--aqua)','var(--orange)'];

let ME = null;
let ADMINS = [];
let CHANNELS_CACHE = [];
let MY_STAFF_ID = null;

let PERMS = {};
let ROLES = [];
const RESOURCE_GROUPS = [
  {label:'People', keys:['staff','org','recruitment','onboarding','onboarding_template','subscribers','logins']},
  {label:'Content', keys:['shows','calendar','markers','rankings','tools','channels','youtube', 'startsit', 'gamepicks', 'bets']},
  {label:'Work', keys:['board']},
  {label:'Access', keys:['roles']}
];
function resourceGroups(){
  const seen={};
  const groups=RESOURCE_GROUPS.map(g=>{
    const keys=g.keys.filter(k=>{ if(RESOURCES[k]){ seen[k]=1; return true; } return false; });
    return {label:g.label, keys};
  }).filter(g=>g.keys.length);
  const rest=Object.keys(RESOURCES).filter(k=>!seen[k]);
  if(rest.length) groups.push({label:'Other', keys:rest});
  return groups;
}
const RESOURCES = {
  staff:'Staff', subscribers:'Subscribers', shows:'Shows', tools:'Tools & links', recruitment:'Recruitment', 
  onboarding:'Onboarding', onboarding_template:'Onboarding template', org:'Org chart', logins:'Last login',
  channels:'Channels', youtube:'YouTube Stats', board:'Project Board', roles:'Roles & permissions', startsit: 'Start/Sit Showdown', gamepicks: 'Game Picks', calendar: 'Content calendar', rankings: 'Rankings display', bets:'Bets'
};
function can(resource, action){
  if(ME && ME.admin_level >= 9) return true;
  const p = PERMS[resource];
  return !!(p && p[action]);
}
function ifCan(resource, action, html){ return can(resource, action) ? html : ''; }

function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function initials(name){if(!name)return '?';return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();}
const HEADSHOT_DIR = 'assets/staff/';
function headshotSrc(v){
  if(!v) return '';
  if(/^https?:\/\//i.test(v)) return v;
  return v.indexOf('/')>=0 ? v.replace(/^\/+/,'') : HEADSHOT_DIR + v;
}
function headshotAbs(v){ const s=headshotSrc(v); return s ? new URL(s, location.href).href : ''; }

function avatarHtml(p, cls, accent){
  const nm = (p && p.name) || '';
  const src = headshotSrc(p && p.headshot);
  const ini = esc(initials(nm));
  if(src) return '<img class="'+cls+'" src="'+esc(src)+'" alt="" data-ini="'+ini+'">';
  return '<span class="'+cls+'" style="background:'+(accent||accentFor(nm))+'">'+ini+'</span>';
}
document.addEventListener('error', function(e){
  const img = e.target;
  if(!img || img.tagName !== 'IMG' || !img.dataset.ini) return;
  const sp = document.createElement('span');
  sp.className = img.className;
  sp.textContent = img.dataset.ini;
  img.replaceWith(sp);
}, true);
function accentFor(str){let h=0;for(const c of (str||'x'))h=(h*31+c.charCodeAt(0))>>>0;return ACCENTS[h%ACCENTS.length];}
function fmtDate(d){
  if(!d)return '—';
  let dt;
  if(typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d)){
    const p=d.split('-');
    dt=new Date(+p[0], +p[1]-1, +p[2]);
  } else {
    dt=new Date(d);
  }
  if(isNaN(dt))return '—';
  return dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function fmtNum(n){return n==null?'—':Number(n).toLocaleString();}
function timeAgo(d){if(!d)return '';const s=(Date.now()-new Date(d))/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}

function toast(msg,bad){const t=document.getElementById('toast');t.textContent=msg;t.className='show'+(bad?' bad':'');setTimeout(()=>t.className='',2600);}

function sbCfg(){
  return {
    url: (typeof SUPABASE_URL!=='undefined')?SUPABASE_URL:'',
    key: (typeof SUPABASE_ANON_KEY!=='undefined')?SUPABASE_ANON_KEY:'',
    token: localStorage.getItem('sb-auth-token')
  };
}
async function api(path, opts){
  opts=opts||{};
  const {url,key,token}=sbCfg();
  const headers=Object.assign({
    'apikey':key,'Authorization':'Bearer '+(token||key),'Content-Type':'application/json'
  }, opts.headers||{});
  const res=await fetch(url+'/rest/v1/'+path, Object.assign({},opts,{headers}));
  if(!res.ok){const txt=await res.text();throw new Error(res.status+' '+txt);}
  if(res.status===204)return null;
  const txt=await res.text();return txt?JSON.parse(txt):null;
}
const dbGet   =(p)=>api(p,{method:'GET'});
const dbPost  =(p,b)=>api(p,{method:'POST',headers:{'Prefer':'return=representation'},body:JSON.stringify(b)});
const dbPatch =(p,b)=>api(p,{method:'PATCH',headers:{'Prefer':'return=representation'},body:JSON.stringify(b)});
const dbDel   =(p)=>api(p,{method:'DELETE'});
async function rpc(name, body){
  const {url,key,token}=sbCfg();
  const res=await fetch(url+'/rest/v1/rpc/'+name,{
    method:'POST',
    headers:{'apikey':key,'Authorization':'Bearer '+(token||key),'Content-Type':'application/json'},
    body:JSON.stringify(body||{})
  });
  if(!res.ok){const t=await res.text();throw new Error(res.status+' '+t);}
  const t=await res.text();return t?JSON.parse(t):null;
}

