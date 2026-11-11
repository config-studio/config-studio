import React, { forwardRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: number | string | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
  showSteppers?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  inputClassName?: string;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onChange,
      min,
      max,
      step = 1,
      label,
      description,
      error,
      showSteppers = true,
      size = 'md',
      className = '',
      inputClassName = '',
      disabled,
      placeholder,
      id,
      ...props
    },
    ref
  ) => {
    const inputId =
      id || (typeof label === 'string' ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (val === '') {
        onChange(undefined);
        return;
      }
      const num = Number(val);
      if (!isNaN(num)) {
        onChange(num);
      }
    };

    const handleStep = (direction: 'up' | 'down') => {
      if (disabled) return;
      const current = numericValue ?? (direction === 'up' ? (min ?? 0) : (max ?? 0));
      const delta = direction === 'up' ? step : -step;
      let next = current + delta;

      if (min !== undefined && next < min) next = min;
      if (max !== undefined && next > max) next = max;

      onChange(next);
    };

    const isSm = size === 'sm';

    return (
      <div className={`space-y-1.5 w-full ${className}`}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider select-none"
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center">
          <input
            ref={ref}
            id={inputId}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value ?? ''}
            onChange={handleInputChange}
            disabled={disabled}
            placeholder={placeholder}
            className={`w-full bg-gray-100 dark:bg-black/30 border rounded-xl text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none transition-colors ${
              isSm ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-xs'
            } ${showSteppers ? 'pr-9' : ''} ${
              error
                ? 'border-red-500 focus:border-red-500'
                : 'border-base-border focus:border-accent'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${inputClassName}`}
            {...props}
          />

          {showSteppers && !disabled && (
            <div className="absolute right-1 top-1 bottom-1 flex flex-col justify-center border-l border-base-border pl-1">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => handleStep('up')}
                disabled={max !== undefined && numericValue !== undefined && numericValue >= max}
                className="p-0.5 text-gray-400 hover:text-accent hover:bg-black/10 dark:hover:bg-white/10 rounded transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Увеличить"
                aria-label="Increase"
              >
                <ChevronUp size={11} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => handleStep('down')}
                disabled={min !== undefined && numericValue !== undefined && numericValue <= min}
                className="p-0.5 text-gray-400 hover:text-accent hover:bg-black/10 dark:hover:bg-white/10 rounded transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Уменьшить"
                aria-label="Decrease"
              >
                <ChevronDown size={11} />
              </button>
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
        {description && !error && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    );
  }
);

NumberInput.displayName = 'NumberInput';
