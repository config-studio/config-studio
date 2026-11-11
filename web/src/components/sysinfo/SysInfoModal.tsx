import React from 'react';
import {
  X,
  RefreshCw,
  Cpu,
  Layers,
  HardDrive,
  Clock,
  Server,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { SysInfoState, formatBytes, formatUptime, getLoadStatus } from '../../services/sysinfo';
import { translations } from '../../utils/i18n';

interface SysInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: SysInfoState;
  onRefresh: () => void;
  language?: string;
  accentColor?: string;
}

export const SysInfoModal: React.FC<SysInfoModalProps> = ({
  isOpen,
  onClose,
  state,
  onRefresh,
  language = 'ru',
  accentColor = '#00d2b4',
}) => {
  if (!isOpen) return null;

  const t = (translations as any)[language] || translations.ru;
  const { metrics, loading, error, activeNodeName } = state;

  const getBarColor = (pct: number) => {
    const status = getLoadStatus(pct);
    if (status === 'critical') return 'bg-rose-500';
    if (status === 'warning') return 'bg-amber-400';
    return 'bg-emerald-500';
  };

  const getTextColor = (pct: number) => {
    const status = getLoadStatus(pct);
    if (status === 'critical') return 'text-rose-400';
    if (status === 'warning') return 'text-amber-400';
    return 'text-emerald-400';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-xl bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden flex flex-col text-sm text-[#c9d1d9]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#0d1117] border-b border-[#30363d] flex items-center justify-between">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Server size={16} />
            </div>
            <div className="truncate">
              <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                <span>{t.sysinfoTitle || 'Мониторинг узла'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-white/10 text-emerald-400 font-normal">
                  {activeNodeName}
                </span>
              </h3>
              {metrics && (
                <p className="text-[11px] text-[#8b949e] font-mono mt-0.5">
                  {metrics.hostname} • {metrics.os}/{metrics.arch} • {metrics.numCpu} {t.sysinfoCores || 'cores'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 rounded-md text-[#8b949e] hover:text-white hover:bg-white/5 transition disabled:opacity-50"
              title={t.sysinfoRefresh || 'Обновить'}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-emerald-400' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-[#8b949e] hover:text-white hover:bg-white/5 transition"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start space-x-2 text-rose-900 dark:text-rose-200 text-xs">
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="font-semibold">{t.sysinfoOffline || 'Узел недоступен'}</p>
                <p className="text-[11px] opacity-90 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {metrics ? (
            <>
              {/* Top Row: CPU & RAM Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* CPU Card */}
                <div className="p-3.5 rounded-lg bg-[#0d1117]/80 border border-[#30363d] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center space-x-1.5 text-[#8b949e]">
                      <Cpu size={14} className="text-blue-400" />
                      <span>{t.sysinfoCpu || 'ЦП (CPU)'}</span>
                    </span>
                    <span className={`font-mono font-bold ${getTextColor(metrics.cpuPercent ?? 0)}`}>
                      {(metrics.cpuPercent ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-[#21262d] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${getBarColor(metrics.cpuPercent ?? 0)}`}
                      style={{ width: `${Math.min(100, Math.max(0, metrics.cpuPercent ?? 0))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#8b949e] font-mono pt-0.5">
                    <span>Load Avg (1m, 5m, 15m):</span>
                    <span className="text-gray-300">{(metrics.loadAvg || []).map((l) => (l ?? 0).toFixed(2)).join(', ') || 'N/A'}</span>
                  </div>
                </div>

                {/* RAM Card */}
                <div className="p-3.5 rounded-lg bg-[#0d1117]/80 border border-[#30363d] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center space-x-1.5 text-[#8b949e]">
                      <Layers size={14} className="text-purple-400" />
                      <span>{t.sysinfoRam || 'ОЗУ (RAM)'}</span>
                    </span>
                    <span className={`font-mono font-bold ${getTextColor(metrics.memory?.usedPercent ?? 0)}`}>
                      {(metrics.memory?.usedPercent ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-[#21262d] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${getBarColor(metrics.memory?.usedPercent ?? 0)}`}
                      style={{ width: `${Math.min(100, Math.max(0, metrics.memory?.usedPercent ?? 0))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#8b949e] font-mono pt-0.5">
                    <span>{formatBytes(metrics.memory?.usedBytes ?? 0)} / {formatBytes(metrics.memory?.totalBytes ?? 0)}</span>
                    <span className="text-emerald-400">{formatBytes(metrics.memory?.availableBytes ?? 0)} {t.sysinfoFree || 'free'}</span>
                  </div>
                </div>
              </div>

              {/* Uptime Banner */}
              <div className="p-3 rounded-lg bg-[#0d1117]/60 border border-[#30363d] flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2 text-[#8b949e]">
                  <Clock size={14} className="text-emerald-400" />
                  <span>{t.sysinfoUptime || 'Время непрерывной работы (Uptime)'}:</span>
                </div>
                <div className="font-mono font-bold text-white flex items-center space-x-1.5">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  <span>{formatUptime(metrics.uptimeSec)}</span>
                </div>
              </div>

              {/* Disks Partition Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-300 px-0.5">
                  <span className="flex items-center space-x-1.5">
                    <HardDrive size={14} className="text-cyan-400" />
                    <span>{t.sysinfoDisk || 'Дисковые накопители'}</span>
                  </span>
                  <span className="text-[11px] font-mono text-[#8b949e]">
                    {(metrics.disks || []).length} {(metrics.disks || []).length === 1 ? 'mount' : 'mounts'}
                  </span>
                </div>

                <div className="space-y-2">
                  {(metrics.disks || []).map((d, idx) => (
                    <div
                      key={d.mountPoint || idx}
                      className="p-3 rounded-lg bg-[#0d1117]/80 border border-[#30363d] space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-bold text-gray-200">{d.mountPoint}</span>
                        <span className={`font-semibold ${getTextColor(d.usedPercent ?? 0)}`}>
                          {(d.usedPercent ?? 0).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-[#21262d] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${getBarColor(d.usedPercent ?? 0)}`}
                          style={{ width: `${Math.min(100, Math.max(0, d.usedPercent ?? 0))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-[#8b949e] font-mono">
                        <span>{formatBytes(d.usedBytes)} {t.sysinfoUsed || 'used'}</span>
                        <span className="text-gray-300">
                          {formatBytes(d.availableBytes)} {t.sysinfoFree || 'free'} / {formatBytes(d.totalBytes)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-[#8b949e] text-xs">
              {loading ? (
                <div className="flex flex-col items-center space-y-2">
                  <RefreshCw size={20} className="animate-spin text-emerald-400" />
                  <span>Опрос метрик узла...</span>
                </div>
              ) : (
                <span>Нет данных телеметрии</span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#0d1117] border-t border-[#30363d] flex items-center justify-between text-[11px] text-[#8b949e] font-mono">
          <span>
            {state.lastUpdated ? `Обновлено: ${state.lastUpdated.toLocaleTimeString()}` : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md text-xs font-medium text-white transition hover:opacity-90 cursor-pointer"
            style={{ backgroundColor: accentColor }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
