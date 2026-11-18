import { telemetry } from '../telemetry';
import { GuardIssue } from '../../types';

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

export let remoteEndpoint: string | null = localStorage.getItem('cs_active_remote_endpoint');
export let remoteToken: string | null = localStorage.getItem('cs_active_remote_token');

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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('cs:remote-endpoint-changed', { detail: { endpoint, token } })
    );
  }
}

export function getRemoteEndpoint() {
  return { endpoint: remoteEndpoint, token: remoteToken };
}

function shouldRouteToRemote(url: string): boolean {
  if (!remoteEndpoint) return false;
  // Proxy File System operations and SysInfo metrics to the remote agent
  return url.startsWith('/api/fs/') || url.startsWith('/api/sysinfo');
}

export async function webFetch(url: string, options: RequestInit = {}): Promise<Response> {
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

