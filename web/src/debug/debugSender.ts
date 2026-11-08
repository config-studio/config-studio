import { DebugEvent } from './types';

const DEBUG_SERVER_URL = 'http://localhost:9998/events';
let isServerOnline = false;
let lastCheckTime = 0;

export async function checkDebugServerHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastCheckTime < 3000) return isServerOnline;
  lastCheckTime = now;

  try {
    const res = await fetch('http://localhost:9998/health', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    isServerOnline = res.ok;
  } catch {
    isServerOnline = false;
  }
  return isServerOnline;
}

export function sendDebugEvent(evt: DebugEvent) {
  // Try sending via fetch with keepalive for instant zero-latency delivery
  try {
    const payload = JSON.stringify(evt);
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      const ok = navigator.sendBeacon(DEBUG_SERVER_URL, blob);
      if (ok) return;
    }

    fetch(DEBUG_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      mode: 'cors',
    }).catch(() => {
      // Silently ignore network failures if debug server is not listening
    });
  } catch {
    // Non-blocking
  }
}
