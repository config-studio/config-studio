import React from 'react';
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';

export type CalloutVariant =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'critical'
  | 'accent'
  | 'neutral';

export interface CalloutProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: CalloutVariant;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  onClose?: () => void;
  className?: string;
  children?: React.ReactNode;
}

const variantStyles: Record<CalloutVariant, { container: string; title: string; body: string; icon: string }> = {
  info: {
    container: 'bg-blue-500/10 border-blue-500/30',
    title: 'text-blue-950 dark:text-blue-100 font-semibold',
    body: 'text-blue-900/90 dark:text-blue-200/90',
    icon: 'text-blue-600 dark:text-blue-400',
  },
  success: {
    container: 'bg-emerald-500/10 border-emerald-500/30',
    title: 'text-emerald-950 dark:text-emerald-100 font-semibold',
    body: 'text-emerald-900/90 dark:text-emerald-200/90',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    container: 'bg-amber-500/10 border-amber-500/30',
    title: 'text-amber-950 dark:text-amber-100 font-semibold',
    body: 'text-amber-900/90 dark:text-amber-200/90',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  error: {
    container: 'bg-rose-500/10 border-rose-500/30',
    title: 'text-rose-950 dark:text-rose-100 font-semibold',
    body: 'text-rose-900/90 dark:text-rose-200/90',
    icon: 'text-rose-600 dark:text-rose-400',
  },
  critical: {
    container: 'bg-red-500/15 border-red-500/40',
    title: 'text-red-950 dark:text-red-100 font-bold',
    body: 'text-red-900/95 dark:text-red-200/95',
    icon: 'text-red-600 dark:text-red-400',
  },
  accent: {
    container: 'bg-accent/10 border-accent/30',
    title: 'text-slate-900 dark:text-white font-semibold',
    body: 'text-slate-800 dark:text-slate-200',
    icon: 'text-accent',
  },
  neutral: {
    container: 'bg-black/5 dark:bg-white/5 border-base-border',
    title: 'text-slate-900 dark:text-white font-semibold',
    body: 'text-slate-700 dark:text-slate-300',
    icon: 'text-[var(--text-muted)]',
  },
};

const defaultIcons: Record<CalloutVariant, React.ReactNode> = {
  info: <Info size={16} />,
  success: <CheckCircle2 size={16} />,
  warning: <AlertTriangle size={16} />,
  error: <AlertCircle size={16} />,
  critical: <ShieldAlert size={16} />,
  accent: <Sparkles size={16} />,
  neutral: <Info size={16} />,
};

export const Callout: React.FC<CalloutProps> = ({
  variant = 'neutral',
  title,
  icon,
  action,
  onClose,
  className = '',
  children,
  ...props
}) => {
  const styles = variantStyles[variant];
  const renderedIcon = icon !== undefined ? icon : defaultIcons[variant];

  return (
    <div
      className={`p-3.5 rounded-xl border text-xs transition-colors flex items-start space-x-3 select-none ${styles.container} ${className}`}
      {...props}
    >
      {renderedIcon && (
        <div className={`shrink-0 mt-0.5 ${styles.icon}`}>{renderedIcon}</div>
      )}

      <div className="flex-1 min-w-0 space-y-1">
        {title && <div className={`leading-snug ${styles.title}`}>{title}</div>}
        {children && <div className={`leading-relaxed ${styles.body}`}>{children}</div>}
      </div>

      {(action || onClose) && (
        <div className="shrink-0 flex items-center space-x-1.5 pl-2">
          {action}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
              title="Закрыть"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
