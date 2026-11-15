import { DebugEvent } from './types';

function getDebugHost(): string {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return window.location.hostname;
  }
  return 'localhost';
}

let isServerOnline = false;
let lastCheckTime = 0;

export async function checkDebugServerHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastCheckTime < 3000) return isServerOnline;
  lastCheckTime = now;

  // 1. Check via Core reverse proxy
  try {
    const res = await fetch('/api/debug/health', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      isServerOnline = true;
      return true;
    }
  } catch (_) {}

  // 2. Fallback to direct port 9998
  try {
    const host = getDebugHost();
    const res = await fetch(`http://${host}:9998/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    isServerOnline = res.ok;
  } catch (_) {
    isServerOnline = false;
  }
  return isServerOnline;
}

export function sendDebugEvent(evt: DebugEvent) {
  try {
    const payload = JSON.stringify(evt);

    // 1. Send via core proxy (/api/debug/events) — same origin, zero CORS/firewall issues
    fetch('/api/debug/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => {
      // 2. Fallback to direct port 9998
      const host = getDebugHost();
      const url = `http://${host}:9998/events`;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {
        // Silently ignore if debug server is offline
      });
    });
  } catch (_) {
    // Non-blocking
  }
}
