import React from 'react';
import { StatusBadge, StatusBadgeVariant } from './StatusBadge';
import { StatusDot, StatusDotType } from './StatusDot';

export interface StatusCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  status?: StatusBadgeVariant;
  statusDot?: StatusDotType;
  statusLabel?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  interactive?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const statusBorders: Record<StatusBadgeVariant, string> = {
  success: 'hover:border-emerald-500/40',
  warning: 'hover:border-amber-500/40',
  error: 'hover:border-rose-500/40',
  critical: 'hover:border-red-500/50',
  info: 'hover:border-blue-500/40',
  accent: 'hover:border-accent/40',
  neutral: 'hover:border-gray-400 dark:hover:border-gray-500',
};

export const StatusCard: React.FC<StatusCardProps> = ({
  status = 'neutral',
  statusDot,
  statusLabel,
  icon,
  title,
  subtitle,
  actions,
  interactive = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <div
      className={`bg-base-surface border border-base-border rounded-2xl p-4 transition-all ${
        interactive
          ? `cursor-pointer active:scale-[0.99] ${statusBorders[status]}`
          : ''
      } ${className}`}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start space-x-3 min-w-0">
          {icon && (
            <div className="p-2 rounded-xl bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] shrink-0 mt-0.5">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              {statusDot && <StatusDot status={statusDot} size="sm" />}
              <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                {title}
              </div>
              {statusLabel && (
                <StatusBadge status={status} size="xs">
                  {statusLabel}
                </StatusBadge>
              )}
            </div>
            {subtitle && (
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
                {subtitle}
              </div>
            )}
          </div>
        </div>

        {actions && <div className="flex items-center space-x-1.5 shrink-0">{actions}</div>}
      </div>

      {children && <div className="mt-3 pt-3 border-t border-base-border/50">{children}</div>}
    </div>
  );
};
