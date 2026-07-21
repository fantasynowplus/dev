const SUPABASE_URL = 'https://fckobcxprmudfpxdmswi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lUJ8FDkLUorRO5PQwvMHTA_5_W_mbh2';

class AuthManager {
  constructor() {
    this.user = null;
    this.profile = null;
    this.loadSession();
  }

  async loadSession() {
    const token = localStorage.getItem('sb-auth-token');
    if (!token) return false;
    try {
      const decoded = this.decodeJWT(token);
      if (decoded.exp * 1000 < Date.now()) {
        localStorage.removeItem('sb-auth-token');
        return false;
      }
      this.user = decoded;
      await this.fetchProfile();
      return true;
    } catch (e) {
      console.error('Session invalid:', e);
      localStorage.removeItem('sb-auth-token');
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
      localStorage.setItem('sb-auth-token', data.session.access_token);
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

  async login(email, password) {
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
    localStorage.setItem('sb-auth-token', data.access_token);
    this.user = this.decodeJWT(data.access_token);
    await this.fetchProfile();
    return this.user;
  }

  async logout() {
    localStorage.removeItem('sb-auth-token');
    this.user = null;
    this.profile = null;
  }

  async fetchProfile() {
    if (!this.user) return null;
    const token = localStorage.getItem('sb-auth-token');
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
    const token = localStorage.getItem('sb-auth-token');
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
