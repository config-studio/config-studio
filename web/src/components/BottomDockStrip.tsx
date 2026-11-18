import React, { useState, useRef, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import {
  Terminal,
  FileText,
  ScrollText,
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
  HardDrive,
} from 'lucide-react';
import { BottomPanelDef } from '../services/pluginLoader';
import { OpenFile, GuardValidationResult, GuardIssue, AuditEvent, SSHHost } from '../types';
import { api } from '../services/api';
import { translations } from '../utils/i18n';
import { telemetry } from '../services/telemetry';
import { sshHostService } from '../services/sshHosts';
import { logStreamService, LogStreamSession } from '../services/logStream';
import { sysinfoService, SysInfoState, formatBytes, formatUptime, getLoadStatus } from '../services/sysinfo';
import { SysInfoPanel } from './sysinfo/SysInfoPanel';
import { Dropdown, DropdownOption, ScrollArea, PillTabs, PillTabItem, ConfirmModal, DiagnosticsCountBadge, StatusBadge, Badge, EmptyState, LogViewer } from '@config-studio/ui';
import { TerminalHostLauncher } from './terminal/TerminalHostLauncher';
import { LogStreamLauncher } from './logs/LogStreamLauncher';
import { EditHostModal } from './terminal/EditHostModal';
import type { XTerminalHandle } from './terminal/XTerminal';
import { ProblemsTab } from './dock/ProblemsTab';
import { OutputTab } from './dock/OutputTab';
import { useTerminalSessions } from './dock/useTerminalSessions';
export type { TerminalSession } from './dock/useTerminalSessions';


const XTerminal = lazy(() => import('./terminal/XTerminal'));



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
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null);

  // Streaming Log Sessions State
  const [logSessions, setLogSessions] = useState<LogStreamSession[]>(() => logStreamService.getSessions());
  const [activeLogSessionId, setActiveLogSessionId] = useState<string>(() => logStreamService.getActiveSessionId());

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    termRefs,
    hostToDelete,
    setHostToDelete,
    handleSelectHost,
    handleCloseSession,
    handleReconnectActive,
    handleClearActive,
    handleSessionStatusChange,
    handleDeleteHost,
    handleConfirmDelete,
    terminalSessionTabs,
  } = useTerminalSessions(setSshHosts);

  const mountContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [sysInfoState, setSysInfoState] = useState<SysInfoState>(() => sysinfoService.getState());

  useEffect(() => {
    return sshHostService.subscribe((updated) => {
      setSshHosts(updated);
    });
  }, []);

  useEffect(() => {
    return sysinfoService.subscribe((updated) => {
      setSysInfoState(updated);
    });
  }, []);

  const { metrics: sysMetrics, error: sysError, activeNodeName: sysNodeName } = sysInfoState;

  const handleSaveHost = useCallback(
    (hostToSave: SSHHost, autoConnect: boolean = false) => {
      sshHostService.save(hostToSave);
      if (autoConnect) {
        handleSelectHost(hostToSave);
      }
    },
    [handleSelectHost]
  );

  // Subscribe to Log Stream Service
  useEffect(() => {
    return logStreamService.subscribe((updatedSessions, activeId) => {
      setLogSessions([...updatedSessions]);
      setActiveLogSessionId(activeId);
    });
  }, []);

  // Handle cs:open-log-stream global event
  useEffect(() => {
    const handleOpenLogStream = (e: any) => {
      const detail = e.detail;
      if (detail && detail.cmd) {
        logStreamService.openStream(detail);
      } else {
        logStreamService.setActiveSessionId('launcher');
      }
      onSelectPanel('logs');
      if (!isOpen) onToggleOpen(true);
    };
    window.addEventListener('cs:open-log-stream', handleOpenLogStream);
    return () => window.removeEventListener('cs:open-log-stream', handleOpenLogStream);
  }, [isOpen, onSelectPanel, onToggleOpen]);

  const logSessionTabs = useMemo<PillTabItem[]>(() => {
    const items: PillTabItem[] = [
      {
        id: 'launcher',
        label: t.dockLogsLauncher || 'Стримы',
        icon: <ScrollText size={12} />,
        closable: false,
      },
    ];

    logSessions.forEach((s) => {
      let statusDot: PillTabItem['statusDot'] = 'amber';
      if (s.status === 'connected') statusDot = 'green';
      else if (s.status === 'connecting') statusDot = 'amber';
      else if (s.status === 'closed' || s.status === 'error') statusDot = 'red';

      items.push({
        id: s.id,
        label: s.title,
        icon: <FileText size={12} />,
        statusDot,
        closable: true,
      });
    });

    return items;
  }, [logSessions, t]);

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
      {
        id: 'logs',
        label: t.dockLogs || 'Логи',
        icon: <ScrollText size={12} />,
        badge: logSessions.length > 0 ? logSessions.length : undefined,
        badgeColor: 'accent',
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

    // 4. SysInfo Hardware Monitoring Tab (Compact on mobile, full-size sensors on PC)
    const primaryDisk = sysMetrics && sysMetrics.disks && sysMetrics.disks.length > 0 ? sysMetrics.disks[0] : null;

    const getLoadColor = (pct: number) => {
      const status = getLoadStatus(pct);
      if (status === 'critical') return 'text-rose-600 dark:text-rose-400 font-bold';
      if (status === 'warning') return 'text-amber-600 dark:text-amber-400 font-semibold';
      return 'text-slate-700 dark:text-slate-300 font-medium';
    };

    items.push({
      id: 'sysinfo',
      label: (
        <div className="flex items-center space-x-2 font-mono text-[11px]">
          <span className="font-semibold text-slate-900 dark:text-slate-100 max-w-[80px] sm:max-w-none truncate">
            {sysNodeName}
          </span>
          {sysMetrics && (
            <>
              {/* Mobile: compact CPU % badge */}
              <div className={`flex items-center space-x-1 ${getLoadColor(sysMetrics.cpuPercent ?? 0)}`}>
                <Cpu size={12} className="shrink-0 text-blue-600 dark:text-blue-400" />
                <span>{(sysMetrics.cpuPercent ?? 0).toFixed(0)}%</span>
              </div>

              {/* Desktop / PC: full sensors from Screenshot 1 */}
              <div
                className={`hidden sm:flex items-center space-x-1 ${getLoadColor(sysMetrics.memory?.usedPercent ?? 0)}`}
                title={`RAM: ${formatBytes(sysMetrics.memory?.usedBytes ?? 0)} / ${formatBytes(sysMetrics.memory?.totalBytes ?? 0)}`}
              >
                <Layers size={12} className="shrink-0 text-purple-600 dark:text-purple-400" />
                <span>{(sysMetrics.memory?.usedPercent ?? 0).toFixed(0)}%</span>
              </div>

              {primaryDisk && (
                <div
                  className={`hidden md:flex items-center space-x-1 ${getLoadColor(primaryDisk.usedPercent ?? 0)}`}
                  title={`Disk ${primaryDisk.mountPoint || ''}: ${formatBytes(primaryDisk.availableBytes ?? 0)} free`}
                >
                  <HardDrive size={12} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
                  <span>{formatBytes(primaryDisk.availableBytes ?? 0)}</span>
                </div>
              )}

              <div
                className="hidden lg:flex items-center space-x-1 text-slate-700 dark:text-slate-300 font-medium"
                title={`Uptime: ${sysMetrics.uptimeSec ?? 0}s`}
              >
                <Clock size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{formatUptime(sysMetrics.uptimeSec ?? 0)}</span>
              </div>
            </>
          )}
          {sysError && (
            <span className="text-rose-500 text-[10px]">offline</span>
          )}
        </div>
      ),
      statusDot: sysError ? 'error' : sysMetrics ? 'online' : 'connecting',
      closable: false,
    });

    return items;
  }, [t, panels, criticalIssuesCount, sysInfoState, logSessions]);

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
              ) : activePanelId === 'logs' ? (
                <div className="flex items-center space-x-2 min-w-0 flex-1 pr-2">
                  <PillTabs
                    items={logSessionTabs}
                    activeId={activeLogSessionId}
                    onChange={(id) => logStreamService.setActiveSessionId(id)}
                    onClose={(id) => logStreamService.closeStream(id)}
                    onAdd={() => logStreamService.setActiveSessionId('launcher')}
                    addTooltip={t.dockLogsNewStream || 'Запустить новый стрим логов'}
                    variant="dock"
                    size="sm"
                  />
                </div>
              ) : activePanelId === 'sysinfo' ? (
                <div className="flex items-center space-x-2 text-[var(--text-primary)] font-semibold truncate">
                  <Server size={14} className="text-emerald-500 shrink-0" />
                  <span>{t.sysinfoTitle || 'Мониторинг узла'}</span>
                  <Badge variant="neutral" size="sm" className="font-mono text-emerald-500">
                    {sysInfoState.activeNodeName}
                  </Badge>
                  {sysMetrics && (
                    <span className="hidden md:inline text-[11px] text-[var(--text-muted)] font-mono font-normal truncate">
                      • {sysMetrics.hostname} • {sysMetrics.os}/{sysMetrics.arch} • {sysMetrics.numCpu} {t.sysinfoCores || 'cores'}
                    </span>
                  )}
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

              {/* Logs session action buttons */}
              {activePanelId === 'logs' && activeLogSessionId !== 'launcher' && (
                <>
                  <button
                    type="button"
                    onClick={() => logStreamService.reconnect(activeLogSessionId)}
                    className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                    title="Перезапустить стрим логов"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => logStreamService.clear(activeLogSessionId)}
                    className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                    title="Очистить буфер логов"
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

              {activePanelId === 'sysinfo' && (
                <button
                  type="button"
                  onClick={() => sysinfoService.refresh()}
                  disabled={sysInfoState.loading}
                  className="p-1 hover:text-[var(--text-primary)] hover:bg-base-surface-hover/80 rounded transition cursor-pointer"
                  title={t.sysinfoRefresh || 'Обновить'}
                >
                  <RefreshCw size={12} className={sysInfoState.loading ? 'animate-spin text-emerald-500' : ''} />
                </button>
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

            {/* Built-in: Logs Tab with Multi-Session & Launcher */}
            {activePanelId === 'logs' && (
              <div className="h-full w-full bg-base flex flex-col overflow-hidden relative">
                {/* View A: Launcher */}
                <div
                  className={`h-full w-full ${
                    activeLogSessionId === 'launcher' ? 'block' : 'hidden'
                  }`}
                >
                  <LogStreamLauncher
                    hosts={sshHosts}
                    onStartStream={(options) => {
                      logStreamService.openStream(options);
                    }}
                    accentColor={accentColor}
                  />
                </div>

                {/* View B: Active Log Stream Sessions */}
                {logSessions.map((sess) => (
                  <div
                    key={sess.id}
                    className={`h-full w-full ${
                      activeLogSessionId === sess.id ? 'block' : 'hidden'
                    }`}
                  >
                    <LogViewer
                      entries={sess.entries}
                      isConnected={sess.status === 'connected'}
                      statusText={
                        sess.status === 'connected'
                          ? 'CONNECTED'
                          : sess.status === 'connecting'
                          ? 'CONNECTING'
                          : sess.status === 'error'
                          ? 'ERROR'
                          : 'CLOSED'
                      }
                      title={sess.title}
                      source={sess.source}
                      onClear={() => logStreamService.clear(sess.id)}
                      onReconnect={() => logStreamService.reconnect(sess.id)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 2. Built-in: Problems Tab */}
            {activePanelId === 'problems' && (
              <ProblemsTab
                guardResult={guardResult}
                onJumpToLine={onJumpToLine}
                emptyText={t.dockNoProblems}
              />
            )}

            {/* 3. Built-in: Output / Audit Tab */}
            {activePanelId === 'output' && (
              <OutputTab
                recentAudit={recentAudit}
                auditCategory={auditCategory}
                onCategoryChange={(cat) => {
                  setAuditCategory(cat);
                  loadRecentAudit(cat);
                }}
                emptyText={t.dockNoOutput}
              />
            )}

            {/* 4. Plugin Mount Targets */}
            {panels.map((p) => (
              <div
                key={p.id}
                ref={(el) => (mountContainerRefs.current[p.id] = el)}
                className={`h-full w-full ${p.id === activePanelId ? 'block' : 'hidden'}`}
              />
            ))}

            {/* 5. SysInfo Hardware Monitoring Target (Screenshot 2 as Dock Tab) */}
            {activePanelId === 'sysinfo' && (
              <div className="h-full w-full overflow-y-auto custom-scrollbar p-3 sm:p-4 bg-base">
                <SysInfoPanel
                  state={sysInfoState}
                  onRefresh={() => sysinfoService.refresh()}
                  language={language}
                  accentColor={accentColor}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Top Sub-bar (Sandwich Tier 1): Cursor info & dock toggle placed directly above the pill tabs */}
      {currentFile && (
        <div className="sm:hidden h-6 min-h-[24px] max-h-[24px] px-2.5 bg-base-surface border-t border-base-border flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] select-none shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-[var(--text-primary)] font-medium">
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
            <span className="text-gray-400 dark:text-gray-600 select-none">|</span>
            <span>UTF-8</span>
          </div>
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
      )}

      {/* The Always-Visible Strip Bar (Sandwich Tier 2: PillTabs) */}
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

        {/* Right (Desktop only): File Status & Hotkey Hint */}
        <div className="hidden sm:flex items-center space-x-2.5 sm:space-x-3 text-[11px] font-mono shrink-0 pl-2">
          {currentFile && (
            <div className="flex items-center space-x-2.5 sm:space-x-3 text-[var(--text-muted)]">
              <span>
                Ln {cursorPos.line}, Col {cursorPos.col}
              </span>
              <span className="text-gray-400 dark:text-gray-600 select-none">|</span>
              <span>UTF-8</span>
              <span className="text-gray-400 dark:text-gray-600 select-none">|</span>
              <span>Spaces: 2</span>
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
