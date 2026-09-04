(function(){
  'use strict';
  var CONFIG = window.CHANNEL_CONFIG || {};
  var CFG = null;

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
  function rpc(fn,body){
    return fetch(CFG.url+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:CFG.key,Authorization:'Bearer '+CFG.key},body:JSON.stringify(body||{})})
      .then(function(r){ if(!r.ok) throw new Error(fn+' '+r.status); return r.json(); });
  }

  function renderStaff(rows){
    var grid=document.getElementById('ytStaffGrid'); if(!grid) return;
    var filtered=(rows||[]).filter(function(s){
      return (s.shows||[]).some(function(sh){ return sh.channel_name===CONFIG.channelName; });
    });
    if(!filtered.length){ grid.innerHTML='<p class="team-empty">Staff coming soon.</p>'; return; }
    grid.innerHTML=filtered.map(function(s){
      return '<div class="team-card">'+
        '<img src="'+esc(headshotUrl(s.headshot))+'" alt="'+esc(s.name)+'" onerror="this.src=\'assets/headshots/placeholder.png\'">'+
        '<h3>'+esc(s.name)+'</h3>'+
        (s.role?'<p class="team-role">'+esc(s.role)+'</p>':'')+
        (s.department?'<span class="team-dept">'+esc(s.department)+'</span>':'')+
      '</div>';
    }).join('');
  }

  function loadStaff(){
    rpc('team_public').then(renderStaff).catch(function(e){
      console.error(e);
      var grid=document.getElementById('ytStaffGrid'); if(grid) grid.innerHTML='<p class="team-empty">Unable to load staff right now.</p>';
    });
  }

  function firstParagraph(desc){
    if(!desc) return '';
    var block=String(desc).split(/\n\s*\n/)[0]||'';
    block=block.split('\n')[0]||block;
    return block.length>280 ? block.slice(0,277)+'…' : block;
  }
  function fmtDate(iso){
    if(!iso) return '';
    var d=new Date(iso);
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }

  function videoCard(v){
    return '<div class="yt-item" data-video="'+esc(v.video_id)+'">'+
      '<div class="yt-thumb-wrap">'+
        '<img class="yt-thumb" src="'+esc(v.thumbnail_url)+'" alt="'+esc(v.title)+'">'+
        '<span class="yt-play"><i class="fa-solid fa-circle-play"></i></span>'+
      '</div>'+
      '<div class="yt-info">'+
        '<h3>'+esc(v.title)+'</h3>'+
        '<p class="yt-date">'+esc(fmtDate(v.published_at))+'</p>'+
        '<p class="yt-desc">'+esc(firstParagraph(v.description))+'</p>'+
      '</div>'+
    '</div>';
  }

  function playVideo(el){
    if(el.classList.contains('playing')) return;
    var id=el.dataset.video;
    var wrap=el.querySelector('.yt-thumb-wrap');
    wrap.innerHTML='<iframe src="https://www.youtube.com/embed/'+encodeURIComponent(id)+'?autoplay=1" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    el.classList.add('playing');
  }

  function renderVideos(rows){
    var wrap=document.getElementById('ytVideoFeed'); if(!wrap) return;
    if(!rows||!rows.length){ wrap.innerHTML='<p class="team-empty">No videos yet — check back soon.</p>'; return; }
    wrap.innerHTML=rows.map(videoCard).join('');
    wrap.querySelectorAll('.yt-item').forEach(function(el){
      el.addEventListener('click', function(){ playVideo(el); });
    });
  }

  function loadVideos(){
    rpc('latest_videos_public',{p_channel_id:CONFIG.ytChannelId,p_limit:CONFIG.videoLimit||10}).then(renderVideos).catch(function(e){
      console.error(e);
      var wrap=document.getElementById('ytVideoFeed'); if(wrap) wrap.innerHTML='<p class="team-empty">Unable to load videos right now.</p>';
    });
  }

  function boot(){
    CFG=sbCfg();
    if(!CFG || !CONFIG.ytChannelId){
      var g=document.getElementById('ytStaffGrid'); if(g) g.innerHTML='<p class="team-empty">Unable to load right now.</p>';
      var v=document.getElementById('ytVideoFeed'); if(v) v.innerHTML='<p class="team-empty">Unable to load right now.</p>';
      return;
    }
    loadStaff();
    loadVideos();
  }
  document.addEventListener('DOMContentLoaded', boot);
})();