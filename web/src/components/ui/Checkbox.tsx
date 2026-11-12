import React, { forwardRef, useEffect, useRef } from 'react';
import { Check, Minus } from 'lucide-react';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm' | 'md';
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      checked = false,
      indeterminate = false,
      onChange,
      label,
      description,
      size = 'sm',
      disabled = false,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const innerRef = useRef<HTMLInputElement>(null);
    const combinedRef = (ref || innerRef) as React.MutableRefObject<HTMLInputElement>;
    const inputId = id || (typeof label === 'string' ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    useEffect(() => {
      if (combinedRef && combinedRef.current) {
        combinedRef.current.indeterminate = Boolean(indeterminate);
      }
    }, [indeterminate, combinedRef]);

    const boxSizes = size === 'sm' ? 'w-4 h-4 rounded' : 'w-5 h-5 rounded-md';
    const iconSizes = size === 'sm' ? 12 : 14;

    return (
      <label
        htmlFor={inputId}
        className={`inline-flex items-start gap-2.5 select-none transition ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer group'
        } ${className}`}
      >
        <div className="relative flex items-center shrink-0 mt-0.5">
          <input
            ref={combinedRef}
            id={inputId}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange?.(e.target.checked)}
            className="sr-only"
            {...props}
          />
          <div
            className={`${boxSizes} flex items-center justify-center border transition-all ${
              checked || indeterminate
                ? 'bg-accent border-accent text-slate-950 font-bold'
                : 'border-base-border bg-base-surface group-hover:border-accent/70'
            }`}
          >
            {checked && !indeterminate && <Check size={iconSizes} strokeWidth={3} />}
            {indeterminate && <Minus size={iconSizes} strokeWidth={3} />}
          </div>
        </div>

        {(label || description) && (
          <div className="min-w-0 flex-1">
            {label && (
              <div className="text-xs font-semibold text-[var(--text-primary)] leading-snug">
                {label}
              </div>
            )}
            {description && (
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                {description}
              </div>
            )}
          </div>
        )}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
