import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger' | 'accent' | 'primary';
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
}

const variantStyles: Record<IconButtonVariant, string> = {
  ghost:
    'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10',
  secondary:
    'bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/20 border border-base-border',
  danger:
    'text-gray-500 dark:text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-500/10',
  accent:
    'text-accent hover:bg-accent/15',
  primary:
    'bg-accent text-slate-950 font-bold hover:opacity-90 shadow-2xs',
};

const sizeStyles: Record<IconButtonSize, string> = {
  xs: 'p-1 rounded-md text-[11px]',
  sm: 'p-1.5 rounded-lg text-xs',
  md: 'p-2 rounded-xl text-sm',
  lg: 'p-2.5 rounded-2xl text-base',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      variant = 'ghost',
      size = 'sm',
      loading = false,
      disabled = false,
      className = '',
      type = 'button',
      title,
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    const isActuallyDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isActuallyDisabled}
        title={title}
        aria-label={ariaLabel || title}
        className={`inline-flex items-center justify-center shrink-0 transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
