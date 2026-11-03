import React, { useState, useRef, useEffect, useMemo, Suspense, lazy } from 'react';
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
  Clock,
  Layers,
  Code,
  Copy,
  Check,
  Server,
} from 'lucide-react';
import { BottomPanelDef } from '../services/pluginLoader';
import { OpenFile, GuardValidationResult, GuardIssue, AuditEvent, SSHHost } from '../types';
import { api } from '../services/api';
import { translations } from '../utils/i18n';
import { telemetry } from '../services/telemetry';
import { sshHostService } from '../services/sshHosts';
import { SysInfoBar } from './sysinfo/SysInfoBar';
import { Dropdown, DropdownOption } from '@config-studio/ui';

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

  // SSH Hosts state for Terminal Tab
  const [sshHosts, setSshHosts] = useState<SSHHost[]>(() => sshHostService.list());
  const [selectedHostId, setSelectedHostId] = useState<string>(() => {
    const last = sshHostService.getLastActiveHostId();
    const list = sshHostService.list();
    if (last && list.some((h) => h.id === last)) return last;
    return list[0]?.id || '';
  });

  const hostOptions = useMemo<DropdownOption[]>(() => {
    return sshHosts.map((h) => ({
      value: h.id,
      label: h.name || h.host,
      subtitle: `${h.user}@${h.host}:${h.port || 22}`,
      badge: h.authType === 'password' ? 'pass' : h.authType === 'vault' ? 'vault' : 'key',
      badgeColor: 'blue',
      icon: <Server size={12} />,
      statusDot: 'online',
    }));
  }, [sshHosts]);

  const mountContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    return sshHostService.subscribe((updated) => {
      setSshHosts(updated);
      if (updated.length > 0 && !updated.some((h) => h.id === selectedHostId)) {
        setSelectedHostId(updated[0].id);
      }
    });
  }, [selectedHostId]);

  useEffect(() => {
    const handleOpenSSH = (e: any) => {
      const detail = e.detail;
      const hosts = sshHostService.list();
      setSshHosts(hosts);
      if (detail && detail.id) {
        setSelectedHostId(detail.id);
        sshHostService.setLastActiveHostId(detail.id);
      } else if (detail && detail.host) {
        const match = hosts.find((h) => h.host === detail.host);
        if (match) {
          setSelectedHostId(match.id);
          sshHostService.setLastActiveHostId(match.id);
        }
      }
    };
    window.addEventListener('cs:open-ssh-terminal', handleOpenSSH);
    return () => window.removeEventListener('cs:open-ssh-terminal', handleOpenSSH);
  }, []);

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
  const currentHost = sshHosts.find((h) => h.id === selectedHostId) || sshHosts[0];

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
          className="flex flex-col overflow-hidden relative border-b border-base-border bg-[#0d1117]"
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
          <div className="h-8 px-3 border-b border-base-border bg-[#161b22] flex items-center justify-between text-xs text-[#8b949e]">
            <div className="flex items-center space-x-2 min-w-0">
              <span className="font-semibold text-gray-200 truncate">
                {activePanelId === 'terminal' && (t.dockTerminalTitle || 'SSH / Shell Терминал')}
                {activePanelId === 'output' && t.dockOutputTitle}
                {activePanelId === 'problems' && t.dockProblemsTitle}
                {panels.find((p) => p.id === activePanelId)?.title}
              </span>

              {/* Host Selector for Terminal */}
              {activePanelId === 'terminal' && sshHosts.length > 0 && (
                <div className="flex items-center space-x-1.5 ml-2 w-48 sm:w-56">
                  <Dropdown
                    options={hostOptions}
                    value={selectedHostId}
                    onChange={(val) => {
                      if (val) {
                        setSelectedHostId(val);
                        sshHostService.setLastActiveHostId(val);
                      }
                    }}
                    placeholder="Выберите хост..."
                    accentColor={accentColor}
                  />
                </div>
              )}

              {activePanelId === 'problems' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-950/40 text-red-400 border border-red-800/40">
                  {criticalIssuesCount} {t.dockErrors}, {warningIssuesCount} {t.dockWarnings}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-1 shrink-0">
              {activePanelId === 'output' && (
                <>
                  <button
                    type="button"
                    onClick={handleCopyAiReport}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 transition mr-1 font-medium"
                    title={t.auditCopyAi}
                  >
                    {copiedAi ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    <span>{copiedAi ? t.auditCopied : t.auditCopyAi}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadRecentAudit()}
                    disabled={auditLoading}
                    className="p-1 hover:text-white hover:bg-white/5 rounded transition"
                    title={t.dockRefreshTooltip}
                  >
                    <RefreshCw size={13} className={auditLoading ? 'animate-spin' : ''} />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setHeight((h) => (h <= 240 ? 420 : 240))}
                className="p-1 hover:text-white hover:bg-white/5 rounded transition"
                title={language === 'en' ? (height <= 240 ? 'Expand height' : 'Shrink height') : (height <= 240 ? 'Увеличить высоту' : 'Уменьшить высоту')}
              >
                {height <= 240 ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              <button
                type="button"
                onClick={() => setIsMaximized((m) => !m)}
                className="p-1 hover:text-white hover:bg-white/5 rounded transition"
                title={isMaximized ? t.dockRestoreTooltip : t.dockMaximizeTooltip}
              >
                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>

              <button
                type="button"
                onClick={() => onToggleOpen(false)}
                className="p-1 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                title={t.dockCloseTooltip}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Panel Body Content */}
          <div className="flex-1 overflow-auto relative p-0 font-mono text-xs custom-scrollbar">
            {/* 1. Built-in: Terminal Tab */}
            {activePanelId === 'terminal' && (
              <div className="h-full w-full bg-[#0d1117] flex flex-col overflow-hidden">
                {currentHost ? (
                  <Suspense
                    fallback={
                      <div className="p-4 text-xs text-gray-400 flex items-center justify-center h-full">
                        <RefreshCw size={14} className="animate-spin mr-2" />
                        <span>Загрузка встроенного терминала...</span>
                      </div>
                    }
                  >
                    <XTerminal host={currentHost} accentColor={accentColor} />
                  </Suspense>
                ) : (
                  <div className="p-8 text-center text-xs text-gray-400 flex flex-col items-center justify-center h-full space-y-3">
                    <Server size={32} className="text-gray-600 mb-1" />
                    <div className="font-semibold text-gray-300">Нет сохраненных SSH-хостов</div>
                    <div className="text-[11px] text-gray-500 max-w-sm">
                      Добавьте SSH-сервер в настройках Config Studio (раздел «SSH & Хосты»), чтобы подключиться к нему в 1 клик.
                    </div>
                  </div>
                )}
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
                      className={`flex items-start justify-between p-2 rounded-lg cursor-pointer transition border ${
                        iss.severity === 'critical'
                          ? 'bg-red-950/20 border-red-900/40 hover:bg-red-900/30 text-red-200'
                          : 'bg-amber-950/20 border-amber-900/40 hover:bg-amber-900/30 text-amber-200'
                      }`}
                    >
                      <div className="flex items-start space-x-2">
                        <AlertCircle
                          size={14}
                          className={`shrink-0 mt-0.5 ${
                            iss.severity === 'critical' ? 'text-red-400' : 'text-amber-400'
                          }`}
                        />
                        <div>
                          <div className="font-semibold text-xs">{iss.message}</div>
                          {iss.snippet && (
                            <pre className="text-[11px] text-[#8b949e] mt-1 bg-black/40 p-1.5 rounded border border-[#30363d] overflow-x-auto">
                              {iss.snippet}
                            </pre>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 pl-3">
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-black/40 text-cyan-400 border border-[#30363d]">
                          {iss.file}:{iss.line}:{iss.column}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-gray-500 flex flex-col items-center justify-center space-y-1">
                    <AlertCircle size={20} className="text-emerald-500/60" />
                    <span>{t.dockNoProblems}</span>
                  </div>
                )}
              </div>
            )}

            {/* 3. Built-in: Output / Audit Tab */}
            {activePanelId === 'output' && (
              <div className="space-y-1.5 p-2">
                {/* Category Filter Pills */}
                <div className="flex items-center gap-1 pb-1.5 border-b border-[#21262d]/70 overflow-x-auto text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('');
                      loadRecentAudit('');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium ${
                      auditCategory === ''
                        ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                        : 'text-gray-400 hover:text-white bg-white/5'
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
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 ${
                      auditCategory === 'error'
                        ? 'bg-rose-500/25 text-rose-300 border border-rose-500/50'
                        : 'text-gray-400 hover:text-rose-300 bg-white/5'
                    }`}
                  >
                    <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                    <span>{t.auditCatError || 'Ошибки'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('user');
                      loadRecentAudit('user');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 ${
                      auditCategory === 'user'
                        ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50'
                        : 'text-gray-400 hover:text-emerald-300 bg-white/5'
                    }`}
                  >
                    <User className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>{t.auditCatUser || 'Действия'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('network');
                      loadRecentAudit('network');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 ${
                      auditCategory === 'network'
                        ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/50'
                        : 'text-gray-400 hover:text-indigo-300 bg-white/5'
                    }`}
                  >
                    <Globe className="w-3 h-3 text-indigo-400 shrink-0" />
                    <span>{t.auditCatNetwork || 'Сеть'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditCategory('system');
                      loadRecentAudit('system');
                    }}
                    className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 ${
                      auditCategory === 'system'
                        ? 'bg-slate-700/60 text-slate-200 border border-slate-600'
                        : 'text-gray-400 hover:text-slate-300 bg-white/5'
                    }`}
                  >
                    <Cpu className="w-3 h-3 text-slate-300 shrink-0" />
                    <span>{t.auditCatSystem || 'Система'}</span>
                  </button>
                </div>

                {recentAudit.length > 0 ? (
                  recentAudit.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex flex-col py-1 px-2 hover:bg-white/5 rounded text-[11px] text-[#c9d1d9] border-b border-[#21262d]/50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 truncate">
                          <Clock size={11} className="text-[#8b949e] shrink-0" />
                          <span className="text-[#8b949e] shrink-0 font-mono text-[10px]">
                            {new Date(evt.timestamp).toLocaleTimeString()}
                          </span>
                          <span
                            className={`font-semibold px-1 py-0.2 rounded text-[9px] uppercase tracking-wider ${
                              evt.category === 'error' || evt.severity === 'error'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : evt.category === 'network'
                                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                : evt.category === 'system'
                                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            }`}
                          >
                            {evt.category || 'user'}
                          </span>
                          <span
                            className={`font-semibold px-1.5 py-0.2 rounded text-[10px] ${
                              evt.severity === 'error' || evt.severity === 'critical'
                                ? 'bg-rose-900/60 text-rose-200 border border-rose-700'
                                : evt.severity === 'warn'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                            }`}
                          >
                            {evt.action}
                          </span>
                          <span className="font-mono text-gray-200 truncate">{evt.target}</span>
                        </div>
                        <span className="text-[#8b949e] text-[10px] shrink-0 font-mono">
                          {evt.user} {evt.source ? `[${evt.source}]` : ''}
                        </span>
                      </div>
                      {evt.details && Object.keys(evt.details).length > 0 && (
                        <div className="text-[10px] text-gray-400 font-mono pl-6 pt-0.5 truncate">
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
      <div className="min-h-[32px] sm:min-h-[28px] h-8 sm:h-7 px-2 bg-[#161b22] border-t border-[#30363d] flex items-center justify-between text-xs select-none shrink-0 pb-[env(safe-area-inset-bottom)]">
        {/* Left: Tab Buttons */}
        <div className="flex items-center space-x-1 overflow-x-auto custom-scrollbar flex-1 min-w-0 pr-1">
          {/* Built-in: Terminal */}
          <button
            type="button"
            onClick={() => handleTabClick('terminal')}
            className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
              isOpen && activePanelId === 'terminal'
                ? 'bg-accent text-gray-900 shadow-sm'
                : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-white/5'
            }`}
            style={isOpen && activePanelId === 'terminal' ? { backgroundColor: accentColor } : {}}
          >
            <Terminal size={12} />
            <span>{t.dockTerminal || 'Терминал'}</span>
          </button>

          {/* Plugin Tabs (Docker Logs, etc.) */}
          {panels.map((p) => {
            const isActive = isOpen && activePanelId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleTabClick(p.id)}
                className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-accent text-gray-900 shadow-sm'
                    : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-white/5'
                }`}
                style={isActive ? { backgroundColor: accentColor } : {}}
              >
                <Terminal size={12} />
                <span>{p.title}</span>
                {p.badge && (
                  <span className="px-1 py-0.2 rounded text-[9px] bg-black/40 text-white font-mono">
                    {p.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Built-in: Output */}
          <button
            type="button"
            onClick={() => handleTabClick('output')}
            className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
              isOpen && activePanelId === 'output'
                ? 'bg-accent text-gray-900 shadow-sm'
                : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-white/5'
            }`}
            style={isOpen && activePanelId === 'output' ? { backgroundColor: accentColor } : {}}
          >
            <FileText size={12} />
            <span>{t.dockOutput}</span>
          </button>

          {/* Built-in: Problems (Shows red badge when syntax error occurs) */}
          <button
            type="button"
            onClick={() => handleTabClick('problems')}
            className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
              isOpen && activePanelId === 'problems'
                ? 'bg-accent text-gray-900 shadow-sm'
                : criticalIssuesCount > 0
                ? 'text-red-400 bg-red-950/40 border border-red-800/40'
                : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-white/5'
            }`}
            style={isOpen && activePanelId === 'problems' ? { backgroundColor: accentColor } : {}}
          >
            <AlertCircle size={12} className={criticalIssuesCount > 0 ? 'text-red-400 animate-pulse' : ''} />
            <span>{t.dockProblems}</span>
            {criticalIssuesCount > 0 && (
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold rounded-full bg-red-600 text-white">
                {criticalIssuesCount}
              </span>
            )}
          </button>
        </div>

        {/* Right: SysInfo & File Status & Hotkey Hint */}
        <div className="flex items-center space-x-2.5 sm:space-x-3 text-[11px] text-[#8b949e] font-mono shrink-0 pl-2">
          {/* SysInfo Hardware Telemetry (CPU / RAM / Disks / Uptime) */}
          <SysInfoBar language={language} accentColor={accentColor} />

          {currentFile && (
            <>
              <span className="hidden sm:inline text-gray-600">|</span>
              <span>
                Ln {cursorPos.line}, Col {cursorPos.col}
              </span>
              <span className="hidden sm:inline">UTF-8</span>
              <span className="hidden sm:inline">Spaces: 2</span>
            </>
          )}
          <button
            type="button"
            onClick={() => onToggleOpen(!isOpen)}
            className="flex items-center space-x-1 text-[10px] text-gray-400 hover:text-white transition"
            title={t.dockToggleTooltip}
          >
            <span>Ctrl+~</span>
            {isOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BottomDockStrip;
