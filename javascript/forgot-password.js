    var form = document.getElementById('forgot-form');
    var msg = document.getElementById('msg');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button');
      var email = document.getElementById('email').value.trim();
      var redirectTo = new URL('reset-password.html', location.href).href;
      msg.className = 'msg';
      btn.classList.add('loading');
      try {
        await auth.requestPasswordReset(email, redirectTo);
        msg.textContent = 'Check your email for a link to reset your password. It may take a minute to arrive.';
        msg.className = 'msg show success';
        form.querySelector('input').value = '';
      } catch (err) {
        msg.textContent = err.message || 'Something went wrong. Please try again.';
        msg.className = 'msg show error';
      } finally {
        btn.classList.remove('loading');
      }
    });
  