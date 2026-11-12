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

  try {
    const host = getDebugHost();
    const res = await fetch(`http://${host}:9998/health`, {
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
  try {
    const payload = JSON.stringify(evt);
    const host = getDebugHost();
    const url = `http://${host}:9998/events`;

    // Use direct fetch with keepalive and cors mode for reliable real-time transmission
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      mode: 'cors',
    }).catch(() => {
      // Non-blocking: Silently ignore if debug server is not listening
    });
  } catch {
    // Non-blocking
  }
}
