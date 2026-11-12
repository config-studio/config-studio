import React, { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (val: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onChange,
      onClear,
      placeholder = 'Поиск...',
      className = '',
      inputClassName = '',
      ...props
    },
    ref
  ) => {
    const handleClear = () => {
      onChange('');
      onClear?.();
    };

    return (
      <div className={`relative flex items-center min-w-[200px] ${className}`}>
        <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 pointer-events-none shrink-0" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-gray-100 dark:bg-black/30 border border-base-border rounded-xl pl-9 pr-8 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent transition-colors ${inputClassName}`}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 p-0.5 rounded-md text-gray-400 hover:text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/10 transition cursor-pointer"
            title="Очистить"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';
