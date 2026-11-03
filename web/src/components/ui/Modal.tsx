import React, { useEffect, createContext, useContext } from 'react';
import { X } from 'lucide-react';
import { ScrollArea } from './ScrollArea';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';
export type ModalHeight = 'auto' | 'fixed' | 'full';

interface ModalContextType {
  onClose?: () => void;
  size: ModalSize;
  height: ModalHeight;
}

const ModalContext = createContext<ModalContextType>({
  size: 'lg',
  height: 'auto',
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
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-[400px] w-full',
  md: 'max-w-[540px] w-full',
  lg: 'max-w-[720px] w-full',
  xl: 'max-w-[900px] w-full',
  fullscreen: 'w-full h-full max-w-none rounded-none',
};

const heightClasses: Record<ModalHeight, string> = {
  auto: 'max-h-[92vh] max-sm:h-full max-sm:max-h-none',
  fixed: 'h-[82vh] min-h-[580px] max-h-[820px] max-sm:h-full max-sm:min-h-0 max-sm:max-h-none',
  full: 'h-[92vh] max-sm:h-full max-sm:max-h-none',
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
}) => {
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

  return (
    <ModalContext.Provider value={{ onClose, size, height }}>
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
          className={`bg-base-surface border border-base-border max-sm:border-none rounded-none sm:rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 max-sm:w-full max-sm:h-full max-sm:rounded-none ${sizeClasses[size]} ${heightClasses[height]} ${className}`}
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

      {showClose && handleClose && (
        <button
          type="button"
          onClick={handleClose}
          className="p-1.5 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0 ml-3"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      )}
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
