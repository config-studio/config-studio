import {
  Settings,
  FileItem,
  FileInfo,
  PluginItem,
  PendingInstall,
  ProcessInfo,
  AuditEvent,
  AuditQueryResponse,
  GuardIssue,
  GuardValidationResult,
  PluginSource,
  CatalogItem,
  StudioProfile,
  ProfilePreview,
  ProfileImportResult,
  SecretMeta,
  SecretItem,
  SecretsStatus,
  WorkspaceRoot,
  PluginCommandResult,
  SSHHost,
  SSHTestResult,
  SSHKeyPair,
  SFTPFileInfo,
  SFTPRequest,
} from '../types';
import { telemetry } from './telemetry';

export class PreSaveGuardError extends Error {
  guard: GuardIssue;
  issues: GuardIssue[];
  constructor(message: string, guard: GuardIssue, issues: GuardIssue[] = []) {
    super(message);
    this.name = 'PreSaveGuardError';
    this.guard = guard;
    this.issues = issues;
  }
}

let remoteEndpoint: string | null = localStorage.getItem('cs_active_remote_endpoint');
let remoteToken: string | null = localStorage.getItem('cs_active_remote_token');

export function setRemoteEndpoint(endpoint: string | null, token: string = '') {
  if (endpoint) {
    localStorage.setItem('cs_active_remote_endpoint', endpoint);
    localStorage.setItem('cs_active_remote_token', token);
    remoteEndpoint = endpoint;
    remoteToken = token;
  } else {
    localStorage.removeItem('cs_active_remote_endpoint');
    localStorage.removeItem('cs_active_remote_token');
    remoteEndpoint = null;
    remoteToken = null;
  }
}

export function getRemoteEndpoint() {
  return { endpoint: remoteEndpoint, token: remoteToken };
}

function shouldRouteToRemote(url: string): boolean {
  if (!remoteEndpoint) return false;
  // ONLY File System operations (files, trees, content) are proxied to the remote agent
  return url.startsWith('/api/fs/');
}

async function webFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  headers.set('X-ConfigStudio-Web', '1');
  headers.set('X-Nonce', `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('Pragma', 'no-cache');

  let finalUrl = url;
  if (shouldRouteToRemote(url) && remoteEndpoint) {
    headers.set('X-Remote-Target', remoteEndpoint);
    if (remoteToken) {
      headers.set('Authorization', `Bearer ${remoteToken}`);
    }
    // Route through backend proxy to eliminate browser Mixed Content (HTTPS -> HTTP) and CORS errors
    finalUrl = `/api/remote-proxy${url}`;
  }

  try {
    const res = await fetch(finalUrl, {
      ...options,
      headers,
      cache: 'no-store',
    });
    if (!res.ok && !url.includes('/api/audit/ingest')) {
      telemetry.captureNetworkError(url, res.status, res.statusText, {
        method: options.method || 'GET',
      });
    }
    return res;
  } catch (err: any) {
    if (!url.includes('/api/audit/ingest')) {
      telemetry.captureNetworkError(url, 0, err?.message || 'Network request failed', {
        method: options.method || 'GET',
      });
    }
    throw err;
  }
}

export const api = {
  async getAuthStatus(): Promise<{ authRequired: boolean; authenticated: boolean; user: string }> {
    const res = await webFetch('/api/auth/status');
    if (!res.ok) return { authRequired: false, authenticated: true, user: 'guest' };
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

  // Workspaces API (Multi-Root, isolated per server)
  async getWorkspaces(): Promise<{ workspaces: WorkspaceRoot[]; defaultRoot: string }> {
    const srv = remoteEndpoint ? `?server=${encodeURIComponent(remoteEndpoint)}` : '?server=local';
    const res = await webFetch(`/api/workspaces${srv}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to list workspaces');
    }
    return res.json();
  },

  async addWorkspace(root: Partial<WorkspaceRoot>): Promise<WorkspaceRoot> {
    const srv = remoteEndpoint ? `?server=${encodeURIComponent(remoteEndpoint)}` : '?server=local';
    const payload = {
      ...root,
      server: remoteEndpoint || 'local',
    };

    // If connected to remote agent, ensure directory exists on agent
    if (remoteEndpoint && root.path) {
      try {
        await this.createItem(root.path, true, root.id);
      } catch (e) {
        // Ignore if already exists or read-only
      }
    }

    const res = await webFetch(`/api/workspaces${srv}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add workspace');
    }
    return res.json();
  },

  async updateWorkspace(id: string, root: Partial<WorkspaceRoot>): Promise<WorkspaceRoot> {
    const res = await webFetch(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(root),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update workspace');
    }
    return res.json();
  },

  async deleteWorkspace(id: string): Promise<void> {
    const res = await webFetch(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete workspace');
    }
  },

  async reloadWorkspaces(): Promise<{ workspaces: WorkspaceRoot[]; defaultRoot: string }> {
    const res = await webFetch('/api/workspaces/reload', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reload workspaces');
    }
    return res.json();
  },

  async getTree(path: string = '', root: string = ''): Promise<{ root?: string; path: string; items: FileItem[] }> {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (root) params.set('root', root);
    const res = await webFetch(`/api/fs/tree?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to list directory');
    }
    const data = await res.json();
    const rawItems: Array<{
      name: string;
      path: string;
      root?: string;
      fullRelPath?: string;
      isDir?: boolean;
      size?: number;
      modTime?: string;
      createdAt?: string;
      extension?: string;
    }> = data.items || data.nodes || [];
    const items: FileItem[] = rawItems.map((it) => ({
      name: it.name,
      path: it.path,
      root: it.root || root,
      fullRelPath: it.fullRelPath || (root ? `${root}:${it.path}` : it.path),
      isDir: Boolean(it.isDir),
      size: Number(it.size || 0),
      modTime: it.modTime || '',
      createdAt: it.createdAt,
      extension: it.extension || (it.isDir ? '' : it.name.includes('.') ? '.' + it.name.split('.').pop() : ''),
    }));
    return {
      root: data.root || root,
      path: data.path || '',
      items,
    };
  },

  async getFile(path: string, root: string = ''): Promise<{ root?: string; path: string; fullRelPath?: string; name: string; content: string; readOnly?: boolean }> {
    const params = new URLSearchParams({ path });
    if (root) params.set('root', root);
    const res = await webFetch(`/api/fs/file?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to read file');
    }
    const data = await res.json();
    return {
      root: data.root || root,
      path: data.path || path,
      fullRelPath: data.fullRelPath || path,
      name: data.name || (data.path ? data.path.split('/').pop() || '' : path.split('/').pop() || ''),
      content: data.content !== undefined ? data.content : '',
      readOnly: data.readOnly || false,
    };
  },

  async getFileInfo(path: string, root: string = ''): Promise<FileInfo> {
    const params = new URLSearchParams({ path });
    if (root) params.set('root', root);
    const res = await webFetch(`/api/fs/info?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to get file info');
    }
    return res.json();
  },

  async saveFile(path: string, content: string, backup: boolean = true, force: boolean = false, root: string = ''): Promise<void> {
    const res = await webFetch('/api/fs/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: typeof root === 'string' ? root : '',
        path: String(path || ''),
        content: String(content || ''),
        backup: backup !== false,
        force: force === true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 422 && err.guard) {
        throw new PreSaveGuardError(err.error || 'Syntax validation failed for sensitive file', err.guard, err.issues || []);
      }
      throw new Error(err.error || 'Failed to save file');
    }
  },

  async validateGuard(path: string, content: string): Promise<GuardValidationResult> {
    const res = await webFetch('/api/guard/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    if (!res.ok) {
      throw new Error('Failed to validate guard');
    }
    return res.json();
  },

  async createItem(path: string, isDir: boolean, root: string = ''): Promise<void> {
    const res = await webFetch('/api/fs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, path, isDir }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create item');
    }
  },

  async deleteItem(path: string, root: string = ''): Promise<void> {
    const res = await webFetch('/api/fs/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, path }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete item');
    }
  },

  async renameItem(oldPath: string, newPath: string, root: string = ''): Promise<void> {
    const res = await webFetch('/api/fs/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, oldPath, newPath }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to rename item');
    }
  },

  async uploadFile(dirPath: string, file: File, root: string = ''): Promise<string> {
    const formData = new FormData();
    if (root) formData.append('root', root);
    formData.append('path', dirPath);
    formData.append('file', file);
    const res = await webFetch('/api/fs/upload', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload file');
    }
    const data = await res.json();
    return data.path;
  },

  getDownloadUrl(path: string, root: string = ''): string {
    const params = new URLSearchParams({ path });
    if (root) params.set('root', root);
    return `/api/fs/download?${params}`;
  },

  async searchFiles(query: string = '', root: string = ''): Promise<FileItem[]> {
    const params = new URLSearchParams({ q: query });
    if (root) params.set('root', root);
    const res = await webFetch(`/api/fs/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.items || [];
  },

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

  async getAuditLogs(params: {
    limit?: number;
    offset?: number;
    action?: string;
    category?: string;
    source?: string;
    severity?: string;
    search?: string;
  } = {}): Promise<AuditQueryResponse> {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    if (params.action) query.set('action', params.action);
    if (params.category) query.set('category', params.category);
    if (params.source) query.set('source', params.source);
    if (params.severity) query.set('severity', params.severity);
    if (params.search) query.set('search', params.search);

    const res = await webFetch(`/api/audit/logs?${query.toString()}`);
    if (!res.ok) return { events: [], total: 0 };
    return res.json();
  },

  async ingestAuditEvents(events: Partial<AuditEvent>[]): Promise<void> {
    if (!events || events.length === 0) return;
    try {
      await webFetch('/api/audit/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
    } catch {
      // Best-effort ingestion, must not break caller
    }
  },

  async exportAuditLogs(): Promise<Blob> {
    const res = await webFetch('/api/audit/export');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to export audit logs');
    }
    return res.blob();
  },

  getAuditExportUrl(): string {
    return `/api/audit/export?web=1`;
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

  async getCatalog(): Promise<CatalogItem[]> {
    const res = await webFetch('/api/plugins/catalog');
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.catalog || [];
  },

  // Profile Portability APIs
  getProfileExportUrl(): string {
    return `/api/profile/export?web=1`;
  },

  async previewProfile(fileContent: string): Promise<ProfilePreview> {
    const res = await webFetch('/api/profile/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fileContent,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Invalid profile JSON');
    }
    return res.json();
  },

  async importProfile(req: {
    profile: StudioProfile;
    applySettings: boolean;
    importSources: boolean;
    autoInstallPlugins: boolean;
  }): Promise<ProfileImportResult> {
    const res = await webFetch('/api/profile/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to import profile');
    }
    return res.json();
  },

  // Secrets Management APIs
  async getSecretsStatus(): Promise<SecretsStatus> {
    const res = await webFetch('/api/secrets/status');
    if (!res.ok) {
      return {
        backend: 'Unknown',
        isAvailable: false,
        count: 0,
        authEnabled: false,
        privilegedActive: false,
      };
    }
    return res.json();
  },

  async listSecrets(): Promise<SecretMeta[]> {
    const res = await webFetch('/api/secrets');
    if (!res.ok) return [];
    return res.json();
  },

  async listSharedSecrets(): Promise<SecretMeta[]> {
    const res = await webFetch('/api/secrets/shared');
    if (!res.ok) return [];
    return res.json();
  },

  async unlockSecrets(password: string): Promise<{ success: boolean; expiresIn: number }> {
    const res = await webFetch('/api/secrets/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to unlock secrets');
    }
    return res.json();
  },

  async getSecretValue(id: string): Promise<string> {
    const res = await webFetch('/api/secrets/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to retrieve secret value');
    }
    const data = await res.json();
    return data.value || '';
  },

  async saveSecret(item: SecretItem): Promise<void> {
    const res = await webFetch('/api/secrets/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save secret');
    }
  },

  async deleteSecret(id: string): Promise<void> {
    const res = await webFetch(`/api/secrets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete secret');
    }
  },

  // SSH & SFTP Core APIs
  async testSSH(cfg: Partial<SSHHost>): Promise<SSHTestResult> {
    const res = await webFetch('/api/ssh/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'SSH test failed');
    }
    return res.json();
  },

  async generateSSHKey(comment: string = 'config-studio'): Promise<SSHKeyPair> {
    const res = await webFetch('/api/ssh/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to generate SSH key');
    }
    return res.json();
  },

  async sftpList(req: SFTPRequest): Promise<{ path: string; entries: SFTPFileInfo[] }> {
    const res = await webFetch('/api/ssh/sftp/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to list remote directory');
    }
    return res.json();
  },

  async sftpRead(req: SFTPRequest): Promise<{ path: string; content: string; size: number }> {
    const res = await webFetch('/api/ssh/sftp/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to read remote file');
    }
    return res.json();
  },

  async sftpWrite(req: SFTPRequest): Promise<{ success: boolean; path: string; bytesWritten: number }> {
    const res = await webFetch('/api/ssh/sftp/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to write remote file');
    }
    return res.json();
  },

  async sftpMkdir(req: SFTPRequest): Promise<{ success: boolean; path: string }> {
    const res = await webFetch('/api/ssh/sftp/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to create remote directory');
    }
    return res.json();
  },

  async sftpDelete(req: SFTPRequest): Promise<{ success: boolean; path: string }> {
    const res = await webFetch('/api/ssh/sftp/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to delete remote item');
    }
    return res.json();
  },

  async sftpRename(req: SFTPRequest): Promise<{ success: boolean; path: string }> {
    const res = await webFetch('/api/ssh/sftp/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to rename remote item');
    }
    return res.json();
  },
};
