(function(){
  'use strict';
  var form=document.getElementById('fnpPartnerForm'), msg=document.getElementById('fnpPartnerMsg');
  if(!form) return;
  var btn=form.querySelector('button');
  function sbCfg(){
    var url=(typeof SUPABASE_URL!=='undefined')?SUPABASE_URL:window.SUPABASE_URL;
    var key=(typeof SUPABASE_ANON_KEY!=='undefined')?SUPABASE_ANON_KEY:window.SUPABASE_ANON_KEY;
    return (url&&key)?{url:url,key:key}:null;
  }
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var cfg=sbCfg();
    var fd=new FormData(form);
    var body={
      name:fd.get('name'), company:fd.get('company')||null, email:fd.get('email'),
      phone:fd.get('phone')||null, inquiry_type:fd.get('inquiry_type')||'General',
      message:fd.get('message'), website:fd.get('website')||''
    };
    if(!body.name||!body.email||!body.message){ msg.className='join-msg bad'; msg.textContent='Please fill in your name, email, and message.'; return; }
    if(!cfg){ msg.className='join-msg bad'; msg.textContent='Something went wrong. Please try again.'; return; }
    btn.disabled=true; btn.textContent='Sending…';
    try{
      var res=await fetch(cfg.url+'/functions/v1/send-partnership-inquiry',{
        method:'POST',
        headers:{'apikey':cfg.key,'Authorization':'Bearer '+cfg.key,'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      if(res.ok){ form.reset(); msg.className='join-msg ok'; msg.textContent='Thanks — we\'ll be in touch soon!'; }
      else { msg.className='join-msg bad'; msg.textContent='Something went wrong. Please try again.'; }
    }catch(err){ msg.className='join-msg bad'; msg.textContent='Something went wrong. Please try again.'; }
    btn.disabled=false; btn.textContent='Send Inquiry';
  });
})();