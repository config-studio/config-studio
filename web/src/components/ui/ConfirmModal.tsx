import React from 'react';
import { AlertTriangle, Trash2, HelpCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  loading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Подтверждение действия',
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  variant = 'danger',
  loading = false,
}) => {
  const icon =
    variant === 'danger' ? (
      <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 shrink-0">
        <Trash2 size={18} />
      </div>
    ) : variant === 'warning' ? (
      <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
        <AlertTriangle size={18} />
      </div>
    ) : (
      <div className="p-2 rounded-xl bg-accent/10 border border-accent/30 text-accent shrink-0">
        <HelpCircle size={18} />
      </div>
    );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" allowMaximize={false}>
      <Modal.Header title={title} />
      <Modal.Body className="p-5 flex items-start space-x-3.5">
        {icon}
        <div className="text-xs text-gray-300 leading-relaxed pt-0.5">
          {message}
        </div>
      </Modal.Body>
      <Modal.Footer justify="end">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmText}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
