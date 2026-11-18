import {
  SSHHost,
  SSHTestResult,
  SSHKeyPair,
  SFTPRequest,
  SFTPFileInfo,
} from '../../types';
import { webFetch, PreSaveGuardError, remoteEndpoint } from './client';

export const fleetApi = {
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

  async sftpBatchRead(req: {
    host: string;
    port?: number;
    user?: string;
    authType?: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    identityId?: string;
    jumpHost?: any;
    paths?: string[];
    patterns?: string[];
    pattern?: string;
    baseDir?: string;
    maxFiles?: number;
    maxSizeBytes?: number;
  }): Promise<{
    files: Record<string, string>;
    errors?: Record<string, string>;
    count: number;
    truncated: boolean;
  }> {
    const res = await webFetch('/api/ssh/sftp/batch-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to batch read remote files via SFTP');
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

  // System Update APIs (CORE-001)
};
