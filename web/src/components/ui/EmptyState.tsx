import React from 'react';
import { RefreshCw } from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  loading?: boolean;
  loadingText?: string;
  className?: string;
  bordered?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  loading = false,
  loadingText = 'Loading...',
  className = '',
  bordered = true,
}) => {
  if (loading) {
    return (
      <div
        className={`p-8 text-center text-xs text-gray-400 flex items-center justify-center space-x-2 ${
          bordered ? 'border border-base-border rounded-2xl bg-black/10' : ''
        } ${className}`}
      >
        <RefreshCw size={14} className="animate-spin text-accent" />
        <span>{loadingText}</span>
      </div>
    );
  }

  return (
    <div
      className={`p-8 text-center text-xs text-gray-400 flex flex-col items-center justify-center space-y-2 ${
        bordered ? 'border border-base-border rounded-2xl bg-black/10' : ''
      } ${className}`}
    >
      {icon && <div className="text-gray-500 opacity-60 mb-1">{icon}</div>}
      {title && <span className="font-semibold text-gray-200">{title}</span>}
      {description && (
        <span className="text-[11px] text-gray-400 max-w-sm leading-relaxed">
          {description}
        </span>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
};
