import React, { useState, useEffect, useMemo } from 'react';
import {
  Server,
  Plus,
  Key,
  Shield,
  FileCode,
  Lock,
} from 'lucide-react';
import { SSHHost, SecretMeta } from '../../types';
import { sshHostService } from '../../services/sshHosts';
import { api } from '../../services/api';
import { ConfirmModal, EmptyState, Dropdown, DropdownOption, Button, Input, Textarea, Card } from '../ui';
import { HostCard } from './hosts/HostCard';
import { OpenSSHModal } from './hosts/OpenSSHModal';
import { VaultBackupModal } from './hosts/VaultBackupModal';

interface SSHHostsTabProps {
  accentColor?: string;
  onOpenTerminal?: (host: SSHHost) => void;
}

export const SSHHostsTab: React.FC<SSHHostsTabProps> = ({
  onOpenTerminal,
}) => {
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [identities, setIdentities] = useState<SecretMeta[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingHost, setEditingHost] = useState<Partial<SSHHost>>({
    name: '',
    host: '',
    port: 22,
    user: 'root',
    authType: 'password',
    password: '',
    privateKey: '',
    passphrase: '',
    defaultPath: '/etc',
  });

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; latencyMs?: number; error?: string } | null>(null);

  // OpenSSH Modal
  const [isOpenSSHModalOpen, setIsOpenSSHModalOpen] = useState(false);
  const [openSSHTab, setOpenSSHTab] = useState<'export' | 'import'>('export');
  const [openSSHConfigText, setOpenSSHConfigText] = useState('');
  const [importOpenSSHText, setImportOpenSSHText] = useState('');
  const [openSSHStatus, setOpenSSHStatus] = useState<string | null>(null);
  const [isImportingSSH, setIsImportingSSH] = useState(false);

  // Migration & Vault Backup Modal
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [migrationTab, setMigrationTab] = useState<'export' | 'import'>('export');
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [selectedBackupFile, setSelectedBackupFile] = useState<File | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);

  // Delete Confirm Modal
  const [hostToDelete, setHostToDelete] = useState<SSHHost | null>(null);

  useEffect(() => {
    setHosts(sshHostService.list());
    return sshHostService.subscribe((updated) => setHosts(updated));
  }, []);

  useEffect(() => {
    api.listSecrets()
      .then((items) => {
        setIdentities((items || []).filter((s) => s.type === 'ssh_key' || s.type === 'password' || s.scope === 'shared'));
      })
      .catch(() => {});
  }, []);

  const authTypeOptions: DropdownOption[] = [
    { value: 'password', label: 'Пароль', icon: <Key size={14} className="text-amber-400" /> },
    { value: 'private_key', label: 'SSH Ключ (PEM)', icon: <Shield size={14} className="text-emerald-400" /> },
    { value: 'vault', label: 'Сейф (Vault Identity)', icon: <Server size={14} className="text-purple-400" /> },
  ];

  const identityOptions: DropdownOption[] = useMemo(() => {
    return identities.map((id) => ({
      value: id.id,
      label: id.title,
      subtitle: `ID: ${id.id}`,
      icon: id.type === 'ssh_key' ? <Shield size={14} className="text-emerald-400" /> : <Key size={14} className="text-amber-400" />,
      badge: id.type,
      badgeColor: id.type === 'ssh_key' ? 'green' : 'amber',
    }));
  }, [identities]);

  const handleSaveHost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHost.host || !editingHost.user) return;

    const hostToSave: SSHHost = {
      id: editingHost.id || 'host-' + Date.now().toString(36),
      name: editingHost.name || editingHost.host,
      host: editingHost.host.trim(),
      port: Number(editingHost.port || 22),
      user: editingHost.user.trim(),
      authType: editingHost.authType || 'password',
      identityId: editingHost.identityId,
      password: editingHost.password,
      privateKey: editingHost.privateKey,
      passphrase: editingHost.passphrase,
      defaultPath: editingHost.defaultPath || '/etc',
      createdAt: editingHost.createdAt || new Date().toISOString(),
    };

    sshHostService.save(hostToSave);
    setIsEditing(false);
    setEditingHost({
      name: '',
      host: '',
      port: 22,
      user: 'root',
      authType: 'password',
      password: '',
      privateKey: '',
      passphrase: '',
      defaultPath: '/etc',
    });
  };

  const handleEdit = (host: SSHHost) => {
    setEditingHost({ ...host });
    setIsEditing(true);
  };

  const handleDelete = (host: SSHHost) => {
    setHostToDelete(host);
  };

  const handleConfirmDelete = () => {
    if (hostToDelete) {
      sshHostService.delete(hostToDelete.id);
      setHostToDelete(null);
    }
  };

  const handleTestConnection = async (host: SSHHost) => {
    setTestingId(host.id);
    setTestResult(null);
    try {
      const res = await api.testSSH(host);
      setTestResult({
        id: host.id,
        success: res.success,
        latencyMs: res.latencyMs,
        error: res.error,
      });
    } catch (err: any) {
      setTestResult({
        id: host.id,
        success: false,
        error: err.message || 'Ошибка подключения',
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleOpenSSHModal = async () => {
    setOpenSSHStatus(null);
    try {
      const text = await sshHostService.exportOpenSSH();
      setOpenSSHConfigText(text);
    } catch (e: any) {
      setOpenSSHConfigText('# Ошибка экспорта: ' + e.message);
    }
    setIsOpenSSHModalOpen(true);
  };

  const handleDownloadOpenSSH = () => {
    const blob = new Blob([openSSHConfigText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportOpenSSH = async () => {
    if (!importOpenSSHText.trim()) return;
    setIsImportingSSH(true);
    setOpenSSHStatus(null);
    try {
      const res = await sshHostService.importOpenSSH(importOpenSSHText);
      setOpenSSHStatus(`Успешно! Импортировано: ${res.imported || 0}, обновлено: ${res.updated || 0}`);
      setImportOpenSSHText('');
      setTimeout(() => setIsOpenSSHModalOpen(false), 1500);
    } catch (err: any) {
      setOpenSSHStatus(`Ошибка импорта: ${err.message}`);
    } finally {
      setIsImportingSSH(false);
    }
  };

  const handleExportPortableBackup = async () => {
    if (!exportPassphrase.trim()) {
      alert('Пожалуйста, введите пароль для шифрования архива');
      return;
    }
    setIsMigrating(true);
    setMigrationStatus(null);
    try {
      const blob = await sshHostService.exportPortableSecrets(exportPassphrase);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `config-studio-backup-${new Date().toISOString().slice(0, 10)}.csenc`;
      a.click();
      URL.revokeObjectURL(url);
      setMigrationStatus('Архив успешно создан и скачан!');
      setExportPassphrase('');
    } catch (err: any) {
      setMigrationStatus(`Ошибка создания бэкапа: ${err.message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  const handleImportPortableBackup = async () => {
    if (!selectedBackupFile) {
      alert('Пожалуйста, выберите файл бэкапа (.csenc)');
      return;
    }
    if (!importPassphrase.trim()) {
      alert('Пожалуйста, введите пароль архива');
      return;
    }
    setIsMigrating(true);
    setMigrationStatus(null);
    try {
      const res = await sshHostService.importPortableSecrets(selectedBackupFile, importPassphrase);
      setMigrationStatus(`Успешно восстановлено! Секретов: ${(res.imported || 0) + (res.updated || 0)}`);
      setTimeout(() => setIsMigrationModalOpen(false), 1800);
    } catch (err: any) {
      setMigrationStatus(`Ошибка восстановления: ${err.message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Управление SSH-хостами и ключами</h3>
          <p className="text-xs text-gray-400">
            Единое ядровое хранилище серверов, терминала, SFTP и Vault
          </p>
        </div>
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleOpenSSHModal}
            icon={<FileCode size={13} />}
          >
            OpenSSH
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setMigrationStatus(null);
              setIsMigrationModalOpen(true);
            }}
            icon={<Lock size={13} />}
          >
            Бэкап Vault
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              setEditingHost({
                name: '',
                host: '',
                port: 22,
                user: 'root',
                authType: 'password',
                defaultPath: '/etc',
              });
              setIsEditing(true);
            }}
            icon={<Plus size={13} />}
          >
            Добавить хост
          </Button>
        </div>
      </div>

      {/* Host Editing Form */}
      {isEditing && (
        <Card className="p-4 overflow-visible">
          <form onSubmit={handleSaveHost} className="space-y-4">
            <div className="flex items-center justify-between border-b border-base-border pb-2.5">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {editingHost.id ? 'Редактировать хост' : 'Новый SSH-хост'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setIsEditing(false)}
              >
                Отмена
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Понятное имя"
                placeholder="Production Web"
                value={editingHost.name || ''}
                onChange={(e) => setEditingHost({ ...editingHost, name: e.target.value })}
              />
              <Input
                label="Хост / IP-адрес *"
                required
                placeholder="192.168.1.100 или server.com"
                value={editingHost.host || ''}
                onChange={(e) => setEditingHost({ ...editingHost, host: e.target.value })}
                className="font-mono"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Порт"
                type="number"
                value={editingHost.port || 22}
                onChange={(e) => setEditingHost({ ...editingHost, port: Number(e.target.value) })}
                className="font-mono"
              />
              <Input
                label="Пользователь *"
                required
                placeholder="root"
                value={editingHost.user || ''}
                onChange={(e) => setEditingHost({ ...editingHost, user: e.target.value })}
                className="font-mono"
              />
              <Dropdown
                label="Тип авторизации"
                value={editingHost.authType || 'password'}
                onChange={(val) => setEditingHost({ ...editingHost, authType: val as any })}
                options={authTypeOptions}
                size="sm"
              />
            </div>

            {/* Conditional credentials */}
            {editingHost.authType === 'password' && (
              <Input
                label="Пароль"
                type="password"
                peekable
                placeholder="Введите пароль SSH"
                value={editingHost.password || ''}
                onChange={(e) => setEditingHost({ ...editingHost, password: e.target.value })}
                className="font-mono"
              />
            )}

            {editingHost.authType === 'private_key' && (
              <div className="space-y-3">
                <Textarea
                  label="Приватный ключ (OpenSSH / RSA / Ed25519)"
                  rows={3}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                  value={editingHost.privateKey || ''}
                  onChange={(e) => setEditingHost({ ...editingHost, privateKey: e.target.value })}
                  className="font-mono"
                />
                <Input
                  label="Passphrase ключа (если задан)"
                  type="password"
                  peekable
                  placeholder="Оставьте пустым, если ключ без пароля"
                  value={editingHost.passphrase || ''}
                  onChange={(e) => setEditingHost({ ...editingHost, passphrase: e.target.value })}
                  className="font-mono"
                />
              </div>
            )}

            {editingHost.authType === 'vault' && (
              <Dropdown
                label="Запись из Сейфа ключей"
                value={editingHost.identityId || ''}
                onChange={(val) => setEditingHost({ ...editingHost, identityId: val })}
                options={identityOptions}
                placeholder="Выберите секрет из хранилища..."
                searchable={identityOptions.length > 5}
                size="sm"
              />
            )}

            <Input
              label="Удаленный путь по умолчанию"
              placeholder="/etc или /var/www"
              value={editingHost.defaultPath || ''}
              onChange={(e) => setEditingHost({ ...editingHost, defaultPath: e.target.value })}
              className="font-mono"
            />

            <div className="flex justify-end space-x-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
              >
                Сохранить хост
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Hosts list */}
      <div className="space-y-2">
        {hosts.length === 0 ? (
          <EmptyState
            icon={<Server size={32} />}
            title="Нет настроенных SSH-хостов"
            description="Нажмите «Добавить хост» для подключения к серверам."
          />
        ) : (
          hosts.map((host) => (
            <HostCard
              key={host.id}
              host={host}
              isTesting={testingId === host.id}
              testResult={testResult?.id === host.id ? testResult : null}
              onTest={handleTestConnection}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOpenTerminal={onOpenTerminal}
            />
          ))
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!hostToDelete}
        onClose={() => setHostToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Удаление SSH-хоста"
        message={
          <span>
            Вы уверены, что хотите удалить SSH-хост{' '}
            <strong className="text-[var(--text-primary)] font-semibold">
              «{hostToDelete?.name || hostToDelete?.host}»
            </strong>?
          </span>
        }
        confirmText="Удалить"
        variant="danger"
      />

      {/* OpenSSH Interoperability Modal */}
      <OpenSSHModal
        isOpen={isOpenSSHModalOpen}
        onClose={() => setIsOpenSSHModalOpen(false)}
        openSSHTab={openSSHTab}
        setOpenSSHTab={setOpenSSHTab}
        openSSHConfigText={openSSHConfigText}
        importOpenSSHText={importOpenSSHText}
        setImportOpenSSHText={setImportOpenSSHText}
        openSSHStatus={openSSHStatus}
        setOpenSSHStatus={setOpenSSHStatus}
        isImportingSSH={isImportingSSH}
        onDownloadOpenSSH={handleDownloadOpenSSH}
        onImportOpenSSH={handleImportOpenSSH}
      />

      {/* Migration & Vault Backup Modal */}
      <VaultBackupModal
        isOpen={isMigrationModalOpen}
        onClose={() => setIsMigrationModalOpen(false)}
        migrationTab={migrationTab}
        setMigrationTab={setMigrationTab}
        exportPassphrase={exportPassphrase}
        setExportPassphrase={setExportPassphrase}
        importPassphrase={importPassphrase}
        setImportPassphrase={setImportPassphrase}
        selectedBackupFile={selectedBackupFile}
        setSelectedBackupFile={setSelectedBackupFile}
        migrationStatus={migrationStatus}
        setMigrationStatus={setMigrationStatus}
        isMigrating={isMigrating}
        onExportPortableBackup={handleExportPortableBackup}
        onImportPortableBackup={handleImportPortableBackup}
      />
    </div>
  );
};
