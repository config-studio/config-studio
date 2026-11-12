import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-accent hover:brightness-105 active:scale-95 text-white font-semibold shadow-xs border border-transparent',
  secondary:
    'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 active:scale-95 text-gray-800 dark:text-gray-200 border border-base-border',
  outline:
    'bg-transparent hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 text-gray-700 dark:text-gray-300 border border-base-border hover:border-gray-400 dark:hover:border-gray-500',
  ghost:
    'bg-transparent hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-transparent',
  danger:
    'bg-red-500/10 hover:bg-red-500/20 active:scale-95 text-red-600 dark:text-red-400 border border-red-500/30 font-medium',
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'px-2 py-0.5 text-[11px] rounded-md gap-1',
  sm: 'px-2.5 py-1 text-xs rounded-lg gap-1.5',
  md: 'px-3.5 py-1.5 text-xs rounded-xl gap-2',
  lg: 'px-4 py-2 text-sm rounded-xl gap-2.5',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      loading = false,
      icon,
      rightIcon,
      disabled = false,
      className = '',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={`inline-flex items-center justify-center font-medium transition-all select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          icon && <span className="shrink-0">{icon}</span>
        )}
        {children && <span>{children}</span>}
        {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
