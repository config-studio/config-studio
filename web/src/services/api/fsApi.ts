import {
  WorkspaceRoot,
  FileItem,
  FileInfo,
  GuardIssue,
  GuardValidationResult,
} from '../../types';
import { webFetch, PreSaveGuardError, remoteEndpoint } from './client';

export const fsApi = {
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
        await fsApi.createItem(root.path, true, root.id);
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
    if (root && root !== 'default') params.set('root', root);
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
    if (root && root !== 'default') params.set('root', root);
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
    if (root && root !== 'default') params.set('root', root);
    const res = await webFetch(`/api/fs/info?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to get file info');
    }
    return res.json();
  },

  async batchReadFiles(req: {
    root?: string;
    paths?: string[];
    patterns?: string[];
    pattern?: string;
    maxFiles?: number;
    maxSizeBytes?: number;
  }): Promise<{
    root: string;
    files: Record<string, string>;
    errors?: Record<string, string>;
    count: number;
    truncated: boolean;
  }> {
    const res = await webFetch('/api/fs/batch-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to batch read files');
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
    if (root && root !== 'default') params.set('root', root);
    return `/api/fs/download?${params}`;
  },

  async searchFiles(query: string = '', root: string = ''): Promise<FileItem[]> {
    const params = new URLSearchParams({ q: query });
    if (root && root !== 'default') params.set('root', root);
    const res = await webFetch(`/api/fs/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.items || [];
  },

};
