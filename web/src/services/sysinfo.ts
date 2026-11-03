import { SystemMetrics } from '../types';
import { api, getRemoteEndpoint } from './api';

export interface SysInfoState {
  metrics: SystemMetrics | null;
  loading: boolean;
  error: string | null;
  activeNodeId: string;
  activeNodeName: string;
  lastUpdated: Date | null;
}

export type SysInfoListener = (state: SysInfoState) => void;

class SysInfoService {
  private state: SysInfoState = {
    metrics: null,
    loading: false,
    error: null,
    activeNodeId: 'local',
    activeNodeName: 'Localhost',
    lastUpdated: null,
  };

  private listeners = new Set<SysInfoListener>();
  private timer: any = null;
  private intervalMs = 6000;
  private isDestroyed = false;

  constructor() {
    this.initEventListeners();
    this.startPolling();
  }

  private initEventListeners() {
    // Detect active node changes from server/agent switchers
    const handleSwitch = (e: any) => {
      const detail = e.detail || {};
      const id = detail.id || (detail.isLocal ? 'local' : 'remote');
      const name = detail.name || (id === 'local' ? 'Localhost' : id);
      this.setActiveNode(id, name);
    };

    window.addEventListener('cs:server-switched', handleSwitch);
    window.addEventListener('cs:agent-switched', handleSwitch);
    window.addEventListener('cs:remote-endpoint-changed', (e: any) => {
      const endpoint = e.detail?.endpoint;
      if (endpoint) {
        let friendly = endpoint;
        try {
          const u = new URL(endpoint.startsWith('http') ? endpoint : `http://${endpoint}`);
          friendly = u.hostname;
        } catch (_) {}
        this.setActiveNode(endpoint, friendly);
      } else {
        this.setActiveNode('local', 'Localhost');
      }
    });

    // Visibility change: pause when hidden to conserve network and CPU
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stopPolling();
        } else {
          this.refresh();
          this.startPolling();
        }
      });
    }
  }

  public getState(): SysInfoState {
    return { ...this.state };
  }

  public subscribe(listener: SysInfoListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const s = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(s);
      } catch (err) {
        console.error('[SysInfo] Listener error:', err);
      }
    });
  }

  public setActiveNode(nodeId: string, nodeName: string) {
    if (this.state.activeNodeId === nodeId && this.state.activeNodeName === nodeName) {
      return;
    }
    this.state.activeNodeId = nodeId;
    this.state.activeNodeName = nodeName;
    this.state.error = null;
    this.notify();
    this.refresh();
  }

  public async refresh(): Promise<SystemMetrics | null> {
    if (this.isDestroyed) return null;

    this.state.loading = true;
    this.notify();

    try {
      const target = this.state.activeNodeId;
      const remote = getRemoteEndpoint();
      let queryServer: string | undefined = undefined;

      if (target && target !== 'local' && target !== 'localhost') {
        queryServer = target;
      } else if (remote.endpoint) {
        // If api.ts already has an active remote endpoint selected in LocalStorage
        queryServer = remote.endpoint;
      }

      const metrics = await api.getSysInfo(queryServer);
      this.state.metrics = metrics;
      this.state.error = null;
      this.state.lastUpdated = new Date();
      return metrics;
    } catch (err: any) {
      this.state.error = err.message || 'Failed to poll telemetry';
      return null;
    } finally {
      this.state.loading = false;
      this.notify();
    }
  }

  public startPolling(intervalMs = this.intervalMs) {
    this.intervalMs = intervalMs;
    this.stopPolling();
    this.timer = setInterval(() => {
      this.refresh();
    }, this.intervalMs);
  }

  public stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Format Helpers
  public static formatBytes(bytes: number, decimals = 1): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
    return `${val} ${sizes[i]}`;
  }

  public static formatUptime(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  public static getLoadStatus(percent: number): 'normal' | 'warning' | 'critical' {
    if (percent >= 85) return 'critical';
    if (percent >= 70) return 'warning';
    return 'normal';
  }
}

export const formatBytes = SysInfoService.formatBytes;
export const formatUptime = SysInfoService.formatUptime;
export const getLoadStatus = SysInfoService.getLoadStatus;
export const sysinfoService = new SysInfoService();
