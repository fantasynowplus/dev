let BPP = { season: null, rows: [] };

function bppEsc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function bppInitials(name){
  return String(name||'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
}

async function bppSeason(){
  try{
    const r = await fetch('https://api.sleeper.app/v1/state/nfl');
    const s = await r.json();
    return Number(s.season) || new Date().getFullYear();
  }catch(e){
    return new Date().getFullYear();
  }
}

async function bppLoad(season){
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/bp_public', {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_season: season })
  });
  if(!res.ok) return [];
  return res.json();
}

function bppAvatarError(img, initials){
  const div = document.createElement('div');
  div.className = 'bpp-avatar bpp-avatar-fallback';
  div.textContent = initials;
  img.replaceWith(div);
}

function bppAvatar(r){
  const initials = bppInitials(r.author_name);
  if(r.headshot){
    return '<img class="bpp-avatar" src="'+bppEsc(r.headshot)+'" alt="'+bppEsc(r.author_name)+
      '" onerror="bppAvatarError(this,\''+initials.replace(/'/g,"\\'")+'\')">';
  }
  return '<div class="bpp-avatar bpp-avatar-fallback">'+bppEsc(initials)+'</div>';
}

function bppResultTag(r){
  return r.result ? '<span class="bpp-result bpp-result-'+r.result+'">'+(r.result==='hit'?'HIT':'MISS')+'</span>' : '';
}

function bppFeaturedCard(rows, slot){
  const mine = rows.filter(r=>r.featured_slot===slot);
  if(!mine.length) return '';
  const name = mine[0].author_name;
  const picks = ['QB','RB','WR','TE'].map(pos=>{
    const r = mine.find(x=>x.position===pos);
    if(!r) return '';
    return '<div class="bpp-pick"><span class="bpp-pos bpp-pos-'+pos+'">'+pos+'</span>'+
      '<div class="bpp-pick-body">'+(r.player_name?'<strong>'+bppEsc(r.player_name)+'</strong><br>':'')+
      bppEsc(r.prediction)+bppResultTag(r)+'</div></div>';
  }).join('');
  return '<div class="bpp-analyst-card">'+
    '<div class="bpp-analyst-head">'+bppAvatar(mine[0])+'<span class="bpp-analyst-name">'+bppEsc(name)+'</span></div>'+
    picks+'</div>';
}

function bppListItem(r){
  return '<div class="bpp-row" data-pos="'+r.position+'">'+
    '<span class="bpp-pos bpp-pos-'+r.position+'">'+r.position+'</span>'+
    '<div class="bpp-row-body"><strong>'+bppEsc(r.author_name)+'</strong> — '+
    (r.player_name?'<strong>'+bppEsc(r.player_name)+'</strong>: ':'')+bppEsc(r.prediction)+bppResultTag(r)+
    '</div></div>';
}

function bppRender(){
  document.getElementById('bppSeason').textContent = BPP.season + ' Season';
  const featured = [1,2].map(s=>bppFeaturedCard(BPP.rows,s)).join('');
  document.getElementById('bppFeatured').innerHTML = featured || '<p class="bpp-empty">No featured predictions published yet this season.</p>';
  const others = BPP.rows.filter(r=>!r.featured_slot);
  document.getElementById('bppList').innerHTML = others.length
    ? others.map(bppListItem).join('')
    : '<p class="bpp-empty">No other predictions published yet.</p>';
}

function bppFilter(pos){
  document.querySelectorAll('#bppTabs button').forEach(b=>b.classList.toggle('on', b.dataset.pos===pos));
  document.querySelectorAll('#bppList .bpp-row').forEach(el=>{
    el.style.display = (pos==='ALL' || el.dataset.pos===pos) ? '' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  document.getElementById('bppTabs').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    bppFilter(b.dataset.pos);
  });
  BPP.season = await bppSeason();
  BPP.rows = await bppLoad(BPP.season);
  bppRender();
});
