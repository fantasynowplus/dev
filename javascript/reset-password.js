    function hashParams() {
      var h = (location.hash || '').replace(/^#/, '');
      var out = {};
      h.split('&').forEach(function (p) {
        var i = p.indexOf('=');
        if (i > -1) out[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1));
      });
      return out;
    }

    var params = hashParams();
    var accessToken = params.access_token;
    var isRecovery = params.type === 'recovery' && !!accessToken;

    var form = document.getElementById('reset-form');
    var msg = document.getElementById('msg');
    var sub = document.getElementById('sub');

    if (!isRecovery) {
      form.style.display = 'none';
      sub.textContent = 'This reset link is invalid or has expired.';
      msg.textContent = 'Request a new link from the reset password page.';
      msg.className = 'msg show error';
      var back = document.querySelector('.alt-link');
      back.innerHTML = '<a href="forgot-password">Request a new link</a>';
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button');
      var pw = document.getElementById('password').value;
      var confirm = document.getElementById('confirm').value;
      msg.className = 'msg';
      if (pw !== confirm) {
        msg.textContent = 'Passwords do not match.';
        msg.className = 'msg show error';
        return;
      }
      btn.classList.add('loading');
      try {
        await auth.setNewPassword(accessToken, pw);
        form.style.display = 'none';
        sub.textContent = 'Your password has been updated.';
        msg.textContent = 'You can now log in with your new password.';
        msg.className = 'msg show success';
      } catch (err) {
        msg.textContent = err.message || 'Could not update password. The link may have expired.';
        msg.className = 'msg show error';
        btn.classList.remove('loading');
      }
    });
  