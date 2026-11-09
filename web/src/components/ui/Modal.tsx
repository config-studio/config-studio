import React, { useEffect, useState, createContext, useContext } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { ScrollArea } from './ScrollArea';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'fullscreen';
export type ModalHeight = 'auto' | 'fixed' | 'full';

interface ModalContextType {
  onClose?: () => void;
  size: ModalSize;
  height: ModalHeight;
  allowMaximize: boolean;
  isMaximized: boolean;
  toggleMaximize: () => void;
}

const ModalContext = createContext<ModalContextType>({
  size: 'lg',
  height: 'auto',
  allowMaximize: false,
  isMaximized: false,
  toggleMaximize: () => {},
});

export interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  size?: ModalSize;
  height?: ModalHeight;
  className?: string;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  allowMaximize?: boolean;
  defaultMaximized?: boolean;
  onMaximizeChange?: (maximized: boolean) => void;
}

// 20% Step System with responsive minimum bounds and 100% mobile fallback
const sizeClasses: Record<ModalSize, string> = {
  sm: 'w-[24vw] min-w-[360px] max-w-[24vw]',
  md: 'w-[32vw] min-w-[420px] max-w-[32vw]',
  lg: 'w-[45vw] min-w-[500px] max-w-[45vw]',
  xl: 'w-[60vw] min-w-[620px] max-w-[60vw]',
  xxl: 'w-[80vw] min-w-[780px] max-w-[80vw]',
  fullscreen: 'w-full h-full max-w-none rounded-none border-none',
};

const heightClasses: Record<ModalHeight, string> = {
  auto: 'max-h-[85vh] max-sm:h-full max-sm:max-h-none',
  fixed: 'h-[75vh] min-h-[480px] max-h-[85vh] max-sm:h-full max-sm:min-h-0 max-sm:max-h-none',
  full: 'h-[85vh] max-sm:h-full max-sm:max-h-none',
};

// Custom height presets for larger modal sizes when height is fixed or full
const largeHeightClasses: Partial<Record<ModalSize, string>> = {
  xxl: 'h-[80vh] min-h-[580px] max-h-[80vh]',
  xl: 'h-[70vh] min-h-[480px] max-h-[70vh]',
  lg: 'h-[60vh] min-h-[400px] max-h-[60vh]',
};

export const Modal: React.FC<ModalProps> & {
  Header: React.FC<ModalHeaderProps>;
  Body: React.FC<ModalBodyProps>;
  Footer: React.FC<ModalFooterProps>;
} = ({
  isOpen,
  onClose,
  size = 'lg',
  height = 'auto',
  className = '',
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  allowMaximize,
  defaultMaximized = false,
  onMaximizeChange,
}) => {
  const [isMaximized, setIsMaximized] = useState(defaultMaximized);

  // Default allowMaximize: enabled for xxl and xl, or when explicitly passed
  const canMaximize = allowMaximize ?? (size === 'xxl' || size === 'xl');

  const toggleMaximize = () => {
    if (!canMaximize) return;
    setIsMaximized((prev) => {
      const next = !prev;
      onMaximizeChange?.(next);
      return next;
    });
  };

  useEffect(() => {
    if (!isOpen) {
      setIsMaximized(defaultMaximized);
    }
  }, [isOpen, defaultMaximized]);

  useEffect(() => {
    if (!isOpen || !closeOnEscape || !onClose) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  // Compute final dimension classes based on maximize state
  const dimensionClass = isMaximized
    ? 'w-full h-full max-w-none max-h-none rounded-none border-none'
    : `${sizeClasses[size]} ${
        height !== 'auto' && largeHeightClasses[size]
          ? largeHeightClasses[size]
          : heightClasses[height]
      }`;

  return (
    <ModalContext.Provider
      value={{
        onClose,
        size,
        height,
        allowMaximize: canMaximize,
        isMaximized,
        toggleMaximize,
      }}
    >
      <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-200">
        {/* Backdrop click catcher */}
        {closeOnBackdrop && (
          <div
            className="absolute inset-0 -z-10"
            onClick={onClose}
            aria-hidden="true"
          />
        )}

        <div
          role="dialog"
          aria-modal="true"
          className={`bg-base-surface border border-base-border max-sm:border-none rounded-none sm:rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 transition-all duration-300 ease-out max-sm:w-full max-sm:h-full max-sm:max-w-none max-sm:max-h-none max-sm:rounded-none max-sm:border-none ${dimensionClass} ${className}`}
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {children}
        </div>
      </div>
    </ModalContext.Provider>
  );
};

export interface ModalHeaderProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void;
  showClose?: boolean;
  className?: string;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  subtitle,
  badge,
  icon,
  children,
  onClose,
  showClose = true,
  className = '',
}) => {
  const ctx = useContext(ModalContext);
  const handleClose = onClose || ctx.onClose;

  return (
    <div
      className={`px-4 sm:px-6 py-3.5 sm:py-4 border-b border-base-border flex items-center justify-between shrink-0 select-none ${className}`}
    >
      <div className="flex items-center space-x-3 min-w-0">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            {title && (
              <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">
                {title}
              </h2>
            )}
            {badge && <div className="shrink-0">{badge}</div>}
          </div>
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {subtitle}
            </p>
          )}
          {children}
        </div>
      </div>

      <div className="flex items-center space-x-1.5 shrink-0 ml-3">
        {ctx.allowMaximize && (
          <button
            type="button"
            onClick={ctx.toggleMaximize}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            title={ctx.isMaximized ? 'Восстановить исходный размер' : 'Развернуть на весь экран'}
            aria-label={ctx.isMaximized ? 'Restore' : 'Maximize'}
          >
            {ctx.isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}

        {showClose && handleClose && (
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
  scrollable?: boolean;
  orientation?: 'vertical' | 'horizontal' | 'both';
}

export const ModalBody: React.FC<ModalBodyProps> = ({
  children,
  className = '',
  scrollable = true,
  orientation = 'vertical',
}) => {
  if (!scrollable) {
    return <div className={`flex-1 flex flex-col min-h-0 ${className}`}>{children}</div>;
  }

  return (
    <ScrollArea
      orientation={orientation}
      className={`flex-1 min-h-0 ${className}`}
      contentClassName="min-h-full"
    >
      {children}
    </ScrollArea>
  );
};

export interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
  justify?: 'between' | 'end' | 'start';
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  children,
  className = '',
  justify = 'between',
}) => {
  const justifyClass =
    justify === 'between'
      ? 'justify-between'
      : justify === 'end'
      ? 'justify-end'
      : 'justify-start';

  return (
    <div
      className={`px-4 sm:px-6 py-3 sm:py-3.5 border-t border-base-border bg-gray-50/50 dark:bg-black/10 flex items-center ${justifyClass} gap-3 shrink-0 select-none ${className}`}
    >
      {children}
    </div>
  );
};

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
