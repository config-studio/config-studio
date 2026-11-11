import { DebugEvent } from './types';
import { sendDebugEvent } from './debugSender';

let isInitialized = false;
let currentCorrId = '';
let corrTimer: any = null;
let eventCounter = 0;

function getOrGenerateCorrId(): string {
  if (currentCorrId) return currentCorrId;
  currentCorrId = 'corr_' + Math.random().toString(36).substring(2, 8);
  if (corrTimer) clearTimeout(corrTimer);
  corrTimer = setTimeout(() => {
    currentCorrId = '';
  }, 3000);
  return currentCorrId;
}

function startNewActionCorrId(): string {
  if (corrTimer) clearTimeout(corrTimer);
  currentCorrId = 'corr_' + Math.random().toString(36).substring(2, 8);
  corrTimer = setTimeout(() => {
    currentCorrId = '';
  }, 3000);
  return currentCorrId;
}

export function recordDebugEvent(
  kind: DebugEvent['kind'],
  category: DebugEvent['category'],
  label: string,
  target?: string,
  details?: Record<string, any>,
  durationMs?: number,
  explicitCorrId?: string
) {
  eventCounter++;
  const corrId = explicitCorrId || getOrGenerateCorrId();
  const evt: DebugEvent = {
    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    corrId,
    ts: new Date().toISOString(),
    kind,
    category,
    label,
    target,
    details: sanitizeDetails(details || {}),
    durationMs,
  };

  sendDebugEvent(evt);
  updateBadgeCounter(eventCounter);
}

export function initDebugRecorder() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  console.log('%c[DebugRecorder] 🔴 Real-Time Two-Way Telemetry Active', 'background: #0284c7; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;');

  // 1. Setup Live Badge in DOM
  setupDebugBadge();

  // 2. Immediate Startup Telemetry Event
  recordDebugEvent(
    'USER_ACTION',
    'system',
    'APP_STARTUP: Config Studio Session Started',
    'window',
    {
      url: window.location.href,
      locale: navigator.language,
      screen: `${window.innerWidth}x${window.innerHeight}`,
      time: new Date().toISOString(),
    }
  );

  // 2. Intercept DOM User Clicks
  window.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Don't log clicks on our own debug badge
      if (target.closest('#cs-live-debug-badge')) return;

      const corrId = startNewActionCorrId();

      const el = target.closest('button, a, input, select, [data-file], [data-mw], [data-filter], tr, .cs-traefik-jump-btn, .cs-traefik-mw-badge') || target;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const className = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45);

      const dataAttrs: Record<string, string> = {};
      Array.from(el.attributes || []).forEach((attr) => {
        if (attr.name.startsWith('data-')) {
          dataAttrs[attr.name] = attr.value;
        }
      });

      const modalAncestor = target.closest('.cs-traefik-modal, .cs-fleet-modal-content, [role="dialog"]');
      const modalName = modalAncestor ? (modalAncestor.querySelector('h2, .cs-traefik-title, .cs-fleet-modal-title')?.textContent?.trim() || 'Modal') : undefined;

      recordDebugEvent(
        'USER_ACTION',
        'ui',
        `CLICK: ${tag}${id}${className} ${text ? `("${text}")` : ''}`,
        `${tag}${id}`,
        {
          selector: `${tag}${id}${className}`,
          text,
          dataAttrs: Object.keys(dataAttrs).length > 0 ? dataAttrs : undefined,
          modal: modalName,
        },
        undefined,
        corrId
      );
    },
    true
  );

  // 3. Intercept Hotkeys
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.startsWith('F') || e.key === 'Escape' || e.key === 'Enter') {
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        if (e.shiftKey) parts.push('Shift');
        parts.push(e.key);

        const hotkey = parts.join('+');
        const corrId = startNewActionCorrId();

        recordDebugEvent(
          'USER_ACTION',
          'ui',
          `HOTKEY: ${hotkey}`,
          e.key,
          {
            key: e.key,
            code: e.code,
            hotkey,
          },
          undefined,
          corrId
        );
      }
    },
    true
  );

  // 4. Intercept window.fetch (Two-Way Network Telemetry)
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);

    // Skip our own debug server endpoint to prevent infinite loop
    if (url.includes(':9998/')) {
      return originalFetch.apply(this, args);
    }

    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const corrId = getOrGenerateCorrId();
    const startTime = Date.now();

    // Log API_REQ
    recordDebugEvent(
      'API_REQ',
      'network',
      `REQ: ${method} ${url}`,
      url,
      {
        method,
        url,
        bodySnippet: extractBodySnippet(init.body),
      },
      undefined,
      corrId
    );

    try {
      const response = await originalFetch.apply(this, args);
      const durationMs = Date.now() - startTime;

      // Clone response to inspect body without consuming the stream
      let bodySummary = '';
      try {
        const clone = response.clone();
        const text = await clone.text();
        bodySummary = text.slice(0, 300);
      } catch (_) {}

      recordDebugEvent(
        'API_RES',
        'network',
        `RES: ${response.status} ${response.statusText} (${durationMs}ms) <- ${method} ${url}`,
        url,
        {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          durationMs,
          bodySnippet: sanitizeString(bodySummary),
        },
        durationMs,
        corrId
      );

      return response;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      recordDebugEvent(
        'API_RES',
        'network',
        `NET_FAIL (${durationMs}ms): ${err.message} <- ${method} ${url}`,
        url,
        {
          error: err.message,
          durationMs,
        },
        durationMs,
        corrId
      );
      throw err;
    }
  };

  // 5. Intercept DOM Mutation for Modals & Toasts
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      // Check added nodes (Modal Opened / Toast Shown)
      m.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (node.classList?.contains('cs-traefik-overlay') || node.classList?.contains('cs-fleet-modal-overlay') || node.id?.includes('overlay')) {
            const title = node.querySelector('h2, .cs-traefik-title, .cs-fleet-modal-title')?.textContent?.trim() || 'Dialog';
            recordDebugEvent('UI_MODAL', 'ui', `MODAL_OPEN: "${title}"`, node.id || node.className);
          }
          if (node.classList?.contains('cs-toast') || node.getAttribute('role') === 'alert') {
            const msg = node.textContent?.trim().slice(0, 60) || '';
            recordDebugEvent('UI_TOAST', 'ui', `TOAST_SHOWN: "${msg}"`, 'toast', { text: msg });
          }
        }
      });

      // Check removed nodes (Modal Closed)
      m.removedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (node.classList?.contains('cs-traefik-overlay') || node.classList?.contains('cs-fleet-modal-overlay') || node.id?.includes('overlay')) {
            recordDebugEvent('UI_MODAL', 'ui', `MODAL_CLOSE`, node.id || node.className);
          }
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 6. Hook ConfigStudio API once available
  hookConfigStudioGlobal();

  // 7. Global Runtime Errors
  window.addEventListener('error', (e) => {
    recordDebugEvent('RUNTIME_ERROR', 'system', `ERROR: ${e.message}`, e.filename, {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack?.slice(0, 800),
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    recordDebugEvent('RUNTIME_ERROR', 'system', `PROMISE_REJECT: ${reason}`, 'promise', {
      reason,
      stack: e.reason instanceof Error ? e.reason.stack?.slice(0, 800) : undefined,
    });
  });
}

function hookConfigStudioGlobal() {
  const tryHook = () => {
    const cs = (window as any).ConfigStudio;
    if (!cs || cs.__debugHooked) return false;

    cs.__debugHooked = true;

    // Wrap openFile
    const origOpenFile = cs.openFile;
    if (origOpenFile) {
      cs.openFile = async function (path: string, options?: any) {
        const corrId = getOrGenerateCorrId();
        recordDebugEvent(
          'PLUGIN_CALL',
          'plugin',
          `CALL: cs.openFile("${path}", ${JSON.stringify(options || {})})`,
          path,
          { path, options },
          undefined,
          corrId
        );
        try {
          const res = await origOpenFile.apply(this, arguments);
          recordDebugEvent(
            'MONACO_NAV',
            'editor',
            `NAV_SUCCESS: Opened "${path}" at line ${options?.line || 1}`,
            path,
            { path, options },
            undefined,
            corrId
          );
          return res;
        } catch (err: any) {
          recordDebugEvent(
            'RUNTIME_ERROR',
            'editor',
            `NAV_ERROR: Failed to open "${path}": ${err.message}`,
            path,
            { error: err.message },
            undefined,
            corrId
          );
          throw err;
        }
      };
    }

    // Wrap createFile
    const origCreateFile = cs.createFile;
    if (origCreateFile) {
      cs.createFile = async function (path: string, content?: string) {
        const corrId = getOrGenerateCorrId();
        recordDebugEvent(
          'PLUGIN_CALL',
          'plugin',
          `CALL: cs.createFile("${path}", ${content ? `${content.length} chars` : 'empty'})`,
          path,
          { path, contentLength: content?.length },
          undefined,
          corrId
        );
        return origCreateFile.apply(this, arguments);
      };
    }

    // Wrap showNotification
    const origShowNotification = cs.showNotification;
    if (origShowNotification) {
      cs.showNotification = function (msg: string, type?: string) {
        recordDebugEvent('UI_TOAST', 'ui', `NOTIFICATION [${type || 'info'}]: "${msg}"`, 'notification', {
          msg,
          type,
        });
        return origShowNotification.apply(this, arguments);
      };
    }

    return true;
  };

  if (!tryHook()) {
    const interval = setInterval(() => {
      if (tryHook()) clearInterval(interval);
    }, 200);
    setTimeout(() => clearInterval(interval), 15000);
  }
}

function setupDebugBadge() {
  if (document.getElementById('cs-live-debug-badge')) return;
  const badge = document.createElement('div');
  badge.id = 'cs-live-debug-badge';
  badge.style.cssText = `
    position: fixed;
    bottom: 34px;
    right: 14px;
    z-index: 99999;
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid rgba(239, 68, 68, 0.5);
    border-radius: 20px;
    padding: 3px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: #fca5a5;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    cursor: default;
    user-select: none;
  `;

  badge.innerHTML = `
    <span class="cs-debug-pulse-dot" style="width: 7px; height: 7px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 6px #ef4444; animation: csPulse 1.5s infinite;"></span>
    <span class="cs-debug-status-text">DEBUG LIVE (:9998)</span>
    <span id="cs-live-debug-count" style="background: rgba(239, 68, 68, 0.2); padding: 1px 5px; border-radius: 10px; font-size: 10px; color: #fecaca;">0</span>
  `;

  // Inject keyframe animation
  if (!document.getElementById('cs-debug-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'cs-debug-pulse-style';
    style.textContent = `
      @keyframes csPulse {
        0% { opacity: 0.4; transform: scale(0.9); }
        50% { opacity: 1; transform: scale(1.1); }
        100% { opacity: 0.4; transform: scale(0.9); }
      }
    `;
    document.head.appendChild(style);
  }
  document.body.appendChild(badge);
}

function updateBadgeCounter(count: number) {
  const counterEl = document.getElementById('cs-live-debug-count');
  if (counterEl) {
    counterEl.textContent = String(count);
  }
}

function extractBodySnippet(body: any): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return sanitizeString(body.slice(0, 200));
  if (body instanceof FormData) return '[FormData]';
  return undefined;
}

function sanitizeString(str: string): string {
  if (!str) return '';
  return str.replace(/("?(password|token|secret|key|cookie)"?\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"');
}

function sanitizeDetails(details: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(details)) {
    if (typeof v === 'string') {
      out[k] = sanitizeString(v);
    } else if (v && typeof v === 'object') {
      out[k] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}
