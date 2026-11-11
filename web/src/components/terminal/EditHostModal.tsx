import React, { useState, useEffect, useMemo } from 'react';
import { Server, Eye, EyeOff, Shield, Key } from 'lucide-react';
import { Modal, Button, Dropdown, DropdownOption, Input, Textarea } from '@config-studio/ui';
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

  const authTypeOptions: DropdownOption[] = [
    { value: 'password', label: 'Пароль', icon: <Key size={14} className="text-amber-400" /> },
    { value: 'private_key', label: 'SSH-ключ (PEM)', icon: <Shield size={14} className="text-emerald-400" /> },
    { value: 'vault', label: 'Сейф секретов', icon: <Server size={14} className="text-purple-400" /> },
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
            <Input
              label="Понятное имя"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Production Web Server"
            />
            <Input
              label={<span>Хост / IP-адрес <span className="text-red-400">*</span></span>}
              required
              value={formData.host || ''}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              placeholder="192.168.0.100 или vps.example.com"
              className="font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Порт"
              type="number"
              value={formData.port || 22}
              onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
              className="font-mono"
            />
            <Input
              label={<span>Пользователь <span className="text-red-400">*</span></span>}
              required
              value={formData.user || ''}
              onChange={(e) => setFormData({ ...formData, user: e.target.value })}
              placeholder="root"
              className="font-mono"
            />
            <Dropdown
              label="Тип авторизации"
              value={formData.authType || 'password'}
              onChange={(val) => setFormData({ ...formData, authType: val })}
              options={authTypeOptions}
              size="sm"
            />
          </div>

          {/* Conditional Auth fields */}
          {formData.authType === 'password' && (
            <Input
              label="Пароль SSH"
              type={showPassword ? 'text' : 'password'}
              value={formData.password || ''}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Введите пароль"
              className="font-mono"
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
          )}

          {formData.authType === 'private_key' && (
            <div className="space-y-3">
              <Textarea
                label="Приватный ключ (OpenSSH / RSA / Ed25519)"
                rows={4}
                value={formData.privateKey || ''}
                onChange={(e) => setFormData({ ...formData, privateKey: e.target.value })}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                className="font-mono"
              />
              <Input
                label="Passphrase ключа (если задан)"
                type="password"
                value={formData.passphrase || ''}
                onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                placeholder="Оставьте пустым, если ключ без пароля"
                className="font-mono"
              />
            </div>
          )}

          {formData.authType === 'vault' && (
            <Dropdown
              label="Запись из Сейфа ключей"
              value={formData.identityId || ''}
              onChange={(val) => setFormData({ ...formData, identityId: val })}
              options={identityOptions}
              placeholder="Выберите секрет из хранилища..."
              searchable={identityOptions.length > 5}
              size="sm"
            />
          )}

          <Input
            label="Удаленный путь по умолчанию (SFTP / Terminal)"
            value={formData.defaultPath || ''}
            onChange={(e) => setFormData({ ...formData, defaultPath: e.target.value })}
            placeholder="/etc или /var/www"
            className="font-mono"
          />
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
