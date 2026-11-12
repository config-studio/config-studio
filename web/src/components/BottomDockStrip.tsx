import React, { useState, useRef, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import {
  Terminal,
  FileText,
  AlertCircle,
  User,
  Globe,
  Cpu,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  X,
  RefreshCw,
  Trash2,
  Clock,
  Layers,
  Code,
  Copy,
  Check,
  CheckCircle2,
  Server,
} from 'lucide-react';
import { BottomPanelDef } from '../services/pluginLoader';
import { OpenFile, GuardValidationResult, GuardIssue, AuditEvent, SSHHost } from '../types';
import { api } from '../services/api';
import { translations } from '../utils/i18n';
import { telemetry } from '../services/telemetry';
import { sshHostService } from '../services/sshHosts';
import { SysInfoBar } from './sysinfo/SysInfoBar';
import { Dropdown, DropdownOption, ScrollArea, PillTabs, PillTabItem, ConfirmModal, DiagnosticsCountBadge, StatusBadge, Badge, EmptyState } from '@config-studio/ui';
import { TerminalHostLauncher } from './terminal/TerminalHostLauncher';
import { EditHostModal } from './terminal/EditHostModal';
import type { XTerminalHandle } from './terminal/XTerminal';

const XTerminal = lazy(() => import('./terminal/XTerminal'));

export interface TerminalSession {
  id: string;
  hostId: string;
  host: SSHHost;
  title: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

interface BottomDockStripProps {
  panels: BottomPanelDef[];
  activePanelId: string | null;
  isOpen: boolean;
  dockMode?: 'auto' | 'always' | 'hidden';
  guardResult: GuardValidationResult | null;
  currentFile: OpenFile | null;
  cursorPos?: { line: number; col: number };
  language?: string;
  onToggleOpen: (open?: boolean) => void;
  onSelectPanel: (panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  onJumpToLine?: (line: number, col?: number) => void;
  accentColor?: string;
  themeMode?: 'dark' | 'light';
}

export const BottomDockStrip: React.FC<BottomDockStripProps> = ({
  panels,
  activePanelId,
  isOpen,
  dockMode = 'auto',
  guardResult,
  currentFile,
  cursorPos = { line: 1, col: 1 },
  language = 'ru',
  onToggleOpen,
  onSelectPanel,
  onClosePanel,
  onJumpToLine,
  accentColor = '#00d2b4',
  themeMode,
}) => {
  const t = translations[language] || translations.ru;
  const [height, setHeight] = useState<number>(() => {
    const saved = localStorage.getItem('cs_dock_height');
    return saved ? parseInt(saved, 10) : 240;
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [recentAudit, setRecentAudit] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditCategory, setAuditCategory] = useState<string>('');
  const [copiedAi, setCopiedAi] = useState(false);

  // SSH Hosts & Multi-Session Terminal State
  const [sshHosts, setSshHosts] = useState<SSHHost[]>(() => sshHostService.list());
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('launcher');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null);
  const [hostToDelete, setHostToDelete] = useState<SSHHost | null>(null);
  const termRefs = useRef<Record<string, XTerminalHandle | null>>({});

  const mountContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    return sshHostService.subscribe((updated) => {
      setSshHosts(updated);
    });
  }, []);

  const handleSelectHost = useCallback((host: SSHHost) => {
    setSessions((prev) => {
      const existingForHost = prev.filter((s) => s.hostId === host.id);
      const title =
        existingForHost.length > 0
          ? `${host.name || host.host} (${existingForHost.length + 1})`
          : (host.name || host.host);

      const newSess: TerminalSession = {
        id: 'sess-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        hostId: host.id,
        host,
        title,
        status: 'connecting',
      };
      setActiveSessionId(newSess.id);
      sshHostService.setLastActiveHostId(host.id);
      return [...prev, newSess];
    });
  }, []);

  const handleCloseSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      delete termRefs.current[sessionId];
      if (activeSessionId === sessionId) {
        if (next.length > 0) {
          setActiveSessionId(next[next.length - 1].id);
        } else {
          setActiveSessionId('launcher');
        }
      }
      return next;
    });
  }, [activeSessionId]);

  const handleReconnectActive = useCallback(() => {
    if (activeSessionId && activeSessionId !== 'launcher') {
      termRefs.current[activeSessionId]?.reconnect();
    }
  }, [activeSessionId]);

  const handleClearActive = useCallback(() => {
    if (activeSessionId && activeSessionId !== 'launcher') {
      termRefs.current[activeSessionId]?.clear();
    }
  }, [activeSessionId]);

  const handleSessionStatusChange = useCallback(
    (sessionId: string, status: TerminalSession['status'], error?: string) => {
      setSessions((prev) => {
        const target = prev.find((s) => s.id === sessionId);
        if (target && target.status === status && target.errorMessage === (error || '')) {
          return prev;
        }
        return prev.map((s) => (s.id === sessionId ? { ...s, status, errorMessage: error || '' } : s));
      });
    },
    []
  );

  const handleSaveHost = useCallback(
    (hostToSave: SSHHost, autoConnect: boolean = false) => {
      sshHostService.save(hostToSave);
      if (autoConnect) {
        handleSelectHost(hostToSave);
      }
    },
    [handleSelectHost]
  );

  const handleDeleteHost = useCallback((host: SSHHost) => {
    setHostToDelete(host);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (hostToDelete) {
      sshHostService.delete(hostToDelete.id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.hostId !== hostToDelete.id);
        if (next.length === 0) {
          setActiveSessionId('launcher');
        } else if (!next.some((s) => s.id === activeSessionId)) {
          setActiveSessionId(next[next.length - 1].id);
        }
        return next;
      });
      setHostToDelete(null);
    }
  }, [hostToDelete, activeSessionId]);

  useEffect(() => {
    const handleOpenSSH = (e: any) => {
      const detail = e.detail;
      const hosts = sshHostService.list();
      setSshHosts(hosts);
      if (detail && detail.id) {
        const match = hosts.find((h) => h.id === detail.id);
        if (match) handleSelectHost(match);
      } else if (detail && detail.host) {
        const match = hosts.find((h) => h.host === detail.host);
        if (match) handleSelectHost(match);
      }
    };
    window.addEventListener('cs:open-ssh-terminal', handleOpenSSH);
    return () => window.removeEventListener('cs:open-ssh-terminal', handleOpenSSH);
  }, [handleSelectHost]);

  const terminalSessionTabs = useMemo<PillTabItem[]>(() => {
    const items: PillTabItem[] = [
      {
        id: 'launcher',
        label: 'Хосты',
        icon: <Server size={12} />,
        closable: false,
      },
    ];

    sessions.forEach((s) => {
      let statusDot: PillTabItem['statusDot'] = 'amber';
      if (s.status === 'connected') statusDot = 'green';
      else if (s.status === 'connecting') statusDot = 'amber';
      else if (s.status === 'disconnected' || s.status === 'error') statusDot = 'red';

      items.push({
        id: s.id,
        label: s.title,
        icon: <Terminal size={12} />,
        statusDot,
        closable: true,
      });
    });

    return items;
  }, [sessions]);

  // Load audit events for Output tab
  const loadRecentAudit = async (category = auditCategory) => {
    setAuditLoading(true);
    try {
      const res = await api.getAuditLogs({ limit: 40, category: category || undefined });
      setRecentAudit(res.events || []);
    } catch {
      // ignore
    } finally {
      setAuditLoading(false);
    }
  };

  const handleCopyAiReport = async () => {
    const success = await telemetry.copyDiagnosticReport();
    if (success) {
      setCopiedAi(true);
      setTimeout(() => setCopiedAi(false), 2000);
    }
  };

  useEffect(() => {
    if (isOpen && activePanelId === 'output') {
      loadRecentAudit();
    }
  }, [isOpen, activePanelId]);

  // Mount plugin DOM containers
  useEffect(() => {
    panels.forEach((p) => {
      const el = mountContainerRefs.current[p.id];
      if (el && p.render) {
        p.render(el);
      }
    });
  }, [panels, activePanelId]);

  if (dockMode === 'hidden') {
    return null;
  }

  // Mouse Drag to Resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startY = e.clientY;
    const startHeight = height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.min(Math.max(startHeight + delta, 140), window.innerHeight * 0.85);
      setHeight(newHeight);
      localStorage.setItem('cs_dock_height', newHeight.toString());
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleTabClick = (tabId: string) => {
    if (activePanelId === tabId) {
      onToggleOpen(!isOpen);
    } else {
      onSelectPanel(tabId);
      if (!isOpen) onToggleOpen(true);
    }
  };

  const criticalIssuesCount = guardResult?.issues.filter((i) => i.severity === 'critical').length || 0;
  const warningIssuesCount = guardResult?.issues.filter((i) => i.severity === 'warning').length || 0;

  const dockTabItems = useMemo<PillTabItem[]>(() => {
    const items: PillTabItem[] = [
      {
        id: 'terminal',
        label: t.dockTerminal || 'Терминал',
        icon: <Terminal size={12} />,
        closable: false,
      },
    ];

    panels.forEach((p) => {
      items.push({
        id: p.id,
        label: p.title,
        icon: <Terminal size={12} />,
        badge: p.badge,
        badgeColor: 'accent',
        closable: false,
      });
    });

    items.push({
      id: 'output',
      label: t.dockOutput,
      icon: <FileText size={12} />,
      closable: false,
    });

    items.push({
      id: 'problems',
      label: t.dockProblems,
      icon: (
        <AlertCircle
          size={12}
          className={criticalIssuesCount > 0 ? 'text-red-400 animate-pulse' : ''}
        />
      ),
      badge: criticalIssuesCount > 0 ? criticalIssuesCount : undefined,
      badgeColor: 'red',
      closable: false,
    });

    return items;
  }, [t, panels, criticalIssuesCount]);

  return (
    <div
      className={`border-t border-base-border flex flex-col bg-base-surface select-none z-30 shrink-0 transition-colors ${
        isDragging ? 'select-none pointer-events-auto' : ''
      }`}
    >
      {/* Expanded Content Area (Visible when isOpen) */}
      {isOpen && (
        <div
          style={{ height: isMaximized ? 'calc(100vh - 120px)' : `${height}px` }}
          className="flex flex-col overflow-hidden relative border-b border-base-border bg-base"
        >
          {/* Top Drag Splitter */}
          <div
            onMouseDown={handleMouseDown}
            className="h-1.5 w-full bg-base-border hover:bg-accent/60 cursor-row-resize transition-colors flex items-center justify-center group"
            title={t.dockResizeTooltip}
          >
            <div className="w-10 h-0.5 rounded-full bg-gray-500 group-hover:bg-accent transition-colors" />
          </div>

          {/* Panel Header & Controls */}
          <div className="h-8 px-3 border-b border-base-border bg-base-surface flex items-center justify-between text-xs text-[var(--text-muted)]">
            <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-x-auto custom-scrollbar">
              {activePanelId === 'terminal' ? (
                <div className="flex items-center space-x-2 min-w-0 flex-1 pr-2">
                  <PillTabs
                    items={terminalSessionTabs}
                    activeId={activeSessionId}
                    onChange={(id) => setActiveSessionId(id)}
                    onClose={(id) => handleCloseSession(id)}
                    onAdd={() => setActiveSessionId('launcher')}
                    addTooltip="Выбор хостов / Новый терминал"
                    variant="dock"
                    size="sm"
                  />
                </div>
              ) : (
                <span className="font-semibold text-[var(--text-primary)] truncate">
                  {activePanelId === 'output' && t.dockOutputTitle}
                  {activePanelId === 'problems' && t.dockProblemsTitle}
                  {panels.find((p) => p.id === activePanelId)?.title}
                </span>
              )}

              {activePanelId === 'problems' && (
                <DiagnosticsCountBadge
                  errors={criticalIssuesCount}
                  warnings={warningIssuesCount}
                  errorsLabel={t.dockErrors}
                  warningsLabel={t.dockWarnings}
                />
              )}
            </div>

            <div className="flex items-center space-x-1 shrink-0">
              {/* Terminal session action buttons */}
              {activePanelId === 'terminal' && activeSessionId !== 'launcher' && (
                <>
                  <button
                    type="button"
                    onClick={handleReconnectActive}
                    className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                    title="Переподключиться к серверу"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={handleClearActive}
                    className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                    title="Очистить терминал"
                  >
                    <Trash2 size={12} />
                  </button>
                  <span className="w-px h-3 bg-base-border mx-1" />
                </>
              )}

              {activePanelId === 'output' && (
                <>
                  <button
                    type="button"
                    onClick={handleCopyAiReport}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 transition mr-1 font-medium cursor-pointer"
                    title={t.auditCopyAi}
                  >
                    {copiedAi ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    <span>{copiedAi ? t.auditCopied : t.auditCopyAi}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadRecentAudit()}
                    disabled={auditLoading}
                    className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                    title={t.dockRefreshTooltip}
                  >
                    <RefreshCw size={13} className={auditLoading ? 'animate-spin' : ''} />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setHeight((h) => (h <= 240 ? 420 : 240))}
                className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                title={language === 'en' ? (height <= 240 ? 'Expand height' : 'Shrink height') : (height <= 240 ? 'Увеличить высоту' : 'Уменьшить высоту')}
              >
                {height <= 240 ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              <button
                type="button"
                onClick={() => setIsMaximized((m) => !m)}
                className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                title={isMaximized ? t.dockRestoreTooltip : t.dockMaximizeTooltip}
              >
                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>

              <button
                type="button"
                onClick={() => onToggleOpen(false)}
                className="p-1 hover:text-red-400 hover:bg-red-500/10 rounded transition cursor-pointer"
                title={t.dockCloseTooltip}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Panel Body Content */}
          <div className="flex-1 overflow-auto relative p-0 font-mono text-xs custom-scrollbar">
            {/* 1. Built-in: Terminal Tab with Multi-Session & Host Launcher */}
            {activePanelId === 'terminal' && (
              <div className="h-full w-full bg-base flex flex-col overflow-hidden relative">
                {/* View A: Host Launcher (Image 2 Mockup) */}
                <div
                  className={`h-full w-full ${
                    activeSessionId === 'launcher' ? 'block' : 'hidden'
                  }`}
                >
                  <TerminalHostLauncher
                    hosts={sshHosts}
                    onSelectHost={handleSelectHost}
                    onAddHost={() => {
                      setEditingHost(null);
                      setIsAddModalOpen(true);
                    }}
                    onEditHost={(host) => {
                      setEditingHost(host);
                      setIsAddModalOpen(true);
                    }}
                    onDeleteHost={handleDeleteHost}
                    accentColor={accentColor}
                  />
                </div>

                {/* View B: Active Sessions (Mounted and preserved with CSS hidden/block) */}
                {sessions.map((sess) => (
                  <div
                    key={sess.id}
                    className={`h-full w-full ${
                      activeSessionId === sess.id ? 'block' : 'hidden'
                    }`}
                  >
                    <Suspense
                      fallback={
                        <div className="p-4 text-xs text-gray-400 flex items-center justify-center h-full">
                          <RefreshCw size={14} className="animate-spin mr-2" />
                          <span>Подключение к {sess.host.name || sess.host.host}...</span>
                        </div>
                      }
                    >
                      <XTerminal
                        ref={(el) => {
                          termRefs.current[sess.id] = el;
                        }}
                        host={sess.host}
                        accentColor={accentColor}
                        themeMode={themeMode}
                        showHeader={false}
                        isActive={isOpen && activePanelId === 'terminal' && activeSessionId === sess.id}
                        onStatusChange={(status, err) => handleSessionStatusChange(sess.id, status, err)}
                        onClose={() => handleCloseSession(sess.id)}
                      />
                    </Suspense>
                  </div>
                ))}
              </div>
            )}

            {/* 2. Built-in: Problems Tab */}
            {activePanelId === 'problems' && (
              <div className="space-y-1 p-2">
                {guardResult && guardResult.issues.length > 0 ? (
                  guardResult.issues.map((iss, idx) => (
                    <div
                      key={idx}
                      onClick={() => onJumpToLine?.(iss.line, iss.column)}
                      className={`flex items-start justify-between p-3 rounded-xl cursor-pointer transition border select-none ${
                        iss.severity === 'critical'
                          ? 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/15'
                          : 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15'
                      }`}
                    >
                      <div className="flex items-start space-x-2.5 min-w-0 flex-1">
                        <AlertCircle
                          size={15}
                          className={`shrink-0 mt-0.5 ${
                            iss.severity === 'critical' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className={`font-semibold text-xs leading-snug ${
                            iss.severity === 'critical'
                              ? 'text-rose-950 dark:text-rose-100'
                              : 'text-amber-950 dark:text-amber-100'
                          }`}>
                            {iss.message}
                          </div>
                          {iss.snippet && (
                            <pre className={`text-[11px] font-mono leading-relaxed mt-2 p-2.5 rounded-lg border overflow-x-auto select-text shadow-2xs ${
                              iss.severity === 'critical'
                                ? 'bg-white/95 text-slate-800 border-rose-200/80 dark:bg-black/50 dark:text-slate-200 dark:border-rose-900/40'
                                : 'bg-white/95 text-slate-800 border-amber-200/80 dark:bg-black/50 dark:text-slate-200 dark:border-amber-900/40'
                            }`}>
                              {iss.snippet.split('\n').map((line, lIdx) => {
                                const isTarget = line.startsWith('>');
                                return (
                                  <div
                                    key={lIdx}
                                    className={
                                      isTarget
                                        ? 'bg-rose-500/15 text-rose-900 dark:text-rose-200 font-bold px-1.5 py-0.5 rounded -mx-1 border-l-2 border-rose-500'
                                        : 'text-slate-600 dark:text-gray-400'
                                    }
                                  >
                                    {line}
                                  </div>
                                );
                              })}
                            </pre>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 pl-3">
                        <Badge
                          variant={iss.severity === 'critical' ? 'error' : 'warning'}
                          size="xs"
                          className="font-mono font-medium"
                        >
                          {iss.file}:{iss.line}:{iss.column}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6">
                    <EmptyState
                      icon={<CheckCircle2 size={24} className="text-emerald-500" />}
                      title={t.dockNoProblems}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 3. Built-in: Output / Audit Tab */}
            {activePanelId === 'output' && (
              <div className="space-y-1.5 p-2">
                {/* Category Filter Pills */}
                <div className="flex items-center gap-1 pb-1.5 border-b border-base-border overflow-x-auto text-[11px] no-scrollbar">
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('');
                      loadRecentAudit('');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium cursor-pointer ${
                      auditCategory === ''
                        ? 'bg-accent/15 text-accent border border-accent/40 font-semibold'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {t.auditFilterAll}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('error');
                      loadRecentAudit('error');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
                      auditCategory === 'error'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 font-semibold'
                        : 'text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-500/5'
                    }`}
                  >
                    <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
                    <span>{t.auditCatError || 'Ошибки'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('user');
                      loadRecentAudit('user');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
                      auditCategory === 'user'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
                        : 'text-[var(--text-muted)] hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-500/5'
                    }`}
                  >
                    <User className="w-3 h-3 text-emerald-500 shrink-0" />
                    <span>{t.auditCatUser || 'Действия'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('network');
                      loadRecentAudit('network');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
                      auditCategory === 'network'
                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40 font-semibold'
                        : 'text-[var(--text-muted)] hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-500/5'
                    }`}
                  >
                    <Globe className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span>{t.auditCatNetwork || 'Сеть'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('system');
                      loadRecentAudit('system');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
                      auditCategory === 'system'
                        ? 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/40 font-semibold'
                        : 'text-[var(--text-muted)] hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-500/5'
                    }`}
                  >
                    <Cpu className="w-3 h-3 text-slate-500 shrink-0" />
                    <span>{t.auditCatSystem || 'Система'}</span>
                  </button>
                </div>

                {recentAudit.length > 0 ? (
                  recentAudit.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex flex-col py-1 px-2 hover:bg-base-surface-hover/80 rounded text-[11px] text-[var(--text-secondary)] border-b border-base-border/50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 truncate">
                          <Clock size={11} className="text-[var(--text-muted)] shrink-0" />
                          <span className="text-[var(--text-muted)] shrink-0 font-mono text-[10px]">
                            {new Date(evt.timestamp).toLocaleTimeString()}
                          </span>
                          <Badge
                            variant={
                              evt.category === 'error' || evt.severity === 'error'
                                ? 'error'
                                : evt.category === 'network'
                                ? 'info'
                                : evt.category === 'system'
                                ? 'neutral'
                                : 'success'
                            }
                            size="xs"
                            className="uppercase font-mono font-bold tracking-wider"
                          >
                            {evt.category || 'user'}
                          </Badge>
                          <Badge
                            variant={
                              evt.severity === 'error' || evt.severity === 'critical'
                                ? 'error'
                                : evt.severity === 'warn'
                                ? 'warning'
                                : 'neutral'
                            }
                            size="xs"
                            className="font-mono font-medium"
                          >
                            {evt.action}
                          </Badge>
                          <span className="font-mono text-[var(--text-primary)] truncate">{evt.target}</span>
                        </div>
                        <span className="text-[var(--text-muted)] text-[10px] shrink-0 font-mono">
                          {evt.user} {evt.source ? `[${evt.source}]` : ''}
                        </span>
                      </div>
                      {evt.details && Object.keys(evt.details).length > 0 && (
                        <div className="text-[10px] text-[var(--text-muted)] font-mono pl-6 pt-0.5 truncate">
                          {JSON.stringify(evt.details)}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-gray-500">
                    <span>{t.dockNoOutput}</span>
                  </div>
                )}
              </div>
            )}

            {/* 4. Plugin Mount Targets */}
            {panels.map((p) => (
              <div
                key={p.id}
                ref={(el) => (mountContainerRefs.current[p.id] = el)}
                className={`h-full w-full ${p.id === activePanelId ? 'block' : 'hidden'}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* The Always-Visible Strip Bar */}
      <div className="min-h-[32px] sm:min-h-[28px] h-8 sm:h-7 px-2 bg-base-surface border-t border-base-border flex items-center justify-between text-xs select-none shrink-0 pb-[env(safe-area-inset-bottom)]">
        {/* Left: Tab Buttons (Option 2: PillTabs) */}
        <div className="flex-1 min-w-0 pr-2 overflow-x-auto custom-scrollbar">
          <PillTabs
            items={dockTabItems}
            activeId={isOpen ? activePanelId || '' : ''}
            onChange={(id) => handleTabClick(id)}
            variant="dock"
            size="sm"
          />
        </div>

        {/* Right: SysInfo & File Status & Hotkey Hint */}
        <div className="flex items-center space-x-2.5 sm:space-x-3 text-[11px] font-mono shrink-0 pl-2">
          {/* SysInfo Hardware Telemetry (CPU / RAM / Disks / Uptime) */}
          <SysInfoBar language={language} accentColor={accentColor} />

          {currentFile && (
            <div className="flex items-center space-x-2.5 sm:space-x-3 text-[var(--text-muted)]">
              <span className="hidden sm:inline text-gray-400 dark:text-gray-600 select-none">|</span>
              <span>
                Ln {cursorPos.line}, Col {cursorPos.col}
              </span>
              <span className="hidden sm:inline">UTF-8</span>
              <span className="hidden sm:inline">Spaces: 2</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onToggleOpen(!isOpen)}
            className="flex items-center space-x-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
            title={t.dockToggleTooltip}
          >
            <span>Ctrl+~</span>
            {isOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          </button>
        </div>
      </div>

      {/* SSH Host Creation / Editing Modal */}
      <EditHostModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingHost(null);
        }}
        host={editingHost}
        onSave={handleSaveHost}
        accentColor={accentColor}
      />

      {/* Delete Host Confirmation Modal */}
      <ConfirmModal
        isOpen={!!hostToDelete}
        onClose={() => setHostToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Удалить SSH-хост"
        message={
          <span>
            Вы уверены, что хотите удалить SSH-хост{' '}
            <strong className="text-[var(--text-primary)] font-semibold">
              «{hostToDelete?.name || hostToDelete?.host}»
            </strong>?
          </span>
        }
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
};

export default BottomDockStrip;
