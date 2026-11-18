import {
  Settings,
  SystemMetrics,
  SystemUpdateInfo,
  SelfUpdateResult,
} from '../../types';
import { webFetch, PreSaveGuardError, remoteEndpoint } from './client';

export const systemApi = {
  async getAuthStatus(): Promise<{ authRequired: boolean; authenticated: boolean; user: string }> {
    const res = await webFetch('/api/auth/status');
    if (!res.ok) return { authRequired: false, authenticated: true, user: 'guest' };
    return res.json();
  },

  async getSysInfo(server?: string): Promise<SystemMetrics> {
    const qs = server && server !== 'local' && server !== 'localhost' ? `?server=${encodeURIComponent(server)}` : '';
    const res = await webFetch(`/api/sysinfo${qs}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch system metrics (HTTP ${res.status})`);
    }
    return res.json();
  },

  async login(username: string, password: string): Promise<void> {
    const res = await webFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Invalid credentials');
    }
  },

  async logout(): Promise<void> {
    await webFetch('/api/auth/logout', { method: 'POST' });
  },

  async getSettings(): Promise<Settings> {
    const res = await webFetch('/api/settings');
    if (!res.ok) throw new Error('Failed to load settings');
    return res.json();
  },

  async updateSettings(settings: Partial<Settings>): Promise<Settings> {
    const res = await webFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update settings');
    }
    return res.json();
  },

  async uploadIcon(file: File): Promise<Settings> {
    const formData = new FormData();
    formData.append('icon', file);
    const res = await webFetch('/api/settings/icon', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload icon');
    }
    return res.json();
  },

  async checkSystemUpdate(): Promise<SystemUpdateInfo> {
    const res = await webFetch('/api/system/check-update');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to check system update');
    }
    return res.json();
  },

  async applySelfUpdate(downloadUrl?: string): Promise<SelfUpdateResult> {
    const res = await webFetch('/api/system/self-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to apply update');
    }
    return res.json();
  },

  async restartSystem(): Promise<{ success: boolean; message: string }> {
    const res = await webFetch('/api/system/restart', {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to restart server');
    }
    return res.json();
  },
};
