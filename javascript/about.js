var swiper = new Swiper(".teamSwiper", {
   loop: false,             // THIS DISABLES THE LOOP
   slidesPerView: 3.2,      // Shows 3 full cards + a peek of the 4th
   spaceBetween: 30,
    centeredSlides: false,
    grabCursor: true,
        
        // Auto-rotation settings
    autoplay: {
      delay: 3000,
      disableOnInteraction: true, // Stops auto-play when user takes control
    },
        
      navigation: {
      nextEl: ".swiper-button-next",
      prevEl: ".swiper-button-prev",
    },
        
      breakpoints: {
        320: { slidesPerView: 1, spaceBetween: 10, centeredSlides: true },
        768: { slidesPerView: 3.2, spaceBetween: 30, centeredSlides: false }
      }
    });     
 
(function(){
  var form=document.getElementById('fnpJoinForm'), msg=document.getElementById('fnpJoinMsg');
  var btn=form.querySelector('button');
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var fd=new FormData(form);
    var body={name:fd.get('name'),email:fd.get('email')||null,phone:fd.get('phone')||null,dob:fd.get('dob')||null,role:fd.get('role')||null,reason:fd.get('reason')||null,source:'website'};
    if(!body.name){ msg.className='fnp-join-msg bad'; msg.textContent='Please enter your name.'; return; }
    btn.disabled=true; btn.textContent='Sending…';
    try{
      var res=await fetch(SUPABASE_URL+'/rest/v1/recruits',{method:'POST',headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(body)});
      if(res.ok){ form.reset(); msg.className='fnp-join-msg ok'; msg.textContent='Thanks — we\'ll be in touch!'; }
      else { msg.className='fnp-join-msg bad'; msg.textContent='Something went wrong. Please try again.'; }
    }catch(err){ msg.className='fnp-join-msg bad'; msg.textContent='Something went wrong. Please try again.'; }
    btn.disabled=false; btn.textContent='Apply Now';
  });
})();