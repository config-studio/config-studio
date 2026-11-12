import { SSHHost } from '../types';

const HOSTS_STORAGE_KEY = 'cs_ssh_hosts_v1';
const LAST_HOST_KEY = 'cs_ssh_last_host_id';
const LAST_PATH_KEY_PREFIX = 'cs_sftp_last_path_';

type HostChangeListener = (hosts: SSHHost[]) => void;

class SSHHostService {
  private listeners: Set<HostChangeListener> = new Set();
  private cachedHosts: SSHHost[] | null = null;
  private isFetching = false;
  private hasInitialized = false;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (this.hasInitialized) return;
    this.hasInitialized = true;

    // 1. Initial background fetch from backend Core Host Storage
    await this.fetchFromServer();

    // 2. One-time client migration: if old localStorage hosts exist, push to core backend
    try {
      const localData = localStorage.getItem(HOSTS_STORAGE_KEY);
      if (localData) {
        const localList: SSHHost[] = JSON.parse(localData);
        if (Array.isArray(localList) && localList.length > 0) {
          for (const h of localList) {
            if (h && (h.host || (h as any).address)) {
              await this.save(h);
            }
          }
        }
        localStorage.removeItem(HOSTS_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[SSHHostService] Local migration check error:', e);
    }
  }

  public async fetchFromServer(): Promise<SSHHost[]> {
    if (this.isFetching) return this.cachedHosts || [];
    this.isFetching = true;
    try {
      const res = await fetch('/api/hosts', {
        headers: { 'X-ConfigStudio-Web': '1' },
      });
      if (res.ok) {
        const data: SSHHost[] = await res.json();
        this.cachedHosts = Array.isArray(data) ? data : [];
        this.notify();
      }
    } catch (err) {
      console.error('[SSHHostService] Failed to fetch hosts from server:', err);
    } finally {
      this.isFetching = false;
    }
    return this.cachedHosts || [];
  }

  public list(): SSHHost[] {
    if (this.cachedHosts === null) {
      this.cachedHosts = [];
      this.fetchFromServer();
    }
    return this.cachedHosts || [];
  }

  public get(id: string): SSHHost | undefined {
    return this.list().find((h) => h.id === id);
  }

  public async save(host: SSHHost): Promise<void> {
    if (!host.id) {
      host.id = 'host-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    if (!host.createdAt) {
      host.createdAt = new Date().toISOString();
    }

    // Optimistic local update
    const current = [...this.list()];
    const index = current.findIndex((h) => h.id === host.id);
    if (index >= 0) {
      current[index] = { ...current[index], ...host };
    } else {
      current.push(host);
    }
    this.cachedHosts = current;
    this.notify();

    // Persist to Core Host Storage
    try {
      const res = await fetch('/api/hosts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ConfigStudio-Web': '1',
        },
        body: JSON.stringify(host),
      });
      if (res.ok) {
        const saved: SSHHost = await res.json();
        const updated = [...this.list()];
        const idx = updated.findIndex((h) => h.id === saved.id);
        if (idx >= 0) {
          updated[idx] = saved;
        } else {
          updated.push(saved);
        }
        this.cachedHosts = updated;
        this.notify();
      }
    } catch (e) {
      console.error('[SSHHostService] Server save failed:', e);
    }
  }

  public async delete(id: string): Promise<void> {
    // Optimistic delete
    this.cachedHosts = this.list().filter((h) => h.id !== id);
    this.notify();

    try {
      await fetch(`/api/hosts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-ConfigStudio-Web': '1' },
      });
    } catch (e) {
      console.error('[SSHHostService] Server delete failed:', e);
    }
  }

  public getLastActiveHostId(): string | null {
    return localStorage.getItem(LAST_HOST_KEY);
  }

  public setLastActiveHostId(id: string): void {
    localStorage.setItem(LAST_HOST_KEY, id);
  }

  public getLastSftpPath(hostId: string): string {
    return localStorage.getItem(LAST_PATH_KEY_PREFIX + hostId) || '/';
  }

  public setLastSftpPath(hostId: string, path: string): void {
    localStorage.setItem(LAST_PATH_KEY_PREFIX + hostId, path);
  }

  public subscribe(listener: HostChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async reload(): Promise<SSHHost[]> {
    return this.fetchFromServer();
  }

  // OpenSSH Interoperability APIs
  public async exportOpenSSH(): Promise<string> {
    const res = await fetch('/api/hosts/export/openssh', {
      headers: { 'X-ConfigStudio-Web': '1' },
    });
    if (!res.ok) throw new Error('Failed to export OpenSSH configuration');
    return res.text();
  }

  public async importOpenSSH(content: string): Promise<any> {
    const res = await fetch('/api/hosts/import/openssh', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-ConfigStudio-Web': '1',
      },
      body: content,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Import failed' }));
      throw new Error(err.error || 'Failed to import OpenSSH configuration');
    }
    const result = await res.json();
    await this.fetchFromServer();
    return result;
  }

  // Portable Secrets Vault & Full Fleet Backup APIs
  public async exportPortableSecrets(passphrase: string): Promise<Blob> {
    const res = await fetch('/api/secrets/export-portable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ConfigStudio-Web': '1',
      },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(err.error || 'Failed to export secrets backup');
    }
    return res.blob();
  }

  public async importPortableSecrets(file: Blob, passphrase: string): Promise<any> {
    const res = await fetch('/api/secrets/import-portable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Passphrase': passphrase,
        'X-ConfigStudio-Web': '1',
      },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Import failed' }));
      throw new Error(err.error || 'Failed to import secrets backup');
    }
    return res.json();
  }

  private notify(): void {
    const hosts = this.cachedHosts || [];
    this.listeners.forEach((l) => {
      try {
        l(hosts);
      } catch (err) {
        console.error('[SSHHostService] Listener error:', err);
      }
    });
  }
}

export const sshHostService = new SSHHostService();
