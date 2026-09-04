(function(){
  'use strict';
  var form=document.getElementById('fnpJoinForm'), msg=document.getElementById('fnpJoinMsg');
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
    var body={name:fd.get('name'),email:fd.get('email')||null,phone:fd.get('phone')||null,dob:fd.get('dob')||null,role:fd.get('role')||null,reason:fd.get('reason')||null,source:'website'};
    if(!body.name){ msg.className='join-msg bad'; msg.textContent='Please enter your name.'; return; }
    if(!cfg){ msg.className='join-msg bad'; msg.textContent='Something went wrong. Please try again.'; return; }
    btn.disabled=true; btn.textContent='Sending…';
    try{
      var res=await fetch(cfg.url+'/rest/v1/recruits',{method:'POST',headers:{'apikey':cfg.key,'Authorization':'Bearer '+cfg.key,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(body)});
      if(res.ok){ form.reset(); msg.className='join-msg ok'; msg.textContent='Thanks — we\'ll be in touch!'; }
      else { msg.className='join-msg bad'; msg.textContent='Something went wrong. Please try again.'; }
    }catch(err){ msg.className='join-msg bad'; msg.textContent='Something went wrong. Please try again.'; }
    btn.disabled=false; btn.textContent='Apply Now';
  });
})();