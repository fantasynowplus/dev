(function () {
  function applyAccountNav() {
    const label = (auth.profile && auth.profile.name) || auth.user.email;
    document.querySelectorAll('.btn-login').forEach(function (link) {
      link.textContent = label;
      link.setAttribute('href', 'profile.html');
    });
  }
  function start() {
    if (typeof auth === 'undefined' || !auth.isAuthenticated()) return;
    let tries = 0;
    (function waitForProfile() {
      if (auth.profile || tries >= 15) { applyAccountNav(); return; }
      tries++;
      setTimeout(waitForProfile, 100);
    })();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();