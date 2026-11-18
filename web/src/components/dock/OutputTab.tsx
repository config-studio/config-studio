import React from 'react';
import { Clock, AlertCircle, User, Globe, Cpu } from 'lucide-react';
import { AuditEvent } from '../../types';
import { Badge } from '../ui';

export interface OutputTabProps {
  recentAudit: AuditEvent[];
  auditCategory: string;
  onCategoryChange: (cat: string) => void;
  emptyText?: string;
}

export const OutputTab: React.FC<OutputTabProps> = ({
  recentAudit,
  auditCategory,
  onCategoryChange,
  emptyText = 'Нет событий аудита',
}) => {
  return (
    <div className="space-y-1.5 p-2 font-mono text-xs">
      {/* Category Filter Pills */}
      <div className="flex items-center gap-1 pb-1.5 border-b border-base-border overflow-x-auto text-[11px] no-scrollbar">
        <button
          type="button"
          onClick={() => onCategoryChange('')}
          className={`px-2 py-0.5 rounded transition font-medium cursor-pointer ${
            auditCategory === ''
              ? 'bg-accent/15 text-accent border border-accent/40 font-semibold'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          Все
        </button>
        <button
          type="button"
          onClick={() => onCategoryChange('error')}
          className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
            auditCategory === 'error'
              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 font-semibold'
              : 'text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-500/5'
          }`}
        >
          <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
          <span>Ошибки</span>
        </button>
        <button
          type="button"
          onClick={() => onCategoryChange('user')}
          className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
            auditCategory === 'user'
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
              : 'text-[var(--text-muted)] hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-500/5'
          }`}
        >
          <User className="w-3 h-3 text-emerald-500 shrink-0" />
          <span>Действия</span>
        </button>
        <button
          type="button"
          onClick={() => onCategoryChange('network')}
          className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
            auditCategory === 'network'
              ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40 font-semibold'
              : 'text-[var(--text-muted)] hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-500/5'
          }`}
        >
          <Globe className="w-3 h-3 text-indigo-500 shrink-0" />
          <span>Сеть</span>
        </button>
        <button
          type="button"
          onClick={() => onCategoryChange('system')}
          className={`px-2 py-0.5 rounded transition font-medium flex items-center space-x-1 cursor-pointer ${
            auditCategory === 'system'
              ? 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/40 font-semibold'
              : 'text-[var(--text-muted)] hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-500/5'
          }`}
        >
          <Cpu className="w-3 h-3 text-slate-500 shrink-0" />
          <span>Система</span>
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
          <span>{emptyText}</span>
        </div>
      )}
    </div>
  );
};
