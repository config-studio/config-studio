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
} from 'lucide-react';
import { SSHHost, SSHKeyPair, SecretMeta } from '../../types';
import { sshHostService } from '../../services/sshHosts';
import { api } from '../../services/api';
import { ConfirmModal, EmptyState, Dropdown, DropdownOption, Badge, StatusBadge, Button, Input, Textarea, Card } from '../ui';

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

  return (
    <div className="space-y-6">
      {/* Header action bar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Управление SSH-хостами и ключами</h3>
          <p className="text-xs text-gray-400">
            Сохраненные серверы для терминала, SFTP и управления конфигурациями
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleGenerateKey}
            disabled={isGenerating}
            icon={<Key size={13} />}
          >
            {isGenerating ? 'Генерация...' : 'Создать ED25519 ключ'}
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
    </div>
  );
};

export default SSHHostsTab;
