import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Trash2,
  Copy,
  Check,
  Pause,
  Play,
  ArrowDown,
  Download,
  AlertCircle,
  Filter,
  Layers,
  Terminal,
} from 'lucide-react';
import { SearchInput } from './SearchInput';
import { Dropdown, DropdownOption } from './Dropdown';
import { StatusBadge, StatusBadgeVariant } from './StatusBadge';
import { StatusDot } from './StatusDot';
import { EmptyState } from './EmptyState';

export interface LogEntryItem {
  id: string;
  timestamp: string; // ISO 8601 string or date representation
  level: 'crit' | 'error' | 'warn' | 'info' | 'debug' | string;
  source: string;
  message: string;
  raw?: string;
  stream?: 'stdout' | 'stderr';
}

export interface LogViewerProps {
  entries: LogEntryItem[];
  title?: string;
  source?: string;
  isConnected?: boolean;
  statusText?: string;
  onClear?: () => void;
  onReconnect?: () => void;
  maxBufferLines?: number;
  enableSearch?: boolean;
  enableLevelFilter?: boolean;
  enableExport?: boolean;
  className?: string;
  autoScroll?: boolean;
  onAutoScrollChange?: (enabled: boolean) => void;
  emptyPlaceholder?: React.ReactNode;
}

export const LogViewer: React.FC<LogViewerProps> = ({
  entries,
  title,
  source,
  isConnected = true,
  statusText,
  onClear,
  onReconnect,
  maxBufferLines = 2000,
  enableSearch = true,
  enableLevelFilter = true,
  enableExport = true,
  className = '',
  autoScroll: controlledAutoScroll,
  onAutoScrollChange,
  emptyPlaceholder,
}) => {
  const [internalAutoScroll, setInternalAutoScroll] = useState(true);
  const isAutoScroll = controlledAutoScroll !== undefined ? controlledAutoScroll : internalAutoScroll;

  const setAutoScroll = useCallback(
    (val: boolean) => {
      setInternalAutoScroll(val);
      onAutoScrollChange?.(val);
    },
    [onAutoScrollChange]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [copied, setCopied] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);

  // Level mapping to badge variants
  const getBadgeVariant = (lvl: string): StatusBadgeVariant => {
    switch (lvl.toLowerCase()) {
    case 'crit':
    case 'critical':
    case 'fatal':
    case 'panic':
      return 'critical';
    case 'error':
    case 'err':
      return 'error';
    case 'warn':
    case 'warning':
      return 'warning';
    case 'debug':
    case 'trace':
      return 'accent';
    default:
      return 'info';
    }
  };

  // Available unique sources in the current log stream
  const availableSources = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.source) set.add(e.source);
    }
    return Array.from(set);
  }, [entries]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return entries.filter((e) => {
      // Level filtering
      if (selectedLevel !== 'all') {
        const lvl = (e.level || 'info').toLowerCase();
        if (selectedLevel === 'error' && lvl !== 'error' && lvl !== 'crit') {
          return false;
        }
        if (selectedLevel === 'warn' && lvl !== 'warn' && lvl !== 'error' && lvl !== 'crit') {
          return false;
        }
        if (selectedLevel === 'info' && lvl === 'debug') {
          return false;
        }
        if (selectedLevel === 'debug' && lvl !== 'debug') {
          return false;
        }
      }

      // Search query filtering
      if (q) {
        const msg = (e.message || '').toLowerCase();
        const src = (e.source || '').toLowerCase();
        const raw = (e.raw || '').toLowerCase();
        if (!msg.includes(q) && !src.includes(q) && !raw.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [entries, searchQuery, selectedLevel]);

  // Handle auto-scrolling
  useEffect(() => {
    if (!isAutoScroll || isUserScrollingRef.current) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filteredEntries.length, isAutoScroll]);

  // Handle scroll detection to toggle auto-scroll pause
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40; // px
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;

    if (!atBottom && isAutoScroll) {
      setAutoScroll(false);
    } else if (atBottom && !isAutoScroll) {
      setAutoScroll(true);
    }
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setAutoScroll(true);
    }
  };

  // Format timestamp
  const formatTime = (ts: string) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      const pad = (n: number, s = 2) => String(n).padStart(s, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    } catch {
      return ts;
    }
  };

  // Copy all clean logs
  const handleCopyAll = () => {
    const text = filteredEntries
      .map((e) => `[${formatTime(e.timestamp)}] [${(e.level || 'INFO').toUpperCase()}] ${e.source ? `[${e.source}] ` : ''}${e.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Export to .log file
  const handleExport = () => {
    const text = filteredEntries
      .map((e) => `[${e.timestamp}] [${(e.level || 'INFO').toUpperCase()}] ${e.source ? `[${e.source}] ` : ''}${e.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_${source || 'stream'}_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Highlight search substring
  const highlightSearch = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-amber-400/30 text-amber-200 rounded px-0.5 font-medium">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const levelOptions: DropdownOption[] = [
    { value: 'all', label: 'Все уровни', badge: String(entries.length), badgeColor: 'default' },
    { value: 'error', label: 'Только ошибки', subtitle: 'ERROR & CRITICAL', badge: 'ERR', badgeColor: 'rose' },
    { value: 'warn', label: 'Ошибки и предупреждения', subtitle: 'WARN+', badge: 'WARN', badgeColor: 'amber' },
    { value: 'info', label: 'Информационные и выше', subtitle: 'INFO+', badge: 'INFO', badgeColor: 'blue' },
    { value: 'debug', label: 'Debug (Отладка)', subtitle: 'DEBUG', badge: 'DBG', badgeColor: 'purple' },
  ];

  return (
    <div className={`cs-log-viewer flex flex-col h-full w-full bg-[var(--bg-base)] text-xs select-none ${className}`}>
      {/* Log Viewer Toolbar */}
      <div className="cs-log-toolbar flex items-center justify-between gap-2 px-3 py-2 border-b border-base-border bg-[var(--bg-surface)] shrink-0 flex-wrap">
        {/* Left Section: Source / Title & Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          {title && (
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)] shrink-0">
              <Terminal size={14} className="text-accent" />
              <span>{title}</span>
            </div>
          )}

          {source && (
            <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent font-mono text-[11px] font-medium shrink-0">
              {source}
            </span>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            <StatusDot status={isConnected ? 'online' : 'offline'} pulse={isConnected} />
            <span className="text-[11px] text-[var(--text-muted)]">
              {statusText || (isConnected ? 'Live' : 'Отключено')}
            </span>
          </div>

          {enableSearch && (
            <div className="flex-1 max-w-[280px]">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Фильтр логов..."
                className="w-full"
              />
            </div>
          )}
        </div>

        {/* Right Section: Controls, Filters & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {enableLevelFilter && (
            <div className="w-[180px]">
              <Dropdown
                options={levelOptions}
                value={selectedLevel}
                onChange={(val) => setSelectedLevel(String(val))}
                placeholder="Фильтр уровней"
                size="sm"
              />
            </div>
          )}

          {/* Lines count badge */}
          <span className="px-2 py-1 rounded bg-[var(--bg-default)] border border-base-border text-[11px] text-[var(--text-muted)] font-mono">
            {filteredEntries.length !== entries.length
              ? `${filteredEntries.length} / ${entries.length}`
              : `${entries.length} строк`}
          </span>

          {/* Auto-scroll toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!isAutoScroll)}
            className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center gap-1 text-[11px] font-medium ${
              isAutoScroll
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-[var(--bg-default)] border-base-border text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            title={isAutoScroll ? 'Автопрокрутка включена (нажмите для паузы)' : 'Автопрокрутка на паузе (нажмите для включения)'}
          >
            {isAutoScroll ? <Play size={13} /> : <Pause size={13} />}
            <span className="hidden sm:inline">{isAutoScroll ? 'Скролл' : 'Пауза'}</span>
          </button>

          {/* Clear button */}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="p-1.5 rounded-lg border border-base-border bg-[var(--bg-default)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-rose-400 transition cursor-pointer"
              title="Очистить экран"
            >
              <Trash2 size={13} />
            </button>
          )}

          {/* Copy all */}
          <button
            type="button"
            onClick={handleCopyAll}
            disabled={filteredEntries.length === 0}
            className="p-1.5 rounded-lg border border-base-border bg-[var(--bg-default)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 transition cursor-pointer"
            title="Скопировать отфильтрованные логи"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>

          {/* Export to file */}
          {enableExport && (
            <button
              type="button"
              onClick={handleExport}
              disabled={filteredEntries.length === 0}
              className="p-1.5 rounded-lg border border-base-border bg-[var(--bg-default)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 transition cursor-pointer"
              title="Экспортировать в файл .log"
            >
              <Download size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main Logs Viewport */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-[var(--bg-base)]">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto overflow-x-hidden font-mono text-[11px] leading-relaxed p-2 space-y-0.5 select-text"
        >
          {filteredEntries.length === 0 ? (
            <div className="h-full flex items-center justify-center p-6">
              {emptyPlaceholder || (
                <EmptyState
                  icon={<Terminal className="w-8 h-8 text-[var(--text-muted)]" />}
                  title={searchQuery || selectedLevel !== 'all' ? 'Нет строк, соответствующих фильтрам' : 'Ожидание потока логов...'}
                  description={
                    searchQuery || selectedLevel !== 'all'
                      ? 'Попробуйте изменить поисковый запрос или уровень критичности.'
                      : 'Подключение установлено. Новые события появятся здесь в реальном времени.'
                  }
                />
              )}
            </div>
          ) : (
            filteredEntries.map((e, idx) => {
              const isExpanded = expandedIds.has(e.id);
              const isErr = e.level === 'error' || e.level === 'crit';
              const isWarn = e.level === 'warn';

              return (
                <div
                  key={e.id || idx}
                  className={`group flex items-start gap-2.5 px-2 py-1 rounded transition-colors ${
                    isErr
                      ? 'bg-rose-500/10 hover:bg-rose-500/15 border-l-2 border-rose-500'
                      : isWarn
                        ? 'bg-amber-500/10 hover:bg-amber-500/15 border-l-2 border-amber-500'
                        : 'hover:bg-[var(--bg-surface)] border-l-2 border-transparent'
                  }`}
                >
                  {/* Timestamp */}
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0 select-none pt-0.5">
                    {formatTime(e.timestamp)}
                  </span>

                  {/* Severity Badge */}
                  <div className="shrink-0 pt-0.5">
                    <StatusBadge
                      status={getBadgeVariant(e.level)}
                      size="xs"
                      className="font-mono uppercase font-bold tracking-wider"
                    >
                      {e.level || 'INFO'}
                    </StatusBadge>
                  </div>

                  {/* Source (if multiple) */}
                  {e.source && (
                    <span className="px-1.5 py-0.2 rounded bg-base-surface text-accent font-semibold text-[10px] shrink-0 pt-0.5">
                      {e.source}
                    </span>
                  )}

                  {/* Message body */}
                  <div className="flex-1 min-w-0 break-words whitespace-pre-wrap text-[var(--text-primary)]">
                    {highlightSearch(e.message, searchQuery)}
                    {e.raw && e.raw !== e.message && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(e.id)}
                        className="ml-2 text-[10px] text-[var(--text-muted)] hover:text-accent underline cursor-pointer select-none"
                      >
                        {isExpanded ? 'скрыть raw' : 'подробнее'}
                      </button>
                    )}
                    {isExpanded && e.raw && (
                      <div className="mt-1 p-2 rounded bg-black/40 border border-base-border text-[10px] text-gray-300 font-mono overflow-x-auto whitespace-pre">
                        {e.raw}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Floating Scroll-to-Bottom / Resume button when paused */}
        {!isAutoScroll && (
          <div className="absolute bottom-4 right-6 animate-bounce select-none">
            <button
              type="button"
              onClick={scrollToBottom}
              className="px-3 py-1.5 rounded-full bg-accent text-gray-900 font-bold text-xs shadow-xl flex items-center gap-1.5 hover:brightness-110 transition cursor-pointer"
            >
              <ArrowDown size={14} />
              <span>К новым строкам</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
