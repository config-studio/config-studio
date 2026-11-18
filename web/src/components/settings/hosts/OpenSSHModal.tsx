import React from 'react';
import { FileCode, Copy, Download, Upload } from 'lucide-react';
import { Modal, Button } from '../../ui';

interface OpenSSHModalProps {
  isOpen: boolean;
  onClose: () => void;
  openSSHTab: 'export' | 'import';
  setOpenSSHTab: (tab: 'export' | 'import') => void;
  openSSHConfigText: string;
  importOpenSSHText: string;
  setImportOpenSSHText: (text: string) => void;
  openSSHStatus: string | null;
  setOpenSSHStatus: (status: string | null) => void;
  isImportingSSH: boolean;
  onDownloadOpenSSH: () => void;
  onImportOpenSSH: () => void;
}

export const OpenSSHModal: React.FC<OpenSSHModalProps> = ({
  isOpen,
  onClose,
  openSSHTab,
  setOpenSSHTab,
  openSSHConfigText,
  importOpenSSHText,
  setImportOpenSSHText,
  openSSHStatus,
  setOpenSSHStatus,
  isImportingSSH,
  onDownloadOpenSSH,
  onImportOpenSSH,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        title="Интероперабельность со стандартом OpenSSH"
        subtitle="Синхронизация с ~/.ssh/config для использования в терминале ОС и скриптах"
        icon={<FileCode className="w-5 h-5 text-accent" />}
      />
      <Modal.Body className="p-5 space-y-4">
        <div className="flex space-x-2 border-b border-base-border pb-3">
          <button
            type="button"
            onClick={() => setOpenSSHTab('export')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              openSSHTab === 'export'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            Экспорт в ~/.ssh/config
          </button>
          <button
            type="button"
            onClick={() => setOpenSSHTab('import')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              openSSHTab === 'import'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            Импорт из ~/.ssh/config
          </button>
        </div>

        {openSSHTab === 'export' ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Скопируйте этот блок в ваш файл{' '}
              <code className="text-accent bg-black/20 px-1 py-0.5 rounded">~/.ssh/config</code>{' '}
              для быстрого подключения к любому серверу командой{' '}
              <code className="text-accent">ssh &lt;имя_хоста&gt;</code>:
            </p>
            <textarea
              readOnly
              value={openSSHConfigText}
              rows={12}
              className="w-full font-mono text-xs p-3 bg-black/40 border border-base-border rounded-xl text-emerald-400 focus:outline-none select-all"
            />
            <div className="flex items-center justify-end space-x-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(openSSHConfigText);
                  setOpenSSHStatus('Скопировано в буфер обмена!');
                  setTimeout(() => setOpenSSHStatus(null), 2000);
                }}
                icon={<Copy size={13} />}
              >
                Копировать
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onDownloadOpenSSH}
                icon={<Download size={13} />}
              >
                Скачать config
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Вставьте содержимое файла{' '}
              <code className="text-accent bg-black/20 px-1 py-0.5 rounded">~/.ssh/config</code>{' '}
              для пакетного импорта хостов в ядро:
            </p>
            <textarea
              value={importOpenSSHText}
              onChange={(e) => setImportOpenSSHText(e.target.value)}
              placeholder={'Host my-vps\n    HostName 10.0.0.5\n    User root\n    Port 22\n'}
              rows={12}
              className="w-full font-mono text-xs p-3 bg-black/40 border border-base-border rounded-xl text-gray-200 focus:outline-none focus:border-accent"
            />
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-emerald-400">
                {openSSHStatus}
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onImportOpenSSH}
                disabled={isImportingSSH || !importOpenSSHText.trim()}
                icon={<Upload size={13} />}
              >
                {isImportingSSH ? 'Импорт...' : 'Импортировать хосты'}
              </Button>
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer justify="end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onClose}
        >
          Закрыть
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
