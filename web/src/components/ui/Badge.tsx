import React from 'react';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'accent' | 'neutral';
export type BadgeSize = 'xs' | 'sm' | 'md';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500/10 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30',
  warning: 'bg-amber-500/10 text-amber-900 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',
  error: 'bg-rose-500/10 text-rose-800 border-rose-300 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30',
  info: 'bg-blue-500/10 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30',
  accent: 'bg-accent/10 text-accent border-accent/30 dark:bg-accent/15 dark:text-accent dark:border-accent/30',
  neutral: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-gray-500/15 dark:text-gray-400 dark:border-gray-500/30',
};

const sizeStyles: Record<BadgeSize, string> = {
  xs: 'px-1 py-0.2 text-[9px] rounded-md gap-0.5',
  sm: 'px-1.5 py-0.5 text-[10px] rounded-md gap-1',
  md: 'px-2 py-0.5 text-xs rounded-lg gap-1.5',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  icon,
  className = '',
  ...props
}) => {
  return (
    <span
      className={`inline-flex items-center font-mono font-medium border select-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  );
};
