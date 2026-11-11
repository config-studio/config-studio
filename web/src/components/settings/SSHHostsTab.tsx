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
import { ConfirmModal, EmptyState, Dropdown, DropdownOption } from '../ui';

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
          <button
            type="button"
            onClick={handleGenerateKey}
            disabled={isGenerating}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-gray-700 transition"
          >
            <Key size={13} />
            <span>{isGenerating ? 'Генерация...' : 'Создать ED25519 ключ'}</span>
          </button>
          <button
            type="button"
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
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-black transition shadow"
            style={{ backgroundColor: accentColor }}
          >
            <Plus size={13} />
            <span>Добавить хост</span>
          </button>
        </div>
      </div>

      {/* Generated Key Modal / Card */}
      {generatedKey && (
        <div className="p-4 rounded-xl bg-base-surface border border-base-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Shield size={15} className="text-emerald-500 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Новая ключевая пара ED25519 сгенерирована
              </span>
            </div>
            <button
              onClick={() => setGeneratedKey(null)}
              className="text-xs text-gray-500 hover:text-[var(--text-primary)] cursor-pointer"
            >
              Закрыть
            </button>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">
              Публичный ключ (добавьте в ~/.ssh/authorized_keys на сервере):
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={generatedKey.publicKey}
                className="flex-1 px-2.5 py-1.5 bg-base-surface border border-base-border rounded font-mono text-xs text-emerald-600 dark:text-emerald-300 select-all"
              />
              <button
                onClick={handleCopyPublicKey}
                className="px-3 py-1.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border border-base-border text-xs text-[var(--text-primary)] rounded flex items-center space-x-1 cursor-pointer transition"
              >
                {copiedKey ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedKey ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Host Editing Form */}
      {isEditing && (
        <form onSubmit={handleSaveHost} className="p-4 rounded-xl bg-base-surface border border-base-border space-y-3">
          <div className="flex items-center justify-between border-b border-base-border pb-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {editingHost.id ? 'Редактировать хост' : 'Новый SSH-хост'}
            </span>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-xs text-gray-400 hover:text-[var(--text-primary)]"
            >
              Отмена
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Понятное имя</label>
              <input
                type="text"
                value={editingHost.name || ''}
                onChange={(e) => setEditingHost({ ...editingHost, name: e.target.value })}
                placeholder="Production Web"
                className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Хост / IP-адрес *</label>
              <input
                type="text"
                required
                value={editingHost.host || ''}
                onChange={(e) => setEditingHost({ ...editingHost, host: e.target.value })}
                placeholder="192.168.1.100 или server.com"
                className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Порт</label>
              <input
                type="number"
                value={editingHost.port || 22}
                onChange={(e) => setEditingHost({ ...editingHost, port: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Пользователь *</label>
              <input
                type="text"
                required
                value={editingHost.user || ''}
                onChange={(e) => setEditingHost({ ...editingHost, user: e.target.value })}
                placeholder="root"
                className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs text-[var(--text-primary)]"
              />
            </div>
            <div>
              <Dropdown
                label="Тип авторизации"
                value={editingHost.authType || 'password'}
                onChange={(val) => setEditingHost({ ...editingHost, authType: val })}
                options={authTypeOptions}
                size="sm"
              />
            </div>
          </div>

          {/* Conditional credentials */}
          {editingHost.authType === 'password' && (
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Пароль</label>
              <input
                type="password"
                value={editingHost.password || ''}
                onChange={(e) => setEditingHost({ ...editingHost, password: e.target.value })}
                placeholder="Введите пароль SSH"
                className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs text-[var(--text-primary)]"
              />
            </div>
          )}

          {editingHost.authType === 'private_key' && (
            <div className="space-y-2">
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Приватный ключ (OpenSSH / RSA / Ed25519)</label>
                <textarea
                  rows={3}
                  value={editingHost.privateKey || ''}
                  onChange={(e) => setEditingHost({ ...editingHost, privateKey: e.target.value })}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                  className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs font-mono text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Passphrase ключа (если задан)</label>
                <input
                  type="password"
                  value={editingHost.passphrase || ''}
                  onChange={(e) => setEditingHost({ ...editingHost, passphrase: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs text-[var(--text-primary)]"
                />
              </div>
            </div>
          )}

          {editingHost.authType === 'vault' && (
            <div>
              <Dropdown
                label="Запись из Сейфа ключей"
                value={editingHost.identityId || ''}
                onChange={(val) => setEditingHost({ ...editingHost, identityId: val })}
                options={identityOptions}
                placeholder="Выберите секрет из хранилища..."
                searchable={identityOptions.length > 5}
                size="sm"
              />
            </div>
          )}

          <div>
            <label className="text-[11px] text-gray-400 block mb-1">Удаленный путь по умолчанию</label>
            <input
              type="text"
              value={editingHost.defaultPath || ''}
              onChange={(e) => setEditingHost({ ...editingHost, defaultPath: e.target.value })}
              placeholder="/etc или /var/www"
              className="w-full px-2.5 py-1.5 bg-base-surface dark:bg-black/30 border border-base-border rounded text-xs text-[var(--text-primary)] font-mono"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-[var(--text-primary)]"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded text-xs font-semibold text-black"
              style={{ backgroundColor: accentColor }}
            >
              Сохранить хост
            </button>
          </div>
        </form>
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
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/5 dark:bg-white/10 text-[var(--text-muted)] font-mono">
                        {host.user}@{host.host}:{host.port || 22}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-400">
                        {host.authType}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                      Путь: {host.defaultPath || '/etc'}
                    </div>
                  </div>
                </div>

                {/* Status / Test result */}
                <div className="flex items-center space-x-2">
                  {res && (
                    <div
                      className={`text-[11px] px-2 py-0.5 rounded flex items-center space-x-1 ${
                        res.success
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'bg-red-500/10 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {res.success ? (
                        <>
                          <CheckCircle size={11} />
                          <span>OK ({res.latencyMs}мс)</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={11} />
                          <span title={res.error}>Ошибка</span>
                        </>
                      )}
                    </div>
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
