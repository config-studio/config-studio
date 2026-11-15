import { LogEntryItem } from '../components/ui/LogViewer';

export interface LogStreamSession {
  id: string;
  title: string;
  source: string;
  cmd: string;
  hostId?: string;
  sudo?: boolean;
  tail?: number;
  status: 'connecting' | 'connected' | 'paused' | 'error' | 'closed';
  errorMessage?: string;
  entries: LogEntryItem[];
  eventSource?: EventSource;
}

export interface OpenLogStreamOptions {
  id?: string;
  title?: string;
  source?: string;
  cmd: string;
  hostId?: string;
  sudo?: boolean;
  tail?: number;
}

type LogStreamListener = (sessions: LogStreamSession[], activeId: string) => void;

const MAX_BUFFER_LINES = 2000;

class LogStreamService {
  private sessions: LogStreamSession[] = [];
  private activeSessionId: string = 'launcher';
  private listeners: Set<LogStreamListener> = new Set();

  public getSessions(): LogStreamSession[] {
    return this.sessions;
  }

  public getActiveSessionId(): string {
    return this.activeSessionId;
  }

  public setActiveSessionId(id: string): void {
    this.activeSessionId = id;
    this.notify();
  }

  public subscribe(fn: LogStreamListener): () => void {
    this.listeners.add(fn);
    fn(this.sessions, this.activeSessionId);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener([...this.sessions], this.activeSessionId);
    }
  }

  public openStream(opts: OpenLogStreamOptions): string {
    const id = opts.id || 'log-stream-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

    // If session already exists, activate and reconnect if needed
    const existingIndex = this.sessions.findIndex((s) => s.id === id);
    if (existingIndex >= 0) {
      this.activeSessionId = id;
      const sess = this.sessions[existingIndex];
      if (sess.status === 'closed' || sess.status === 'error') {
        this.reconnect(id);
      } else {
        this.notify();
      }
      return id;
    }

    const title = opts.title || opts.source || opts.cmd.slice(0, 24);
    const source = opts.source || 'app';

    const newSession: LogStreamSession = {
      id,
      title,
      source,
      cmd: opts.cmd,
      hostId: opts.hostId,
      sudo: opts.sudo,
      tail: opts.tail,
      status: 'connecting',
      entries: [],
    };

    this.sessions.push(newSession);
    this.activeSessionId = id;
    this.connectEventSource(newSession);
    this.notify();

    return id;
  }

  private connectEventSource(session: LogStreamSession): void {
    if (session.eventSource) {
      session.eventSource.close();
      session.eventSource = undefined;
    }

    const params = new URLSearchParams();
    params.set('cmd', session.cmd);
    if (session.hostId) params.set('hostId', session.hostId);
    if (session.source) params.set('source', session.source);
    if (session.sudo) params.set('sudo', 'true');
    if (session.tail) params.set('tail', String(session.tail));

    const url = `/api/logs/stream?${params.toString()}`;
    const es = new EventSource(url);
    session.eventSource = es;
    session.status = 'connecting';
    session.errorMessage = undefined;

    es.addEventListener('ready', () => {
      session.status = 'connected';
      this.notify();
    });

    es.addEventListener('log', (event: MessageEvent) => {
      try {
        const entry = JSON.parse(event.data) as LogEntryItem;
        session.entries.push(entry);
        if (session.entries.length > MAX_BUFFER_LINES) {
          session.entries.splice(0, session.entries.length - MAX_BUFFER_LINES);
        }
        this.notify();
      } catch (err) {
        console.warn('[LogStream] Failed to parse log event:', err);
      }
    });

    es.addEventListener('end', (event: MessageEvent) => {
      session.status = 'closed';
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          session.errorMessage = data.error;
          session.status = 'error';
        }
      } catch (_) {}
      es.close();
      session.eventSource = undefined;
      this.notify();
    });

    es.addEventListener('error', () => {
      // If was connecting or connected, report error
      if (session.status !== 'closed') {
        session.status = 'error';
        session.errorMessage = 'Потеряно соединение с потоком логов';
      }
      es.close();
      session.eventSource = undefined;
      this.notify();
    });
  }

  public closeStream(id: string): void {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;

    const sess = this.sessions[idx];
    if (sess.eventSource) {
      sess.eventSource.close();
      sess.eventSource = undefined;
    }

    this.sessions.splice(idx, 1);

    if (this.activeSessionId === id) {
      if (this.sessions.length > 0) {
        this.activeSessionId = this.sessions[this.sessions.length - 1].id;
      } else {
        this.activeSessionId = 'launcher';
      }
    }

    this.notify();
  }

  public clear(id: string): void {
    const sess = this.sessions.find((s) => s.id === id);
    if (sess) {
      sess.entries = [];
      this.notify();
    }
  }

  public reconnect(id: string): void {
    const sess = this.sessions.find((s) => s.id === id);
    if (sess) {
      sess.entries = [];
      this.connectEventSource(sess);
      this.notify();
    }
  }
}

export const logStreamService = new LogStreamService();
