import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  resizable?: boolean;
  defaultWidth?: number | string;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;
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
  resizable = true,
  defaultWidth = '48%',
  minWidth = 320,
  maxWidth,
  storageKey = 'cs_split_panel_width',
  headerActions,
  className = '',
  children,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Initialize width from localStorage if available, otherwise defaultWidth
  const [width, setWidth] = useState<number | string>(() => {
    if (typeof window !== 'undefined' && storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minWidth) {
          return parsed;
        }
      }
    }
    return defaultWidth;
  });

  const asideRef = useRef<HTMLElement>(null);

  // Mouse drag handler for resizing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!resizable || isMaximized) return;
    e.preventDefault();
    setIsResizing(true);
  }, [resizable, isMaximized]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const screenWidth = window.innerWidth;
      const calculatedMaxWidth = maxWidth || screenWidth - 360;
      let newWidth = screenWidth - e.clientX;

      if (newWidth < minWidth) newWidth = minWidth;
      if (newWidth > calculatedMaxWidth) newWidth = calculatedMaxWidth;

      setWidth(newWidth);
      if (storageKey) {
        localStorage.setItem(storageKey, String(newWidth));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, minWidth, maxWidth, storageKey]);

  if (!isOpen) return null;

  const styleWidth = isMaximized
    ? undefined
    : typeof width === 'number'
    ? `${width}px`
    : width;

  return (
    <>
      {/* Drag Overlay to prevent iframes / child nodes from stealing mouse events */}
      {isResizing && (
        <div className="fixed inset-0 z-[9999] cursor-col-resize select-none pointer-events-auto bg-transparent" />
      )}

      <aside
        ref={asideRef}
        style={!isMaximized ? { width: styleWidth, minWidth: `${minWidth}px` } : undefined}
        className={`border-l border-base-border flex flex-col bg-base-surface relative z-20 ${
          isResizing ? 'transition-none select-none' : 'transition-[width] duration-75'
        } ${
          isMaximized
            ? 'fixed inset-0 z-50 bg-base w-full h-full max-w-none min-w-0'
            : 'h-full shrink-0'
        } ${className}`}
      >
        {/* Resizer Handle */}
        {resizable && !isMaximized && (
          <div
            onMouseDown={handleMouseDown}
            className={`absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-30 group flex items-center justify-center transition-colors select-none ${
              isResizing ? 'bg-[var(--accent)]/50' : 'hover:bg-[var(--accent)]/30'
            }`}
            title="Потяните влево или вправо для изменения размера панели"
          >
            <div
              className={`w-0.5 h-6 rounded transition-colors ${
                isResizing ? 'bg-[var(--accent)]' : 'bg-slate-500/40 group-hover:bg-[var(--accent)]'
              }`}
            />
          </div>
        )}

        {/* Header */}
        <div className="h-11 min-h-11 max-h-11 px-3.5 border-b border-base-border bg-base-surface flex items-center justify-between select-none shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
            {statusDot && <StatusDot status={statusDot} size="xs" pulse />}
            {icon && <div className="text-[var(--text-secondary)] shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              {typeof title === 'string' ? (
                <span className="text-xs font-semibold text-[var(--text-primary)] truncate block tracking-wide">
                  {title}
                </span>
              ) : (
                title
              )}
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
    </>
  );
};
