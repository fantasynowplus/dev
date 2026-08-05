(function () {
  function $(id) { return document.getElementById(id); }
  function loggedIn() { return typeof auth !== 'undefined' && auth.isAuthenticated(); }
  var FIELDS = ['name','cell_phone','location','x_handle','bluesky_handle','discord_handle','sleeper_handle','mfl_handle'];

  function openModal(id) { var m = $(id); if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; } }
  function closeModals() {
    document.querySelectorAll('.fn-modal-backdrop.open').forEach(function (m) { m.classList.remove('open'); });
    document.body.style.overflow = '';
  }

  function fillProfile() {
    if ($('fnProfileEmail') && auth.user) $('fnProfileEmail').textContent = auth.user.email;
    FIELDS.forEach(function (k) { var i = $('fp_' + k); if (i) i.value = (auth.profile && auth.profile[k]) || ''; });
  }

  function refreshNav() {
    var links = document.querySelectorAll('.btn-login');
    links.forEach(function (link) {
      if (loggedIn()) {
        link.textContent = (auth.profile && auth.profile.name) || (auth.user && auth.user.email) || 'My Account';
        link.setAttribute('href', '#');
        link.onclick = async function (e) {
          e.preventDefault();
          openModal('profileBackdrop');
          try { if (auth.fetchProfile) await auth.fetchProfile(); } catch (x) {}
          fillProfile();
        };
      } else {
        link.textContent = 'Login';
        link.setAttribute('href', 'login.html');
        link.onclick = function (e) { e.preventDefault(); showLogin(); openModal('loginBackdrop'); };
      }
    });
  }

  function showLogin() {
    if ($('fnLoginForm')) $('fnLoginForm').style.display = 'block';
    if ($('fnSignupForm')) $('fnSignupForm').style.display = 'none';
    if ($('authTitle')) $('authTitle').textContent = 'Login';
    if ($('fnAuthToggle')) $('fnAuthToggle').innerHTML = "Don't have an account? <a data-auth-toggle>Sign up</a>";
    if ($('fnAuthMsg')) $('fnAuthMsg').className = 'fn-msg';
    bindToggle();
  }
  function showSignup() {
    if ($('fnLoginForm')) $('fnLoginForm').style.display = 'none';
    if ($('fnSignupForm')) $('fnSignupForm').style.display = 'block';
    if ($('authTitle')) $('authTitle').textContent = 'Sign Up';
    if ($('fnAuthToggle')) $('fnAuthToggle').innerHTML = "Already have an account? <a data-auth-toggle>Login</a>";
    if ($('fnAuthMsg')) $('fnAuthMsg').className = 'fn-msg';
    bindToggle();
  }
  function bindToggle() {
    var t = document.querySelector('[data-auth-toggle]');
    if (t) t.onclick = function () {
      if ($('fnSignupForm') && $('fnSignupForm').style.display === 'none') showSignup(); else showLogin();
    };
  }
  function msg(el, text, kind) { if (el) { el.textContent = text; el.className = 'fn-msg show ' + kind; } }

  function wire() {
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModals; });
    document.querySelectorAll('.fn-modal-backdrop').forEach(function (bd) {
      bd.addEventListener('click', function (e) { if (e.target === bd) closeModals(); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModals(); });

    var lf = $('fnLoginForm');
    if (lf) lf.addEventListener('submit', async function (e) {
      e.preventDefault();
      try { await auth.login($('fnLoginEmail').value, $('fnLoginPassword').value); closeModals(); refreshNav(); }
      catch (err) { msg($('fnAuthMsg'), err.message, 'error'); }
    });

    var sf = $('fnSignupForm');
    if (sf) sf.addEventListener('submit', async function (e) {
      e.preventDefault();
      try { await auth.signup($('fnSignupEmail').value, $('fnSignupPassword').value, ''); msg($('fnAuthMsg'), 'Account created! You can log in now.', 'success'); setTimeout(showLogin, 1500); }
      catch (err) { msg($('fnAuthMsg'), err.message, 'error'); }
    });

    var pf = $('fnProfileForm');
    if (pf) pf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var updates = {};
      FIELDS.forEach(function (k) { var i = $('fp_' + k); if (i) updates[k] = i.value; });
      try { await auth.updateProfile(updates); msg($('fnProfileMsg'), 'Saved!', 'success'); refreshNav(); }
      catch (err) { msg($('fnProfileMsg'), err.message, 'error'); }
    });

    var lo = document.querySelector('[data-logout]');
    if (lo) lo.onclick = async function () { await auth.logout(); closeModals(); refreshNav(); };
  }

  function start() {
    wire();
    refreshNav();
    if (loggedIn()) {
      var tries = 0;
      (function w() { if (auth.profile || tries >= 15) { refreshNav(); return; } tries++; setTimeout(w, 100); })();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();