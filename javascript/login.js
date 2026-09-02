    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const toggleBtn = document.getElementById('toggle-btn');
    const toggleText = document.getElementById('toggle-text');
    const loginError = document.getElementById('error');
    const signupError = document.getElementById('error-signup');

    function attachToggleListener() {
      document.getElementById('toggle-btn').addEventListener('click', toggleForms);
    }

    function toggleForms(e) {
      e.preventDefault();
      const isLoginVisible = loginForm.style.display !== 'none';
      loginForm.style.display = isLoginVisible ? 'none' : 'block';
      signupForm.style.display = isLoginVisible ? 'block' : 'none';
      
      if (isLoginVisible) {
        toggleText.innerHTML = "Already have an account? <a id='toggle-btn'>Login</a>";
      } else {
        toggleText.innerHTML = "Don't have an account? <a id='toggle-btn'>Sign up</a>";
      }
      attachToggleListener();
    }

    attachToggleListener();

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const button = loginForm.querySelector('button');
      
      loginError.classList.remove('show');
      button.classList.add('loading');

      try {
        await auth.login(email, password);
        window.location.href = './index.html';
      } catch (err) {
        loginError.textContent = err.message;
        loginError.classList.add('show');
        button.classList.remove('loading');
      }
    });

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const button = signupForm.querySelector('button');
  
  signupError.classList.remove('show');
  button.classList.add('loading');

  try {
    const result = await auth.signup(email, password, '');
    if (result.success) {
      signupError.classList.remove('show');
      signupError.style.background = '#dcfce7';
      signupError.style.color = '#16a34a';
      signupError.textContent = 'Account created! Please login.';
      signupError.classList.add('show');
      
      setTimeout(() => {
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-password').value = '';
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
        toggleText.innerHTML = "Don't have an account? <a id='toggle-btn'>Sign up</a>";
        attachToggleListener();
        signupError.classList.remove('show');
      }, 2000);
    }
  } catch (err) {
    signupError.textContent = err.message;
    signupError.classList.add('show');
    button.classList.remove('loading');
  }
});
