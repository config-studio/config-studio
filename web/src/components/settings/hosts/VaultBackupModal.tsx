import React from 'react';
import { Lock, Download, Upload } from 'lucide-react';
import { Modal, Button, Input } from '../../ui';

interface VaultBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  migrationTab: 'export' | 'import';
  setMigrationTab: (tab: 'export' | 'import') => void;
  exportPassphrase: string;
  setExportPassphrase: (pass: string) => void;
  importPassphrase: string;
  setImportPassphrase: (pass: string) => void;
  selectedBackupFile: File | null;
  setSelectedBackupFile: (file: File | null) => void;
  migrationStatus: string | null;
  setMigrationStatus: (status: string | null) => void;
  isMigrating: boolean;
  onExportPortableBackup: () => void;
  onImportPortableBackup: () => void;
}

export const VaultBackupModal: React.FC<VaultBackupModalProps> = ({
  isOpen,
  onClose,
  migrationTab,
  setMigrationTab,
  exportPassphrase,
  setExportPassphrase,
  importPassphrase,
  setImportPassphrase,
  selectedBackupFile,
  setSelectedBackupFile,
  migrationStatus,
  setMigrationStatus,
  isMigrating,
  onExportPortableBackup,
  onImportPortableBackup,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        title="Портативный бэкап и миграция Vault"
        subtitle="Безопасный перенос ключей и паролей на другой сервер с защитой мастер-паролем"
        icon={<Lock className="w-5 h-5 text-accent" />}
      />
      <Modal.Body className="p-5 space-y-4">
        <div className="flex space-x-2 border-b border-base-border pb-3">
          <button
            type="button"
            onClick={() => {
              setMigrationTab('export');
              setMigrationStatus(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              migrationTab === 'export'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            Создать бэкап (Экспорт)
          </button>
          <button
            type="button"
            onClick={() => {
              setMigrationTab('import');
              setMigrationStatus(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              migrationTab === 'import'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            Восстановить из бэкапа (Импорт)
          </button>
        </div>

        {migrationTab === 'export' ? (
          <div className="space-y-4">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
              Архив шифруется по стандарту <b>AES-256-GCM</b> с выводом ключа через <b>PBKDF2 (100 000 итераций)</b>. Сохраните этот пароль: он понадобится при восстановлении на новом сервере.
            </div>
            <Input
              type="password"
              peekable
              label="Мастер-пароль для шифрования архива"
              value={exportPassphrase}
              onChange={(e) => setExportPassphrase(e.target.value)}
              placeholder="Введите надежный пароль..."
            />
            {migrationStatus && (
              <div className="text-xs font-semibold text-emerald-400">
                {migrationStatus}
              </div>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onExportPortableBackup}
                disabled={isMigrating || !exportPassphrase.trim()}
                icon={<Download size={13} />}
              >
                {isMigrating ? 'Шифрование...' : 'Скачать зашифрованный бэкап (.csenc)'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-300">Файл бэкапа (.csenc)</label>
              <input
                type="file"
                accept=".csenc,application/octet-stream"
                onChange={(e) => setSelectedBackupFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-accent/20 file:text-accent hover:file:bg-accent/30 cursor-pointer"
              />
            </div>
            <Input
              type="password"
              peekable
              label="Пароль для расшифровки архива"
              value={importPassphrase}
              onChange={(e) => setImportPassphrase(e.target.value)}
              placeholder="Введите пароль, указанный при экспорте..."
            />
            {migrationStatus && (
              <div className="text-xs font-semibold text-emerald-400">
                {migrationStatus}
              </div>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onImportPortableBackup}
                disabled={isMigrating || !importPassphrase.trim() || !selectedBackupFile}
                icon={<Upload size={13} />}
              >
                {isMigrating ? 'Расшифровка...' : 'Восстановить ключи'}
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
