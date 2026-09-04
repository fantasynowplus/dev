(function(){
  'use strict';
  var CONFIG = window.CHANNEL_CONFIG || {};
  var CFG = null;
  var STAFF_DATA = [];
  var ACTIVE_SOURCE = { type: 'playlist', id: null };

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

  function staffCard(s){
    return '<div class="team-card">'+
      '<img src="'+esc(headshotUrl(s.headshot))+'" alt="'+esc(s.name)+'" onerror="this.src=\'assets/headshots/placeholder.png\'">'+
      '<h3>'+esc(s.name)+'</h3>'+
      (s.role?'<p class="team-role">'+esc(s.role)+'</p>':'')+
      (s.department?'<span class="team-dept">'+esc(s.department)+'</span>':'')+
    '</div>';
  }

  function showStaffForShow(showId){
    var section=document.getElementById('ytStaffSection');
    var grid=document.getElementById('ytStaffGrid');
    if(!section||!grid) return;
    var filtered=STAFF_DATA.filter(function(s){
      return (s.shows||[]).some(function(sh){ return sh.show_id===showId; });
    });
    if(!filtered.length){ section.hidden=true; grid.innerHTML=''; return; }
    grid.innerHTML=filtered.map(staffCard).join('');
    section.hidden=false;
  }

  function hideStaff(){
    var section=document.getElementById('ytStaffSection');
    var grid=document.getElementById('ytStaffGrid');
    if(section) section.hidden=true;
    if(grid) grid.innerHTML='';
  }

  function loadStaffData(){
    return rpc('team_public').then(function(rows){ STAFF_DATA=rows||[]; }).catch(function(e){ console.error(e); });
  }

  function renderShowFilters(shows){
    var wrap=document.getElementById('ytShowFilters'); if(!wrap) return;
    if(!shows.length){ wrap.innerHTML=''; return; }
    var all='<button class="team-filter-btn on" data-playlist="">All Videos</button>';
    var rest=shows.map(function(s){
      return '<button class="team-filter-btn" data-playlist="'+esc(s.youtube_playlist_id)+'" data-show="'+esc(s.id)+'">'+esc(s.name)+'</button>';
    }).join('');
    wrap.innerHTML='<div class="team-filter-row">'+all+rest+'</div>';
    wrap.querySelectorAll('.team-filter-btn').forEach(function(b){
      b.addEventListener('click', function(){
        wrap.querySelectorAll('.team-filter-btn').forEach(function(x){ x.classList.remove('on'); });
        b.classList.add('on');
        if(b.dataset.playlist){
          ACTIVE_SOURCE={type:'playlist',id:b.dataset.playlist};
          showStaffForShow(b.dataset.show);
        }else{
          ACTIVE_SOURCE={type:'playlist',id:CONFIG.allVideosPlaylistId};
          hideStaff();
        }
        loadVideos();
      });
    });
  }

  function loadShowFilters(){
    return rpc('show_playlists_public',{p_channel_uc_id:CONFIG.ytChannelId}).then(renderShowFilters).catch(function(e){
      console.error(e);
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
    var wrap=document.getElementById('ytVideoFeed'); if(wrap) wrap.innerHTML='<p class="team-empty">Loading…</p>';
    rpc('latest_videos_public',{p_source_type:ACTIVE_SOURCE.type,p_source_id:ACTIVE_SOURCE.id,p_limit:CONFIG.videoLimit||10})
      .then(renderVideos)
      .catch(function(e){
        console.error(e);
        if(wrap) wrap.innerHTML='<p class="team-empty">Unable to load videos right now.</p>';
      });
  }

  function boot(){
    CFG=sbCfg();
    if(!CFG || !CONFIG.allVideosPlaylistId){
      var v=document.getElementById('ytVideoFeed'); if(v) v.innerHTML='<p class="team-empty">Unable to load right now.</p>';
      return;
    }
    ACTIVE_SOURCE={type:'playlist',id:CONFIG.allVideosPlaylistId};
    loadStaffData();
    loadShowFilters();
    loadVideos();
  }
  document.addEventListener('DOMContentLoaded', boot);
})();