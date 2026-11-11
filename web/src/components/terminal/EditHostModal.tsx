import React, { useState, useEffect } from 'react';
import { Server, Eye, EyeOff, Shield, Key } from 'lucide-react';
import { Modal, Button } from '@config-studio/ui';
import { SSHHost } from '../../types';
import { api } from '../../services/api';

export interface EditHostModalProps {
  isOpen: boolean;
  onClose: () => void;
  host?: SSHHost | null;
  onSave: (host: SSHHost, autoConnect?: boolean) => void;
  accentColor?: string;
}

export const EditHostModal: React.FC<EditHostModalProps> = ({
  isOpen,
  onClose,
  host,
  onSave,
  accentColor = '#00d2b4',
}) => {
  const isEditing = !!host?.id;

  const [formData, setFormData] = useState<Partial<SSHHost>>({
    name: '',
    host: '',
    port: 22,
    user: 'root',
    authType: 'password',
    password: '',
    privateKey: '',
    passphrase: '',
    identityId: '',
    defaultPath: '/etc',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [identities, setIdentities] = useState<any[]>([]);

  useEffect(() => {
    if (host) {
      setFormData({
        name: host.name || '',
        host: host.host || '',
        port: host.port || 22,
        user: host.user || 'root',
        authType: host.authType || 'password',
        password: host.password || '',
        privateKey: host.privateKey || '',
        passphrase: host.passphrase || '',
        identityId: host.identityId || '',
        defaultPath: host.defaultPath || '/etc',
      });
    } else {
      setFormData({
        name: '',
        host: '',
        port: 22,
        user: 'root',
        authType: 'password',
        password: '',
        privateKey: '',
        passphrase: '',
        identityId: '',
        defaultPath: '/etc',
      });
    }
  }, [host, isOpen]);

  useEffect(() => {
    if (isOpen) {
      api.listSecrets()
        .then((items) => {
          setIdentities((items || []).filter((s) => s.type === 'ssh_key' || s.type === 'password' || s.scope === 'shared'));
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent, autoConnect: boolean = false) => {
    e.preventDefault();
    if (!formData.host || !formData.user) return;

    const hostToSave: SSHHost = {
      id: host?.id || 'host-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: formData.name?.trim() || formData.host.trim(),
      host: formData.host.trim(),
      port: Number(formData.port || 22),
      user: formData.user.trim(),
      authType: formData.authType || 'password',
      identityId: formData.identityId,
      password: formData.password,
      privateKey: formData.privateKey,
      passphrase: formData.passphrase,
      defaultPath: formData.defaultPath?.trim() || '/etc',
      createdAt: host?.createdAt || new Date().toISOString(),
    };

    onSave(hostToSave, autoConnect);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header
        icon={
          <div className="p-2 rounded-xl bg-accent/15 text-accent">
            <Server size={18} />
          </div>
        }
        title={isEditing ? 'Редактировать SSH-хост' : 'Добавить новый SSH-хост'}
        subtitle="Параметры удаленного подключения для терминала и SFTP"
      />

      <form onSubmit={(e) => handleSubmit(e, false)}>
        <Modal.Body className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                Понятное имя
              </label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Production Web Server"
                className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                Хост / IP-адрес <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.host || ''}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                placeholder="192.168.0.100 или vps.example.com"
                className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                Порт
              </label>
              <input
                type="number"
                value={formData.port || 22}
                onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                Пользователь <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.user || ''}
                onChange={(e) => setFormData({ ...formData, user: e.target.value })}
                placeholder="root"
                className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                Тип авторизации
              </label>
              <select
                value={formData.authType || 'password'}
                onChange={(e) => setFormData({ ...formData, authType: e.target.value as any })}
                className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs text-[var(--text-primary)] focus:outline-none focus:border-accent transition-colors cursor-pointer"
              >
                <option value="password">Пароль</option>
                <option value="private_key">SSH-ключ (PEM)</option>
                <option value="vault">Сейф секретов</option>
              </select>
            </div>
          </div>

          {/* Conditional Auth fields */}
          {formData.authType === 'password' && (
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                Пароль SSH
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password || ''}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Введите пароль"
                  className="w-full px-3 py-2 pr-9 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {formData.authType === 'private_key' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                  Приватный ключ (OpenSSH / RSA / Ed25519)
                </label>
                <textarea
                  rows={4}
                  value={formData.privateKey || ''}
                  onChange={(e) => setFormData({ ...formData, privateKey: e.target.value })}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent transition-colors custom-scrollbar"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                  Passphrase ключа (если задан)
                </label>
                <input
                  type="password"
                  value={formData.passphrase || ''}
                  onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                  placeholder="Оставьте пустым, если ключ без пароля"
                  className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent transition-colors font-mono"
                />
              </div>
            </div>
          )}

          {formData.authType === 'vault' && (
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
                Запись из Сейфа ключей
              </label>
              <select
                value={formData.identityId || ''}
                onChange={(e) => setFormData({ ...formData, identityId: e.target.value })}
                className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs text-[var(--text-primary)] focus:outline-none focus:border-accent transition-colors cursor-pointer"
              >
                <option value="">Выберите секрет из хранилища...</option>
                {identities.map((id) => (
                  <option key={id.id} value={id.id}>
                    {id.title} ({id.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
              Удаленный путь по умолчанию (SFTP / Terminal)
            </label>
            <input
              type="text"
              value={formData.defaultPath || ''}
              onChange={(e) => setFormData({ ...formData, defaultPath: e.target.value })}
              placeholder="/etc или /var/www"
              className="w-full px-3 py-2 bg-base-surface dark:bg-black/25 border border-base-border rounded-xl text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </Modal.Body>

        <Modal.Footer justify="end" className="gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="secondary" size="sm" type="submit">
            Сохранить
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={(e) => handleSubmit(e, true)}
            className="bg-accent hover:opacity-90 text-slate-950 font-bold"
          >
            {isEditing ? 'Сохранить и открыть' : 'Сохранить и подключиться'}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
};
export default EditHostModal;
