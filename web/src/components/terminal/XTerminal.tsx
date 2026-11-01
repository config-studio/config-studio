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
}

export const XTerminal: React.FC<XTerminalProps> = ({
  host,
  onClose,
  accentColor = '#00d2b4',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');

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

    // Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Fira Code", Monaco, "Courier New", monospace',
      theme: {
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
      },
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
        identityId: host.identityId,
        cols: term.cols || 80,
        rows: term.rows || 24,
        term: 'xterm-256color',
      };
      ws.send(JSON.stringify(initPayload));
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onerror = (err) => {
      console.error('[SSH Terminal] WebSocket error:', err);
      setStatus('error');
      setErrorMessage('WebSocket connection failed');
      term.writeln(`\r\n\x1b[31m[SSH Error]\x1b[0m WebSocket communication failure.`);
    };

    ws.onclose = (event) => {
      setStatus('disconnected');
      term.writeln(`\r\n\x1b[33m[SSH]\x1b[0m Connection closed (Code: ${event.code}).`);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onBinary((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const buffer = new Uint8Array(data.length);
        for (let i = 0; i < data.length; ++i) {
          buffer[i] = data.charCodeAt(i) & 255;
        }
        ws.send(buffer);
      }
    });
  }, [host, accentColor]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && termRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          fitAddonRef.current.fit();
          const { cols, rows } = termRef.current;
          wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
        } catch {
          // ignore fit error on unmounted elements
        }
      }
    };

    const observer = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Connect on mount or when host changes
  useEffect(() => {
    connect();
    return () => {
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
    <div className="flex flex-col h-full w-full bg-[#0d1117] text-gray-200 select-none overflow-hidden">
      {/* Terminal Toolbar */}
      <div className="h-7 px-2.5 bg-[#161b22] border-b border-gray-800 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center space-x-2">
          <TerminalIcon size={12} style={{ color: accentColor }} />
          <span className="font-mono font-medium text-gray-200">
            {host.name || host.host}
          </span>
          <span className="text-gray-500 font-mono text-[11px]">
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
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-500/10 text-gray-400 font-medium">
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
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition"
            title="Переподключиться"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={handleClear}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition"
            title="Очистить терминал"
          >
            <Trash2 size={12} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition"
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
        className="flex-1 w-full h-full p-2 overflow-hidden"
        style={{ minHeight: '120px' }}
      />
    </div>
  );
};

export default XTerminal;
