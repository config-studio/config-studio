import React, { useState, useEffect, useMemo } from 'react';
import {
  Server,
  Plus,
  Trash2,
  Edit2,
  Key,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  Shield,
  Terminal,
  Download,
  Upload,
  FileCode,
  Lock,
} from 'lucide-react';
import { SSHHost, SSHKeyPair, SecretMeta } from '../../types';
import { sshHostService } from '../../services/sshHosts';
import { api } from '../../services/api';
import { Modal, ConfirmModal, EmptyState, Dropdown, DropdownOption, Badge, StatusBadge, Button, Input, Textarea, Card } from '../ui';

interface SSHHostsTabProps {
  accentColor?: string;
  onOpenTerminal?: (host: SSHHost) => void;
}

export const SSHHostsTab: React.FC<SSHHostsTabProps> = ({
  accentColor = '#00d2b4',
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

  // Key generator modal
  const [generatedKey, setGeneratedKey] = useState<SSHKeyPair | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

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

  const handleGenerateKey = async () => {
    setIsGenerating(true);
    try {
      const kp = await api.generateSSHKey('config-studio-core');
      setGeneratedKey(kp);
    } catch (err) {
      console.error('Failed to generate key:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyPublicKey = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey.publicKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
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
            variant="secondary"
            size="sm"
            onClick={handleGenerateKey}
            disabled={isGenerating}
            icon={<Key size={13} />}
          >
            {isGenerating ? 'Генерация...' : 'ED25519 ключ'}
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

      {/* Generated Key Modal / Card */}
      {generatedKey && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-base-border pb-2.5">
            <div className="flex items-center space-x-2">
              <Shield size={15} className="text-emerald-500 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Новая ключевая пара ED25519 сгенерирована
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setGeneratedKey(null)}
            >
              Закрыть
            </Button>
          </div>
          <div>
            <Input
              label="Публичный ключ (добавьте в ~/.ssh/authorized_keys на сервере):"
              readOnly
              value={generatedKey.publicKey}
              className="font-mono text-emerald-600 dark:text-emerald-300 select-all"
              rightElement={
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={handleCopyPublicKey}
                  icon={copiedKey ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                >
                  {copiedKey ? 'Скопировано' : 'Копировать'}
                </Button>
              }
            />
          </div>
        </Card>
      )}

      {/* Host Editing Form */}
      {isEditing && (
        <Card className="p-4">
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
                onChange={(val) => setEditingHost({ ...editingHost, authType: val })}
                options={authTypeOptions}
                size="sm"
              />
            </div>

            {/* Conditional credentials */}
            {editingHost.authType === 'password' && (
              <Input
                label="Пароль"
                type="password"
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
          hosts.map((host) => {
            const isTesting = testingId === host.id;
            const res = testResult?.id === host.id ? testResult : null;
            return (
              <div
                key={host.id}
                className="p-3.5 bg-base-surface rounded-xl border border-base-border flex items-center justify-between hover:border-base-border transition"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="p-2 rounded-lg bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] shrink-0">
                    <Server size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {host.name || host.host}
                      </span>
                      <Badge variant="neutral" size="xs" className="font-mono">
                        {host.user}@{host.host}:{host.port || 22}
                      </Badge>
                      <Badge variant={host.authType === 'vault' ? 'accent' : 'info'} size="xs" className="uppercase font-mono font-bold tracking-wider">
                        {host.authType}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                      Путь: {host.defaultPath || '/etc'}
                    </div>
                  </div>
                </div>

                {/* Status / Test result */}
                <div className="flex items-center space-x-2">
                  {res && (
                    <StatusBadge
                      status={res.success ? 'success' : 'error'}
                      size="sm"
                      icon={res.success ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
                      title={res.error}
                    >
                      {res.success ? `OK (${res.latencyMs}мс)` : 'Ошибка'}
                    </StatusBadge>
                  )}

                  <button
                    type="button"
                    onClick={() => handleTestConnection(host)}
                    disabled={isTesting}
                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10 rounded transition cursor-pointer"
                    title="Проверить связь с сервером"
                  >
                    <RefreshCw size={13} className={isTesting ? 'animate-spin' : ''} />
                  </button>

                  {onOpenTerminal && (
                    <button
                      type="button"
                      onClick={() => onOpenTerminal(host)}
                      className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 rounded transition cursor-pointer"
                      title="Открыть терминал к этому хосту"
                    >
                      <Terminal size={13} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleEdit(host)}
                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10 rounded transition cursor-pointer"
                    title="Редактировать"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(host)}
                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 rounded transition cursor-pointer"
                    title="Удалить"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
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
      <Modal
        isOpen={isOpenSSHModalOpen}
        onClose={() => setIsOpenSSHModalOpen(false)}
        size="lg"
      >
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
                Скопируйте этот блок в ваш файл <code className="text-accent bg-black/20 px-1 py-0.5 rounded">~/.ssh/config</code> для быстрого подключения к любому серверу командой <code className="text-accent">ssh &lt;имя_хоста&gt;</code>:
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
                  onClick={handleDownloadOpenSSH}
                  icon={<Download size={13} />}
                >
                  Скачать config
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                Вставьте содержимое файла <code className="text-accent bg-black/20 px-1 py-0.5 rounded">~/.ssh/config</code> для пакетного импорта хостов в ядро:
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
                  onClick={handleImportOpenSSH}
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
            onClick={() => setIsOpenSSHModalOpen(false)}
          >
            Закрыть
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Migration & Vault Backup Modal */}
      <Modal
        isOpen={isMigrationModalOpen}
        onClose={() => setIsMigrationModalOpen(false)}
        size="lg"
      >
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
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Мастер-пароль для шифрования архива</label>
                <input
                  type="password"
                  value={exportPassphrase}
                  onChange={(e) => setExportPassphrase(e.target.value)}
                  placeholder="Введите надежный пароль..."
                  className="w-full text-xs px-3 py-2 bg-black/30 border border-base-border rounded-xl text-white focus:outline-none focus:border-accent"
                />
              </div>
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
                  onClick={handleExportPortableBackup}
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
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Мастер-пароль от архива</label>
                <input
                  type="password"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  placeholder="Пароль, заданный при экспорте..."
                  className="w-full text-xs px-3 py-2 bg-black/30 border border-base-border rounded-xl text-white focus:outline-none focus:border-accent"
                />
              </div>
              {migrationStatus && (
                <div className={`text-xs font-semibold ${migrationStatus.includes('Ошибка') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {migrationStatus}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleImportPortableBackup}
                  disabled={isMigrating || !selectedBackupFile || !importPassphrase.trim()}
                  icon={<Upload size={13} />}
                >
                  {isMigrating ? 'Расшифровка...' : 'Восстановить секреты'}
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
            onClick={() => setIsMigrationModalOpen(false)}
          >
            Закрыть
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default SSHHostsTab;
