import React, { useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { StatusDot, StatusDotType } from './StatusDot';
import { IconButton } from './IconButton';

export interface SplitPanelProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  statusDot?: StatusDotType;
  isOpen?: boolean;
  onClose?: () => void;
  allowMaximize?: boolean;
  defaultWidth?: string;
  minWidth?: string;
  maxWidth?: string;
  headerActions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export const SplitPanel: React.FC<SplitPanelProps> = ({
  title,
  subtitle,
  icon,
  statusDot,
  isOpen = true,
  onClose,
  allowMaximize = true,
  defaultWidth = '48%',
  minWidth = '360px',
  maxWidth = '800px',
  headerActions,
  className = '',
  children,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

  if (!isOpen) return null;

  return (
    <aside
      style={!isMaximized ? { width: defaultWidth, minWidth, maxWidth } : undefined}
      className={`border-l border-base-border flex flex-col bg-base-surface transition-all duration-150 z-20 ${
        isMaximized
          ? 'fixed inset-0 z-50 bg-base w-full h-full max-w-none min-w-0'
          : 'h-full shrink-0'
      } ${className}`}
    >
      {/* Header */}
      <div className="h-10 min-h-[40px] px-3.5 border-b border-base-border bg-base-surface flex items-center justify-between select-none shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          {statusDot && <StatusDot status={statusDot} size="xs" pulse />}
          {icon && <div className="text-[var(--text-secondary)] shrink-0">{icon}</div>}
          <div className="min-w-0">
            <span className="text-xs font-semibold text-[var(--text-primary)] truncate block tracking-wide">
              {title}
            </span>
            {subtitle && (
              <span className="text-[10px] text-[var(--text-muted)] truncate block -mt-0.5">
                {subtitle}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {headerActions}

          {allowMaximize && (
            <IconButton
              variant="ghost"
              size="xs"
              onClick={() => setIsMaximized(!isMaximized)}
              icon={isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              title={isMaximized ? 'Свернуть' : 'Развернуть на весь экран'}
            />
          )}

          {onClose && (
            <IconButton
              variant="danger"
              size="xs"
              onClick={onClose}
              icon={<X size={14} />}
              title="Закрыть панель"
            />
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {children}
      </div>
    </aside>
  );
};
