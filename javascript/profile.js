    const fields = {
      name: { view: 'nameView', input: 'nameInput' },
      cell_phone: { view: 'phoneView', input: 'phoneInput' },
      location: { view: 'locationView', input: 'locationInput' },
      x_handle: { view: 'xView', input: 'xInput' },
      bluesky_handle: { view: 'bskyView', input: 'bskyInput' },
      discord_handle: { view: 'discordView', input: 'discordInput' },
      sleeper_handle: { view: 'sleeperView', input: 'sleeperInput' },
      mfl_handle: { view: 'mflView', input: 'mflInput' }
    };

    function displayProfile() {
      if (!auth.isAuthenticated()) {
        window.location.href = './login.html';
        return;
      }
      document.getElementById('userEmail').textContent = 'Email: ' + auth.user.email;
      Object.entries(fields).forEach(([key, ids]) => {
        const value = auth.profile[key] || '';
        document.getElementById(ids.view).textContent = value || '(not set)';
        document.getElementById(ids.input).value = value;
      });
    }

    function toggleEdit(show) {
      Object.values(fields).forEach(ids => {
        document.getElementById(ids.input).classList.toggle('active', show);
        document.getElementById(ids.view).style.display = show ? 'none' : 'block';
      });
      document.getElementById('editLink').style.display = show ? 'none' : 'inline';
      document.getElementById('buttonRow').classList.toggle('active', show);
    }

    document.getElementById('editLink').onclick = () => toggleEdit(true);
    document.getElementById('cancelBtn').onclick = () => { toggleEdit(false); displayProfile(); };
    
    document.getElementById('profileForm').onsubmit = async (e) => {
      e.preventDefault();
      const updates = {};
      Object.entries(fields).forEach(([key, ids]) => {
        updates[key] = document.getElementById(ids.input).value;
      });
      try {
        await auth.updateProfile(updates);
        document.getElementById('messageBox').textContent = 'Saved!';
        document.getElementById('messageBox').className = 'message success show';
        setTimeout(() => { toggleEdit(false); displayProfile(); }, 1500);
      } catch (err) {
        document.getElementById('messageBox').textContent = err.message;
        document.getElementById('messageBox').className = 'message error show';
      }
    };

    document.getElementById('logoutBtn').onclick = async () => {
      await auth.logout();
      window.location.href = './login.html';
    };

    async function initProfile() {
      let attempts = 0;
      while (!auth.profile && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      displayProfile();
    }

    initProfile();
