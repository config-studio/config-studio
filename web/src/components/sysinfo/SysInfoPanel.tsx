import React from 'react';
import {
  Cpu,
  Layers,
  HardDrive,
  Clock,
  Server,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { SysInfoState, formatBytes, formatUptime, getLoadStatus } from '../../services/sysinfo';
import { translations } from '../../utils/i18n';

interface SysInfoPanelProps {
  state: SysInfoState;
  onRefresh?: () => void;
  language?: string;
  accentColor?: string;
  showHeader?: boolean;
}

export const SysInfoPanel: React.FC<SysInfoPanelProps> = ({
  state,
  onRefresh,
  language = 'ru',
  accentColor = '#00d2b4',
  showHeader = false,
}) => {
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
    <div className="space-y-3.5 max-w-4xl mx-auto text-xs text-[var(--text-primary)]">
      {showHeader && (
        <div className="flex items-center justify-between pb-2 border-b border-base-border">
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded-md bg-emerald-500/10 text-emerald-500">
              <Server size={14} />
            </div>
            <div>
              <span className="font-semibold">{t.sysinfoTitle || 'Мониторинг узла'}</span>
              <span className="ml-2 font-mono text-[11px] text-[var(--text-muted)]">
                {activeNodeName}
              </span>
            </div>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="p-1 rounded hover:bg-base-surface-hover/80 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
              title={t.sysinfoRefresh || 'Обновить'}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-emerald-500' : ''} />
            </button>
          )}
        </div>
      )}

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
            <div className="p-3.5 rounded-xl bg-base-surface/80 border border-base-border space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center space-x-1.5 text-[var(--text-muted)]">
                  <Cpu size={14} className="text-blue-500 dark:text-blue-400" />
                  <span>{t.sysinfoCpu || 'ЦП (CPU)'}</span>
                </span>
                <span className={`font-mono font-bold ${getTextColor(metrics.cpuPercent ?? 0)}`}>
                  {(metrics.cpuPercent ?? 0).toFixed(1)}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getBarColor(metrics.cpuPercent ?? 0)}`}
                  style={{ width: `${Math.min(100, Math.max(0, metrics.cpuPercent ?? 0))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono pt-0.5">
                <span>Load Avg (1m, 5m, 15m):</span>
                <span className="text-[var(--text-secondary)] font-medium">
                  {(metrics.loadAvg || []).map((l) => (l ?? 0).toFixed(2)).join(', ') || 'N/A'}
                </span>
              </div>
            </div>

            {/* RAM Card */}
            <div className="p-3.5 rounded-xl bg-base-surface/80 border border-base-border space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center space-x-1.5 text-[var(--text-muted)]">
                  <Layers size={14} className="text-purple-500 dark:text-purple-400" />
                  <span>{t.sysinfoRam || 'ОЗУ (RAM)'}</span>
                </span>
                <span className={`font-mono font-bold ${getTextColor(metrics.memory?.usedPercent ?? 0)}`}>
                  {(metrics.memory?.usedPercent ?? 0).toFixed(1)}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getBarColor(metrics.memory?.usedPercent ?? 0)}`}
                  style={{ width: `${Math.min(100, Math.max(0, metrics.memory?.usedPercent ?? 0))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono pt-0.5">
                <span>
                  {formatBytes(metrics.memory?.usedBytes ?? 0)} / {formatBytes(metrics.memory?.totalBytes ?? 0)}
                </span>
                <span className="text-emerald-500 font-medium">
                  {formatBytes(metrics.memory?.availableBytes ?? 0)} {t.sysinfoFree || 'free'}
                </span>
              </div>
            </div>
          </div>

          {/* Uptime Banner */}
          <div className="p-3 rounded-xl bg-base-surface/80 border border-base-border flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2 text-[var(--text-muted)]">
              <Clock size={14} className="text-emerald-500" />
              <span>{t.sysinfoUptime || 'Время непрерывной работы (Uptime)'}:</span>
            </div>
            <div className="font-mono font-bold text-[var(--text-primary)] flex items-center space-x-1.5">
              <CheckCircle2 size={13} className="text-emerald-500" />
              <span>{formatUptime(metrics.uptimeSec)}</span>
            </div>
          </div>

          {/* Disks Partition Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-primary)] px-0.5">
              <span className="flex items-center space-x-1.5">
                <HardDrive size={14} className="text-cyan-500" />
                <span>{t.sysinfoDisk || 'Дисковые накопители'}</span>
              </span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                {(metrics.disks || []).length} {(metrics.disks || []).length === 1 ? 'mount' : 'mounts'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(metrics.disks || []).map((d, idx) => (
                <div
                  key={d.mountPoint || idx}
                  className="p-3 rounded-xl bg-base-surface/80 border border-base-border space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-[var(--text-primary)]">{d.mountPoint}</span>
                    <span className={`font-semibold ${getTextColor(d.usedPercent ?? 0)}`}>
                      {(d.usedPercent ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${getBarColor(d.usedPercent ?? 0)}`}
                      style={{ width: `${Math.min(100, Math.max(0, d.usedPercent ?? 0))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono">
                    <span>{formatBytes(d.usedBytes)} {t.sysinfoUsed || 'used'}</span>
                    <span className="text-[var(--text-secondary)] font-medium">
                      {formatBytes(d.availableBytes)} {t.sysinfoFree || 'free'} / {formatBytes(d.totalBytes)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="py-10 text-center text-[var(--text-muted)] text-xs">
          {loading ? (
            <div className="flex flex-col items-center space-y-2">
              <RefreshCw size={20} className="animate-spin text-emerald-500" />
              <span>Опрос метрик узла...</span>
            </div>
          ) : (
            <span>Нет данных телеметрии</span>
          )}
        </div>
      )}
    </div>
  );
};
