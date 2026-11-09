import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  icon?: React.ReactNode;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  className = '',
  icon,
}) => {
  const isSm = size === 'sm';
  const trackClass = isSm ? 'w-8 h-4' : 'w-11 h-6';
  const thumbClass = isSm ? 'w-3 h-3' : 'w-5 h-5';
  const translateClass = isSm
    ? checked
      ? 'translate-x-4'
      : 'translate-x-0.5'
    : checked
    ? 'translate-x-5'
    : 'translate-x-0.5';

  const toggleElement = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${trackClass} ${
        checked ? 'bg-accent' : 'bg-gray-300 dark:bg-white/20'
      }`}
    >
      <span
        className={`pointer-events-none inline-block rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${thumbClass} ${translateClass}`}
      />
    </button>
  );

  if (!label && !description) {
    return <div className={`inline-flex items-center ${className}`}>{toggleElement}</div>;
  }

  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      className={`flex items-start justify-between gap-3 cursor-pointer select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      <div className="flex items-start space-x-2.5">
        {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
        <div>
          {label && (
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              {label}
            </div>
          )}
          {description && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
        {toggleElement}
      </div>
    </div>
  );
};
