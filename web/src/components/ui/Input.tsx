import React, { forwardRef, useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
  peekable?: boolean;
  copyable?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      description,
      error,
      icon,
      rightElement,
      peekable,
      copyable,
      type = 'text',
      className = '',
      id,
      value,
      ...props
    },
    ref
  ) => {
    const inputId = id || (typeof label === 'string' ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const [showPassword, setShowPassword] = useState(false);
    const [copied, setCopied] = useState(false);

    const effectiveType = peekable && type === 'password' ? (showPassword ? 'text' : 'password') : type;

    const handleCopy = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const textToCopy = value !== undefined ? String(value) : '';
      if (!textToCopy) return;

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          // Fallback for non-secure HTTP / iframe contexts
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.warn('Clipboard copy failed:', err);
      }
    };

    // Calculate action buttons if peekable or copyable
    const actionButtons = (peekable || copyable) ? (
      <div className="flex items-center space-x-1">
        {peekable && type === 'password' && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="p-1 text-gray-400 hover:text-[var(--text-primary)] rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title={showPassword ? 'Скрыть' : 'Показать'}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              copied
                ? 'text-emerald-400 bg-emerald-500/10'
                : 'text-gray-400 hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title={copied ? 'Скопировано!' : 'Копировать'}
            aria-label="Copy to clipboard"
            tabIndex={-1}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
      </div>
    ) : null;

    const mergedRight = rightElement || actionButtons ? (
      <div className="absolute right-2.5 flex items-center space-x-1.5">
        {actionButtons}
        {rightElement}
      </div>
    ) : null;

    const hasRightPad = !!(rightElement || actionButtons);

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider"
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-3 text-gray-400 pointer-events-none shrink-0">
              {icon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            type={effectiveType}
            value={value}
            className={`w-full px-3.5 py-2 bg-gray-100 dark:bg-black/30 border rounded-xl text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none transition-colors ${
              icon ? 'pl-9' : ''
            } ${hasRightPad ? 'pr-14' : ''} ${
              error
                ? 'border-red-500 focus:border-red-500'
                : 'border-base-border focus:border-accent'
            } ${className}`}
            {...props}
          />

          {mergedRight}
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

Input.displayName = 'Input';
