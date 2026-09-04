const SUPABASE_URL = 'https://fckobcxprmudfpxdmswi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lUJ8FDkLUorRO5PQwvMHTA_5_W_mbh2';

class AuthManager {
  constructor() {
    this.user = null;
    this.profile = null;
    this.loadSession();
  }

  getTokenStorage() {
    return localStorage.getItem('sb-remember') === 'false' ? sessionStorage : localStorage;
  }

  saveTokens(accessToken, refreshToken, remember) {
    if (remember !== undefined) {
      localStorage.setItem('sb-remember', remember ? 'true' : 'false');
    }
    const store = this.getTokenStorage();
    store.setItem('sb-auth-token', accessToken);
    if (refreshToken) store.setItem('sb-refresh-token', refreshToken);
  }

  clearTokens() {
    localStorage.removeItem('sb-auth-token');
    localStorage.removeItem('sb-refresh-token');
    sessionStorage.removeItem('sb-auth-token');
    sessionStorage.removeItem('sb-refresh-token');
  }

  async refreshSession() {
    const store = this.getTokenStorage();
    const refreshToken = store.getItem('sb-refresh-token');
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.clearTokens();
        return false;
      }
      this.saveTokens(data.access_token, data.refresh_token);
      this.user = this.decodeJWT(data.access_token);
      return true;
    } catch (e) {
      console.error('Refresh failed:', e);
      this.clearTokens();
      return false;
    }
  }

  async loadSession() {
    const store = this.getTokenStorage();
    const token = store.getItem('sb-auth-token');
    if (!token) return false;
    try {
      const decoded = this.decodeJWT(token);
      if (decoded.exp * 1000 < Date.now()) {
        const refreshed = await this.refreshSession();
        if (!refreshed) return false;
        await this.fetchProfile();
        return true;
      }
      this.user = decoded;
      await this.fetchProfile();
      return true;
    } catch (e) {
      console.error('Session invalid:', e);
      this.clearTokens();
      return false;
    }
  }

  getErrorMessage(error) {
    if (error.message) return error.message;
    if (error.error_code === 'user_already_exists') {
      return 'This email is already registered. Please login instead.';
    }
    if (error.msg && error.msg.includes('already exists')) {
      return 'This email is already registered. Please login instead.';
    }
    if (error.msg) return error.msg;
    return 'An error occurred. Please try again.';
  }

  async signup(email, password, name) {
    if (!email || !password) {
      throw new Error('Please fill in all fields.');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please enter a valid email address.');
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(this.getErrorMessage(data));
    }
    if (data.session && data.session.access_token) {
      this.saveTokens(data.session.access_token, data.session.refresh_token, true);
      this.user = data.user;
    }
    if (data.user) {
      await this.saveSignupName(email, name);
    }
    return { success: true, requiresConfirmation: !data.session };
  }

  async saveSignupName(email, name) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ name }),
        }
      );
    } catch (e) {
      console.error('Error saving name:', e);
    }
  }

  async login(email, password, remember = true) {
    if (!email || !password) {
      throw new Error('Please enter both email and password.');
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error_description === 'Invalid login credentials') {
        throw new Error('Email or password is incorrect.');
      }
      throw new Error(this.getErrorMessage(data));
    }
    this.saveTokens(data.access_token, data.refresh_token, remember);
    this.user = this.decodeJWT(data.access_token);
    await this.fetchProfile();
    return this.user;
  }

  async logout() {
    this.clearTokens();
    this.user = null;
    this.profile = null;
  }

  async requestPasswordReset(email, redirectTo) {
    if (!email) throw new Error('Please enter your email.');
    const url = `${SUPABASE_URL}/auth/v1/recover` +
      (redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(this.getErrorMessage(await res.json().catch(() => ({}))));
    return { success: true };
  }

  async setNewPassword(accessToken, newPassword) {
    if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters.');
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(this.getErrorMessage(data));
    return { success: true };
  }

  async fetchProfile() {
    if (!this.user) return null;
    const token = this.getTokenStorage().getItem('sb-auth-token');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.user.sub}`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
      }
    );
    if (!res.ok) throw new Error('Failed to fetch profile');
    const data = await res.json();
    this.profile = data[0] || {};
    return this.profile;
  }

  async updateProfile(updates) {
    if (!this.user) throw new Error('Not authenticated');
    const token = this.getTokenStorage().getItem('sb-auth-token');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.user.sub}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          ...updates,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to update profile: ${errorText}`);
    }
    const responseText = await res.text();
    if (!responseText) {
      this.profile = { ...this.profile, ...updates };
      return this.profile;
    }
    try {
      const data = JSON.parse(responseText);
      this.profile = Array.isArray(data) ? data[0] : data;
      return this.profile;
    } catch (e) {
      this.profile = { ...this.profile, ...updates };
      return this.profile;
    }
  }

  isAuthenticated() {
    return !!this.user;
  }

  decodeJWT(token) {
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  }
}

const auth = new AuthManager();
