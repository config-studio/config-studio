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
  try {
    const payload = JSON.stringify(evt);

    // Use direct fetch with keepalive and cors mode for reliable real-time transmission
    fetch(DEBUG_SERVER_URL, {
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
