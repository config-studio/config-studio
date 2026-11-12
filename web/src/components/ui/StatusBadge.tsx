import React from 'react';
import { Check, AlertTriangle, AlertCircle, Info, ShieldAlert } from 'lucide-react';
import { StatusDot, StatusDotType } from './StatusDot';

export type StatusBadgeVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'critical'
  | 'info'
  | 'accent'
  | 'neutral';

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: StatusBadgeVariant;
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean | StatusDotType;
  icon?: React.ReactNode;
  count?: number | string;
  className?: string;
  children?: React.ReactNode;
}

const variantStyles: Record<StatusBadgeVariant, string> = {
  success:
    'bg-emerald-500/10 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30',
  warning:
    'bg-amber-500/10 text-amber-900 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',
  error:
    'bg-rose-500/10 text-rose-800 border-rose-300 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30',
  critical:
    'bg-red-500/15 text-red-900 border-red-400 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40',
  info:
    'bg-blue-500/10 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30',
  accent:
    'bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent border-accent/30',
  neutral:
    'bg-slate-100 text-slate-700 border-slate-300 dark:bg-gray-500/15 dark:text-gray-400 dark:border-gray-500/30',
};

const sizeStyles = {
  xs: 'px-1.5 py-0.2 text-[9px] rounded-md gap-1',
  sm: 'px-2 py-0.5 text-[10px] rounded-md gap-1.5',
  md: 'px-2.5 py-1 text-xs rounded-lg gap-2',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status = 'neutral',
  size = 'sm',
  dot = false,
  icon,
  count,
  className = '',
  children,
  ...props
}) => {
  // Determine dot status if dot is boolean true
  let dotStatus: StatusDotType | undefined;
  if (typeof dot === 'string') {
    dotStatus = dot;
  } else if (dot) {
    if (status === 'success') dotStatus = 'online';
    else if (status === 'warning') dotStatus = 'warning';
    else if (status === 'error' || status === 'critical') dotStatus = 'error';
    else dotStatus = 'neutral';
  }

  return (
    <span
      className={`inline-flex items-center font-mono font-medium border select-none shrink-0 transition-colors ${variantStyles[status]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {dotStatus && <StatusDot status={dotStatus} size="xs" />}
      {icon && <span className="shrink-0">{icon}</span>}
      {children && <span className="truncate">{children}</span>}
      {count !== undefined && count !== null && (
        <span className="font-bold opacity-90">({count})</span>
      )}
    </span>
  );
};

export interface DiagnosticsCountBadgeProps {
  errors: number;
  warnings: number;
  errorsLabel?: string;
  warningsLabel?: string;
  className?: string;
}

function getPluralText(count: number, label?: string, type: 'error' | 'warning' = 'error'): string {
  if (label && label !== 'ошибок' && label !== 'предупреждений' && label !== 'errors' && label !== 'warnings') {
    return `${count} ${label}`;
  }
  if (label === 'errors' || label === 'warnings') {
    const word = type === 'error' ? (count === 1 ? 'error' : 'errors') : (count === 1 ? 'warning' : 'warnings');
    return `${count} ${word}`;
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  let form: string;
  if (type === 'error') {
    if (mod100 >= 11 && mod100 <= 19) form = 'ошибок';
    else if (mod10 === 1) form = 'ошибка';
    else if (mod10 >= 2 && mod10 <= 4) form = 'ошибки';
    else form = 'ошибок';
  } else {
    if (mod100 >= 11 && mod100 <= 19) form = 'предупреждений';
    else if (mod10 === 1) form = 'предупреждение';
    else if (mod10 >= 2 && mod10 <= 4) form = 'предупреждения';
    else form = 'предупреждений';
  }
  return `${count} ${form}`;
}

/**
 * DiagnosticsCountBadge: Dedicated badge for syntax and guard diagnostics count.
 * Solves the issue where 0 errors / 0 warnings was displayed inside a red error badge,
 * and ensures accurate grammatical declension for Russian and English.
 */
export const DiagnosticsCountBadge: React.FC<DiagnosticsCountBadgeProps> = ({
  errors,
  warnings,
  errorsLabel = 'ошибок',
  warningsLabel = 'предупреждений',
  className = '',
}) => {
  const isHealthy = errors === 0 && warnings === 0;
  const hasErrors = errors > 0;
  const hasOnlyWarnings = errors === 0 && warnings > 0;

  let status: StatusBadgeVariant = 'success';
  let Icon = Check;

  if (hasErrors) {
    status = 'error';
    Icon = AlertCircle;
  } else if (hasOnlyWarnings) {
    status = 'warning';
    Icon = AlertTriangle;
  }

  const errorsText = getPluralText(errors, errorsLabel, 'error');
  const warningsText = getPluralText(warnings, warningsLabel, 'warning');

  return (
    <StatusBadge
      status={status}
      size="sm"
      icon={<Icon size={11} className="shrink-0" />}
      className={className}
    >
      {errorsText}, {warningsText}
    </StatusBadge>
  );
};
