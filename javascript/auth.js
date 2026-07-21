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

  async signup(email, password, name) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message);
    }

    const data = await res.json();
    localStorage.setItem('sb-auth-token', data.session.access_token);
    this.user = data.user;

    await this.updateProfile({ name });
    return data.user;
  }

  async login(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error_description || err.message);
    }

    const data = await res.json();
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
        },
        body: JSON.stringify({
          ...updates,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!res.ok) throw new Error('Failed to update profile');
    const data = await res.json();
    this.profile = data[0];
    return this.profile;
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
