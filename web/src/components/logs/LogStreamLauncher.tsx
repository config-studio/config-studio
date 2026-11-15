import React, { useState } from 'react';
import {
  FileText,
  Play,
  Server,
  Layers,
  Shield,
  Activity,
  Terminal,
  ChevronRight,
  HardDrive,
} from 'lucide-react';
import { SSHHost } from '../../types';
import { Dropdown, DropdownOption, Input, Checkbox, Button, Card } from '@config-studio/ui';

export interface LogStreamLauncherProps {
  hosts: SSHHost[];
  onStartStream: (opts: { cmd: string; source: string; hostId?: string; sudo?: boolean; title?: string }) => void;
  accentColor?: string;
}

export const LogStreamLauncher: React.FC<LogStreamLauncherProps> = ({
  hosts,
  onStartStream,
  accentColor = '#00d2b4',
}) => {
  const [selectedHostId, setSelectedHostId] = useState<string>('localhost');
  const [customCmd, setCustomCmd] = useState('');
  const [customSource, setCustomSource] = useState('custom');
  const [useSudo, setUseSudo] = useState(false);

  const hostOptions: DropdownOption[] = [
    {
      value: 'localhost',
      label: 'Localhost (Локальная ОС)',
      subtitle: 'Локальные команды и контейнеры',
      badge: 'LOCAL',
      badgeColor: 'blue',
      statusDot: 'online',
    },
    ...hosts.map((h) => ({
      value: h.id,
      label: h.name || h.host,
      subtitle: `${h.user}@${h.host}:${h.port || 22}`,
      badge: 'SSH',
      badgeColor: 'purple' as const,
      statusDot: 'online' as const,
    })),
  ];

  const presets = [
    {
      id: 'docker',
      title: 'Docker Compose',
      desc: 'docker compose logs -f --tail=100',
      cmd: 'docker compose logs -f --tail=100',
      source: 'docker',
      icon: <Layers className="w-5 h-5 text-sky-400" />,
      color: 'border-sky-500/30 hover:border-sky-500/60 bg-sky-500/5',
    },
    {
      id: 'journal',
      title: 'Systemd Journal',
      desc: 'journalctl -f -n 100 --no-pager',
      cmd: 'journalctl -f -n 100 --no-pager',
      source: 'journal',
      icon: <Activity className="w-5 h-5 text-emerald-400" />,
      color: 'border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/5',
    },
    {
      id: 'syslog',
      title: 'Системный лог (/var/log/syslog)',
      desc: 'tail -f -n 100 /var/log/syslog',
      cmd: 'tail -f -n 100 /var/log/syslog',
      source: 'syslog',
      icon: <FileText className="w-5 h-5 text-amber-400" />,
      color: 'border-amber-500/30 hover:border-amber-500/60 bg-amber-500/5',
    },
    {
      id: 'dmesg',
      title: 'Логи ядра Linux (dmesg)',
      desc: 'dmesg -w --color=never',
      cmd: 'dmesg -w --color=never',
      source: 'kernel',
      icon: <Shield className="w-5 h-5 text-purple-400" />,
      color: 'border-purple-500/30 hover:border-purple-500/60 bg-purple-500/5',
    },
  ];

  const handleLaunchPreset = (preset: (typeof presets)[0]) => {
    onStartStream({
      cmd: preset.cmd,
      source: preset.source,
      hostId: selectedHostId === 'localhost' ? undefined : selectedHostId,
      sudo: useSudo,
      title: `${preset.title} (${selectedHostId === 'localhost' ? 'local' : selectedHostId})`,
    });
  };

  const handleLaunchCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = customCmd.trim();
    if (!cmd) return;

    onStartStream({
      cmd,
      source: customSource.trim() || 'custom',
      hostId: selectedHostId === 'localhost' ? undefined : selectedHostId,
      sudo: useSudo,
      title: `${customSource || 'log'} (${selectedHostId === 'localhost' ? 'local' : selectedHostId})`,
    });
  };

  return (
    <div className="h-full w-full overflow-y-auto p-4 sm:p-6 bg-base flex flex-col max-w-4xl mx-auto select-none">
      {/* Header */}
      <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-base-border">
        <div className="p-2.5 rounded-xl bg-accent/15 border border-accent/30 text-accent shrink-0">
          <Terminal size={22} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Потоковый мониторинг логов (Log Streaming)</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/20 text-accent font-mono font-semibold">
              SSE v2.3.5
            </span>
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Структурированный сбор логов без ANSI-мусора с фильтрацией по уровням и мгновенным поиском
          </p>
        </div>
      </div>

      {/* Target Host Selector */}
      <div className="mb-6 p-3.5 rounded-xl bg-[var(--bg-surface)] border border-base-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[var(--text-primary)] font-medium">
          <Server size={15} className="text-accent shrink-0" />
          <span>Целевой хост для стриминга:</span>
        </div>
        <div className="w-full sm:w-[280px]">
          <Dropdown
            options={hostOptions}
            value={selectedHostId}
            onChange={(val) => setSelectedHostId(String(val))}
            size="sm"
          />
        </div>
      </div>

      {/* Quick Presets Grid */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          Быстрые пресеты
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleLaunchPreset(p)}
              className={`p-3.5 rounded-xl border text-left transition flex items-start justify-between cursor-pointer group ${p.color}`}
            >
              <div className="flex items-start space-x-3 min-w-0">
                <div className="shrink-0 mt-0.5">{p.icon}</div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-accent transition">
                    {p.title}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--text-muted)] truncate mt-1">
                    {p.desc}
                  </div>
                </div>
              </div>
              <ChevronRight
                size={14}
                className="text-[var(--text-muted)] group-hover:text-accent group-hover:translate-x-0.5 transition shrink-0 ml-2 mt-1"
              />
            </button>
          ))}
        </div>
      </div>

      {/* Custom Command Form */}
      <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-base-border">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Terminal size={14} className="text-accent" />
          <span>Пользовательская команда стриминга</span>
        </h3>
        <form onSubmit={handleLaunchCustom} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="sm:col-span-3">
              <Input
                value={customCmd}
                onChange={(e) => setCustomCmd(e.target.value)}
                placeholder="Например: docker logs -f my-app или tail -f /var/log/nginx/access.log"
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Input
                value={customSource}
                onChange={(e) => setCustomSource(e.target.value)}
                placeholder="Тег источника (nginx)"
                className="text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Checkbox
              checked={useSudo}
              onChange={setUseSudo}
              label="Запуск через sudo (привилегированные логи)"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!customCmd.trim()}
              icon={<Play size={12} />}
            >
              Запустить стрим
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
