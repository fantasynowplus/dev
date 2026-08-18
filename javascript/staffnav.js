(function () {
  const ADMIN_URL = 'admin.html';
  const LABEL = 'Staff Login';
  const CACHE_KEY = 'fnp_is_staff';

  function token() {
    try { return localStorage.getItem('sb-auth-token'); } catch (e) { return null; }
  }

  async function isStaff() {
    const t = token();
    if (!t) return false;
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached !== null) return cached === '1';
    } catch (e) {}
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/my_staff_id', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + t,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
      if (!res.ok) return false;
      const id = await res.json();
      const ok = !!id;
      try { sessionStorage.setItem(CACHE_KEY, ok ? '1' : '0'); } catch (e) {}
      return ok;
    } catch (e) { return false; }
  }

  function inject() {
    document.querySelectorAll('.desktop-nav, .mobile-nav').forEach(function (nav) {
      if (nav.querySelector('.btn-staff')) return;
      const a = document.createElement('a');
      a.href = ADMIN_URL;
      a.className = 'btn-login btn-staff';
      a.textContent = LABEL;
      const loginBtn = nav.querySelector('.btn-login');
      if (loginBtn) loginBtn.insertAdjacentElement('beforebegin', a);
      else nav.appendChild(a);
    });
  }

  async function run() {
    document.querySelectorAll('.btn-staff').forEach(function (el) { el.remove(); });
    if (await isStaff()) inject();
  }

  async function boot() {
    for (let i = 0; i < 40 && typeof SUPABASE_URL === 'undefined'; i++) {
      await new Promise(function (r) { setTimeout(r, 100); });
    }
    if (typeof SUPABASE_URL === 'undefined') return;
    run();
  }

  window.refreshStaffNav = run;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();