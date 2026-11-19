import {
  PluginItem,
  PendingInstall,
  ProcessInfo,
  PluginCommandResult,
  PluginSource,
  CatalogItem,
} from '../../types';
import { webFetch, PreSaveGuardError, remoteEndpoint } from './client';

export const pluginsApi = {
  // Plugin APIs
  async getPlugins(): Promise<PluginItem[]> {
    const res = await webFetch(`/api/plugins?_t=${Date.now()}`);
    if (!res.ok) throw new Error('Failed to load plugins');
    const data = await res.json();
    return data.plugins || [];
  },

  async togglePlugin(id: string, enabled: boolean): Promise<PluginItem> {
    const res = await webFetch('/api/plugins/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to toggle plugin');
    }
    return res.json();
  },

  async getPluginSettings(id: string): Promise<Record<string, any>> {
    const res = await webFetch(`/api/plugins/${encodeURIComponent(id)}/settings`);
    if (!res.ok) return {};
    const data = await res.json().catch(() => ({}));
    return data.settings || {};
  },

  async savePluginSettings(id: string, settings: Record<string, any>): Promise<void> {
    const res = await webFetch(`/api/plugins/${encodeURIComponent(id)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save plugin settings');
    }
  },

  async inspectPluginZip(file: File): Promise<PendingInstall> {
    const formData = new FormData();
    formData.append('plugin', file);
    const res = await webFetch('/api/plugins/inspect/upload', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to inspect plugin archive');
    }
    const data = await res.json();
    return data.pending;
  },

  async inspectPluginUrl(url: string): Promise<PendingInstall> {
    const res = await webFetch('/api/plugins/inspect/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to inspect plugin from URL');
    }
    const data = await res.json();
    return data.pending;
  },

  async confirmPluginInstall(tempKey: string): Promise<PluginItem> {
    const res = await webFetch('/api/plugins/install/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempKey }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to confirm plugin installation');
    }
    const data = await res.json();
    return data.plugin;
  },

  async cancelPluginInstall(tempKey: string): Promise<void> {
    await webFetch('/api/plugins/install/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempKey }),
    }).catch(() => {});
  },

  async uploadPluginZip(file: File): Promise<PluginItem> {
    const formData = new FormData();
    formData.append('plugin', file);
    const res = await webFetch('/api/plugins/install/upload', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload plugin archive');
    }
    const data = await res.json();
    return data.plugin;
  },

  async installPluginUrl(url: string): Promise<PluginItem> {
    const res = await webFetch('/api/plugins/install/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to install plugin from URL');
    }
    const data = await res.json();
    return data.plugin;
  },

  async deletePlugin(id: string): Promise<void> {
    const res = await webFetch(`/api/plugins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete plugin');
    }
  },

  async execPluginCommand(
    pluginId: string,
    command: string,
    args: string[] = [],
    cwd?: string,
    confirmed?: boolean
  ): Promise<PluginCommandResult> {
    const res = await webFetch('/api/plugins/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId, command, args, cwd, confirmed }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Command execution failed');
    }
    return res.json();
  },

  async startPluginProcess(
    pluginId: string,
    command: string,
    args: string[] = [],
    cwd?: string,
    port?: number,
    confirmed?: boolean
  ): Promise<ProcessInfo> {
    const res = await webFetch('/api/plugin-processes/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId, command, args, cwd, port, confirmed }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to start process');
    }
    return res.json();
  },

  async stopPluginProcess(processId: string): Promise<void> {
    const res = await webFetch('/api/plugin-processes/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to stop process');
    }
  },

  async getPluginProcesses(): Promise<ProcessInfo[]> {
    const res = await webFetch('/api/plugin-processes');
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.processes || [];
  },

  async getPluginProcessLogs(processId: string): Promise<string> {
    const res = await webFetch(`/api/plugin-processes/${encodeURIComponent(processId)}/logs`);
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    return data.logs || '';
  },
  // Sources & Catalog APIs
  async getSources(): Promise<PluginSource[]> {
    const res = await webFetch('/api/plugins/sources');
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.sources || [];
  },

  async addSource(source: { name: string; url: string }): Promise<PluginSource> {
    const res = await webFetch('/api/plugins/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add plugin source');
    }
    return res.json();
  },

  async updateSource(id: string, update: Partial<PluginSource>): Promise<void> {
    const res = await webFetch(`/api/plugins/sources/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update plugin source');
    }
  },

  async deleteSource(id: string): Promise<void> {
    const res = await webFetch(`/api/plugins/sources/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete plugin source');
    }
  },

  async syncSources(): Promise<{ items: CatalogItem[]; sources: PluginSource[] }> {
    const res = await webFetch('/api/plugins/sources/sync', {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to sync sources');
    }
    return res.json();
  },

  async getCatalog(forceRefresh = false): Promise<CatalogItem[]> {
    const query = forceRefresh ? '?refresh=1' : '';
    const res = await webFetch(`/api/plugins/catalog${query}`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.catalog || [];
  },

  // Profile Portability APIs
  getProfileExportUrl(): string {
    return `/api/profile/export?web=1`;
  },
};
