import { AuditCategory, AuditEvent, AuditSeverity } from '../types';
import { api } from './api';

const MAX_RING_BUFFER = 50;
const FLUSH_INTERVAL_MS = 5000;

interface TelemetryOptions {
  category?: AuditCategory;
  source?: 'user' | 'backend' | 'frontend' | 'plugin';
  sourceId?: string;
  action: string;
  severity?: AuditSeverity;
  target?: string;
  details?: Record<string, any>;
}

class TelemetryService {
  private ringBuffer: AuditEvent[] = [];
  private pendingQueue: Partial<AuditEvent>[] = [];
  private flushTimer: any = null;
  private initialized = false;

  public init() {
    if (this.initialized) return;
    this.initialized = true;

    // Listen for global unhandled runtime errors
    window.addEventListener('error', (event: ErrorEvent) => {
      this.captureError(event.error || new Error(event.message), {
        source: 'window.onerror',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    // Listen for unhandled promise rejections
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const err = reason instanceof Error ? reason : new Error(String(reason || 'Unhandled Promise Rejection'));
      this.captureError(err, {
        source: 'unhandledrejection',
      });
    });

    // Flush on page unload
    window.addEventListener('beforeunload', () => {
      this.flushSync();
    });

    // Periodic flush timer
    this.flushTimer = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);

    // Initial system heartbeat
    this.record({
      category: 'system',
      source: 'frontend',
      action: 'system.start',
      severity: 'info',
      target: 'ui',
      details: {
        userAgent: navigator.userAgent,
        url: window.location.href,
        time: new Date().toISOString(),
      },
    });
  }

  public record(opts: TelemetryOptions) {
    const evt: AuditEvent = {
      id: 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      user: 'client',
      ip: '127.0.0.1',
      category: opts.category || 'system',
      source: opts.source || 'frontend',
      sourceId: opts.sourceId,
      action: opts.action,
      severity: opts.severity || 'info',
      target: opts.target || 'frontend',
      details: this.sanitize(opts.details || {}),
    };

    // Keep in ring buffer
    this.ringBuffer.push(evt);
    if (this.ringBuffer.length > MAX_RING_BUFFER) {
      this.ringBuffer.shift();
    }

    // Add to pending queue for backend ingestion
    this.pendingQueue.push(evt);

    // If critical/error, flush immediately
    if (opts.severity === 'error' || opts.severity === 'critical') {
      this.flush();
    }
  }

  public captureError(err: unknown, context?: Record<string, any>) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    const stack = errorObj.stack || '';
    const message = errorObj.message || 'Unknown error';

    // Ignore benign browser security wrappers or extension noise (e.g. Firefox Xray wrapper, ResizeObserver)
    if (
      message.includes('Permission denied to access property') ||
      message.includes('ResizeObserver loop') ||
      message.includes('Extension context invalidated') ||
      message === 'Script error.'
    ) {
      return;
    }

    this.record({
      category: 'error',
      source: 'frontend',
      action: 'ui.error',
      severity: 'error',
      target: context?.source || 'UI',
      details: {
        message,
        stack: stack.slice(0, 1500),
        ...context,
      },
    });
  }

  public captureNetworkError(url: string, status: number, statusText: string, details?: Record<string, any>) {
    this.record({
      category: 'network',
      source: 'frontend',
      action: 'net.error',
      severity: 'error',
      target: url,
      details: {
        status,
        statusText,
        ...details,
      },
    });
  }

  public getRecentEvents(): AuditEvent[] {
    return [...this.ringBuffer];
  }

  public async flush() {
    if (this.pendingQueue.length === 0) return;
    const batch = [...this.pendingQueue];
    this.pendingQueue = [];

    try {
      await api.ingestAuditEvents(batch);
    } catch {
      // Re-queue items that failed (up to buffer limit)
      this.pendingQueue = [...batch.slice(-20), ...this.pendingQueue];
    }
  }

  private flushSync() {
    if (this.pendingQueue.length === 0) return;
    const payload = JSON.stringify({ events: this.pendingQueue });
    this.pendingQueue = [];
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/audit/ingest', new Blob([payload], { type: 'application/json' }));
      }
    } catch {
      // ignore
    }
  }

  private sanitize(obj: Record<string, any>): Record<string, any> {
    if (!obj || typeof obj !== 'object') return obj;
    const sensitiveKeys = ['password', 'token', 'secret', 'auth', 'key', 'apikey', 'credential', 'cookie'];
    const sanitized: Record<string, any> = {};

    for (const [key, val] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (sensitiveKeys.some((s) => lower.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        sanitized[key] = this.sanitize(val);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  public generateDiagnosticMarkdown(opts?: {
    error?: Error | null;
    componentStack?: string | null;
    customNote?: string;
  }): string {
    const now = new Date().toISOString();
    const recent = this.ringBuffer.slice(-20);

    let md = `### Config Studio Diagnostic Report\n`;
    md += `- **Generated:** ${now}\n`;
    md += `- **URL:** \`${window.location.href}\`\n`;
    md += `- **Platform:** \`${navigator.platform || 'Unknown'}\`\n`;
    md += `- **User Agent:** \`${navigator.userAgent}\`\n\n`;

    if (opts?.customNote) {
      md += `#### User Note\n${opts.customNote}\n\n`;
    }

    if (opts?.error) {
      md += `#### Error Details\n`;
      md += `\`\`\`\n${opts.error.name || 'Error'}: ${opts.error.message || ''}\n`;
      if (opts.error.stack) {
        md += `\nStack trace:\n${opts.error.stack}\n`;
      }
      md += `\`\`\`\n\n`;
    }

    if (opts?.componentStack) {
      md += `#### React Component Hierarchy\n`;
      md += `\`\`\`\n${opts.componentStack.trim()}\n\`\`\`\n\n`;
    }

    md += `#### ⏱ Recent Telemetry & Audit Stream (Last ${recent.length} events)\n`;
    if (recent.length === 0) {
      md += `_No recent events in buffer_\n\n`;
    } else {
      md += `| Time (UTC) | Category | Action | Target | Details |\n`;
      md += `|---|---|---|---|---|\n`;
      recent.forEach((e) => {
        const time = e.timestamp ? e.timestamp.split('T')[1].replace('Z', '') : '';
        const cat = e.category || 'user';
        const act = e.action || '-';
        const target = (e.target || '-').replace(/\|/g, '\\|');
        const detailsStr = e.details ? JSON.stringify(e.details).replace(/\|/g, '\\|') : '';
        const trimmedDetails = detailsStr.length > 80 ? detailsStr.slice(0, 77) + '...' : detailsStr;
        md += `| \`${time}\` | \`${cat}\` | \`${act}\` | \`${target}\` | ${trimmedDetails} |\n`;
      });
      md += `\n`;
    }

    md += `> [!NOTE]\n> Sensitive credentials and authorization tokens have been automatically redacted.\n`;
    return md;
  }

  public generateCrashReportJSON(opts?: {
    error?: Error | null;
    componentStack?: string | null;
  }): string {
    const report = {
      app: 'Config Studio',
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        url: window.location.href,
      },
      error: opts?.error
        ? {
            name: opts.error.name,
            message: opts.error.message,
            stack: opts.error.stack,
          }
        : null,
      componentStack: opts?.componentStack || null,
      recentEvents: this.ringBuffer,
    };
    return JSON.stringify(report, null, 2);
  }

  public downloadCrashReport(opts?: {
    error?: Error | null;
    componentStack?: string | null;
  }) {
    const jsonStr = this.generateCrashReportJSON(opts);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `config-studio-crash-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public async copyDiagnosticReport(opts?: {
    error?: Error | null;
    componentStack?: string | null;
    customNote?: string;
  }): Promise<boolean> {
    const md = this.generateDiagnosticMarkdown(opts);
    try {
      await navigator.clipboard.writeText(md);
      return true;
    } catch {
      // Fallback for older environments
      try {
        const textarea = document.createElement('textarea');
        textarea.value = md;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch {
        return false;
      }
    }
  }
}

export const telemetry = new TelemetryService();
