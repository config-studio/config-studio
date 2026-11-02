import { SSHHost } from '../types';

const HOSTS_STORAGE_KEY = 'cs_ssh_hosts_v1';
const LAST_HOST_KEY = 'cs_ssh_last_host_id';
const LAST_PATH_KEY_PREFIX = 'cs_sftp_last_path_';

type HostChangeListener = (hosts: SSHHost[]) => void;

class SSHHostService {
  private listeners: Set<HostChangeListener> = new Set();
  private cachedHosts: SSHHost[] | null = null;

  public list(): SSHHost[] {
    if (this.cachedHosts !== null) {
      return this.cachedHosts;
    }
    try {
      const data = localStorage.getItem(HOSTS_STORAGE_KEY);
      this.cachedHosts = data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[SSHHostService] Failed to read hosts:', e);
      this.cachedHosts = [];
    }
    return this.cachedHosts || [];
  }

  public get(id: string): SSHHost | undefined {
    return this.list().find((h) => h.id === id);
  }

  public save(host: SSHHost): void {
    const hosts = [...this.list()];
    const index = hosts.findIndex((h) => h.id === host.id);
    if (index >= 0) {
      hosts[index] = { ...hosts[index], ...host };
    } else {
      if (!host.id) {
        host.id = 'host-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }
      if (!host.createdAt) {
        host.createdAt = new Date().toISOString();
      }
      hosts.push(host);
    }
    this.persist(hosts);
  }

  public delete(id: string): void {
    const hosts = this.list().filter((h) => h.id !== id);
    this.persist(hosts);
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

  public reload(): SSHHost[] {
    this.cachedHosts = null;
    const hosts = this.list();
    this.listeners.forEach((l) => {
      try {
        l(hosts);
      } catch (err) {
        console.error('[SSHHostService] Listener error:', err);
      }
    });
    return hosts;
  }

  private persist(hosts: SSHHost[]): void {
    this.cachedHosts = hosts;
    try {
      localStorage.setItem(HOSTS_STORAGE_KEY, JSON.stringify(hosts));
    } catch (e) {
      console.error('[SSHHostService] Failed to save hosts:', e);
    }
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
