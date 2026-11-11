import React, { useState, useEffect } from 'react';
import { Cpu, Layers, HardDrive, Clock, Server, AlertCircle } from 'lucide-react';
import { sysinfoService, SysInfoState, formatBytes, formatUptime, getLoadStatus } from '../../services/sysinfo';
import { SysInfoModal } from './SysInfoModal';
import { translations } from '../../utils/i18n';

interface SysInfoBarProps {
  language?: string;
  accentColor?: string;
}

export const SysInfoBar: React.FC<SysInfoBarProps> = ({
  language = 'ru',
  accentColor = '#00d2b4',
}) => {
  const [state, setState] = useState<SysInfoState>(() => sysinfoService.getState());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const t = (translations as any)[language] || translations.ru;

  useEffect(() => {
    return sysinfoService.subscribe((updated) => {
      setState(updated);
    });
  }, []);

  const { metrics, loading, error, activeNodeName } = state;

  const getBadgeColor = (pct: number) => {
    const status = getLoadStatus(pct);
    if (status === 'critical') return 'text-rose-600 dark:text-rose-400 font-bold';
    if (status === 'warning') return 'text-amber-600 dark:text-amber-400 font-semibold';
    return 'text-[var(--text-secondary)] hover:text-emerald-600 dark:hover:text-emerald-400';
  };

  const primaryDisk = metrics && metrics.disks && metrics.disks.length > 0 ? metrics.disks[0] : null;

  return (
    <>
      <div
        onClick={() => setIsModalOpen(true)}
        className="flex items-center space-x-2.5 px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition hover:bg-black/5 dark:hover:bg-white/5 border border-transparent hover:border-base-border select-none shrink-0"
        title="Нажмите для подробного мониторинга аппаратных ресурсов (CPU, RAM, Uptime, Disks)"
      >
        {/* Node Name & Health Dot */}
        <div className="flex items-center space-x-1.5 text-[var(--text-primary)]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              error ? 'bg-rose-500 animate-pulse' : metrics ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span className="max-w-[80px] sm:max-w-[120px] truncate text-[11px] font-semibold text-[var(--text-primary)]">
            {activeNodeName}
          </span>
        </div>

        {error ? (
          <div className="flex items-center space-x-1 text-rose-600 dark:text-rose-400 text-[10px]">
            <AlertCircle size={11} />
            <span className="hidden sm:inline">Offline</span>
          </div>
        ) : metrics ? (
          <>
            {/* CPU */}
            <div className={`flex items-center space-x-1 ${getBadgeColor(metrics.cpuPercent ?? 0)}`}>
              <Cpu size={12} className="shrink-0 text-blue-600 dark:text-blue-400" />
              <span>{(metrics.cpuPercent ?? 0).toFixed(0)}%</span>
            </div>

            {/* RAM */}
            <div
              className={`flex items-center space-x-1 ${getBadgeColor(metrics.memory?.usedPercent ?? 0)}`}
              title={`RAM: ${formatBytes(metrics.memory?.usedBytes ?? 0)} / ${formatBytes(metrics.memory?.totalBytes ?? 0)}`}
            >
              <Layers size={12} className="shrink-0 text-purple-600 dark:text-purple-400" />
              <span>{(metrics.memory?.usedPercent ?? 0).toFixed(0)}%</span>
            </div>

            {/* Disk */}
            {primaryDisk && (
              <div
                className={`hidden md:flex items-center space-x-1 ${getBadgeColor(primaryDisk.usedPercent ?? 0)}`}
                title={`Disk ${primaryDisk.mountPoint || ''}: ${formatBytes(primaryDisk.availableBytes ?? 0)} free`}
              >
                <HardDrive size={12} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
                <span>{formatBytes(primaryDisk.availableBytes ?? 0)}</span>
              </div>
            )}

            {/* Uptime */}
            <div
              className="hidden lg:flex items-center space-x-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title={`Uptime: ${metrics.uptimeSec ?? 0}s`}
            >
              <Clock size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{formatUptime(metrics.uptimeSec ?? 0)}</span>
            </div>
          </>
        ) : (
          <div className="text-[10px] text-[var(--text-muted)] flex items-center space-x-1">
            <Server size={11} className={loading ? 'animate-pulse text-emerald-500' : ''} />
            <span>SysInfo...</span>
          </div>
        )}
      </div>

      {/* Detail Popover / Modal */}
      <SysInfoModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        state={state}
        onRefresh={() => sysinfoService.refresh()}
        language={language}
        accentColor={accentColor}
      />
    </>
  );
};
