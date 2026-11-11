import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { RefreshCw, Trash2, Power, Terminal as TerminalIcon, AlertCircle } from 'lucide-react';
import { SSHHost } from '../../types';

interface XTerminalProps {
  host: SSHHost;
  onClose?: () => void;
  accentColor?: string;
  themeMode?: 'dark' | 'light';
}

const isDarkEffective = (mode?: 'dark' | 'light') => {
  if (mode) return mode === 'dark';
  return typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true;
};

const getTerminalTheme = (isDark: boolean, accentColor: string) => {
  if (isDark) {
    return {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: accentColor,
      selectionBackground: 'rgba(56, 139, 253, 0.4)',
      black: '#0d1117',
      red: '#ff7b72',
      green: '#7ee787',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#d0d7de',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#ffffff',
    };
  }

  return {
    background: '#ffffff',
    foreground: '#0f172a',
    cursor: accentColor,
    selectionBackground: 'rgba(56, 139, 253, 0.25)',
    black: '#0f172a',
    red: '#cf222e',
    green: '#1a7f37',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#f8fafc',
    brightBlack: '#64748b',
    brightRed: '#a40e26',
    brightGreen: '#116329',
    brightYellow: '#633c01',
    brightBlue: '#0550ae',
    brightMagenta: '#5a32a3',
    brightCyan: '#116369',
    brightWhite: '#ffffff',
  };
};

export const XTerminal: React.FC<XTerminalProps> = ({
  host,
  onClose,
  accentColor = '#00d2b4',
  themeMode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isDark, setIsDark] = useState(() => isDarkEffective(themeMode));

  // Live dark/light theme observer
  useEffect(() => {
    const updateTheme = () => {
      const dark = isDarkEffective(themeMode);
      setIsDark(dark);
      if (termRef.current) {
        termRef.current.options.theme = getTerminalTheme(dark, accentColor);
        termRef.current.clearTextureAtlas?.();
        termRef.current.refresh?.(0, termRef.current.rows - 1);
      }
    };

    updateTheme();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          updateTheme();
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [themeMode, accentColor]);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Cleanup previous connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    setStatus('connecting');
    setErrorMessage('');

    const currentDark = isDarkEffective(themeMode);

    // Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Fira Code", Monaco, "Courier New", monospace',
      theme: getTerminalTheme(currentDark, accentColor),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln(`\x1b[36m[Config Studio SSH]\x1b[0m Connecting to ${host.user}@${host.host}:${host.port}...`);

    // Setup WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/ssh/ws?web=1`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      // Send Init Payload
      const initPayload = {
        type: 'init',
        host: host.host,
        port: host.port || 22,
        user: host.user,
        authType: host.authType || 'password',
        password: host.password,
        privateKey: host.privateKey,
        passphrase: host.passphrase,
        cols: term.cols,
        rows: term.rows,
      };
      ws.send(JSON.stringify(initPayload));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setStatus('connected');
            term.writeln(`\x1b[32mSSH Session Connected.\x1b[0m`);
          } else if (msg.type === 'error') {
            setStatus('error');
            setErrorMessage(msg.message || 'Connection failed');
            term.writeln(`\r\n\x1b[31m[SSH Error] ${msg.message}\x1b[0m\r\n`);
          } else if (msg.type === 'exit') {
            setStatus('disconnected');
            term.writeln(`\r\n\x1b[33mSession terminated.\x1b[0m\r\n`);
          }
        } catch {
          term.write(event.data);
        }
      } else {
        const u8 = new Uint8Array(event.data);
        term.write(u8);
      }
    };

    ws.onerror = () => {
      setStatus('error');
      setErrorMessage('WebSocket connection failed');
      term.writeln(`\r\n\x1b[31m[Network Error] Failed to connect to SSH gateway.\x1b[0m\r\n`);
    };

    ws.onclose = () => {
      if (status !== 'error') {
        setStatus('disconnected');
      }
    };

    // Forward user keystrokes to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize handling
    term.onResize((size) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });
  }, [host, accentColor]);

  // Initial connect
  useEffect(() => {
    connect();

    const handleResize = () => {
      fitAddonRef.current?.fit();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (termRef.current) {
        termRef.current.dispose();
      }
    };
  }, [connect]);

  const handleClear = () => {
    termRef.current?.clear();
  };

  const handleReconnect = () => {
    connect();
  };

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-[#0d1117] text-[var(--text-primary)] select-none overflow-hidden">
      {/* Terminal Toolbar */}
      <div className="h-7 px-2.5 bg-base-surface border-b border-base-border flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center space-x-2">
          <TerminalIcon size={12} style={{ color: accentColor }} />
          <span className="font-mono font-medium text-[var(--text-primary)]">
            {host.name || host.host}
          </span>
          <span className="text-[var(--text-muted)] font-mono text-[11px]">
            ({host.user}@{host.host}:{host.port || 22})
          </span>

          {/* Status Indicator */}
          {status === 'connected' && (
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Онлайн</span>
            </span>
          )}
          {status === 'connecting' && (
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              <span>Подключение...</span>
            </span>
          )}
          {status === 'disconnected' && (
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-black/10 dark:bg-white/10 text-[var(--text-muted)] font-medium">
              <Power size={10} />
              <span>Отключено</span>
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 font-medium" title={errorMessage}>
              <AlertCircle size={10} />
              <span>Ошибка</span>
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleReconnect}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/10 rounded transition cursor-pointer"
            title="Переподключиться"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={handleClear}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/10 rounded transition cursor-pointer"
            title="Очистить терминал"
          >
            <Trash2 size={12} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded transition cursor-pointer"
              title="Закрыть сессию"
            >
              <Power size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={containerRef}
        className="flex-1 w-full h-full p-2 overflow-hidden bg-white dark:bg-[#0d1117]"
        style={{ minHeight: '120px' }}
      />
    </div>
  );
};

export default XTerminal;
