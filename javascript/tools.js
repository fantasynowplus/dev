(function(){
  function show(){document.getElementById('toolsCta').hidden=false;}
  function check(tries){
    if(typeof auth==='undefined'){
      if(tries>60)return show();
      return setTimeout(function(){check((tries||0)+1);},100);
    }
    if(!(auth.isAuthenticated&&auth.isAuthenticated()&&localStorage.getItem('sb-auth-token')))show();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){check(0);});
  else check(0);
})();
