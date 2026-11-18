import React from 'react';
import { Server, Edit2, Trash2, Terminal, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { SSHHost } from '../../../types';
import { Badge, StatusBadge, Button } from '../../ui';

interface HostCardProps {
  host: SSHHost;
  isTesting: boolean;
  testResult?: { id: string; success: boolean; latencyMs?: number; error?: string } | null;
  onTest: (host: SSHHost) => void;
  onEdit: (host: SSHHost) => void;
  onDelete: (host: SSHHost) => void;
  onOpenTerminal?: (host: SSHHost) => void;
}

export const HostCard: React.FC<HostCardProps> = ({
  host,
  isTesting,
  testResult,
  onTest,
  onEdit,
  onDelete,
  onOpenTerminal,
}) => {
  return (
    <div
      key={host.id}
      className="p-3.5 bg-base-surface rounded-xl border border-base-border flex items-center justify-between hover:border-base-border transition"
    >
      <div className="flex items-center space-x-3 min-w-0">
        <div className="p-2 rounded-lg bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] shrink-0">
          <Server size={16} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {host.name || host.host}
            </span>
            <Badge variant="neutral" size="xs" className="font-mono">
              {host.user}@{host.host}:{host.port || 22}
            </Badge>
            <Badge
              variant={host.authType === 'vault' ? 'accent' : 'info'}
              size="xs"
              className="uppercase font-mono font-bold tracking-wider"
            >
              {host.authType}
            </Badge>
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
            Путь: {host.defaultPath || '/etc'}
          </div>
        </div>
      </div>

      {/* Status / Test result & Actions */}
      <div className="flex items-center space-x-2">
        {testResult && (
          <StatusBadge
            status={testResult.success ? 'success' : 'error'}
            size="sm"
            icon={testResult.success ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
            title={testResult.error}
          >
            {testResult.success ? `OK (${testResult.latencyMs}мс)` : 'Ошибка'}
          </StatusBadge>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onTest(host)}
          disabled={isTesting}
          icon={<RefreshCw size={12} className={isTesting ? 'animate-spin text-accent' : ''} />}
          title="Проверить SSH-соединение"
        >
          {isTesting ? 'Проверка...' : 'Тест'}
        </Button>

        {onOpenTerminal && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenTerminal(host)}
            icon={<Terminal size={12} className="text-accent" />}
            title="Открыть Web-терминал"
          >
            Терминал
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onEdit(host)}
          icon={<Edit2 size={12} />}
          title="Редактировать"
        />

        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => onDelete(host)}
          icon={<Trash2 size={12} />}
          title="Удалить хост"
        />
      </div>
    </div>
  );
};
