import React, { useState } from 'react';
import { Key, Copy, Check, Download, Shield, Database, CheckCircle2 } from 'lucide-react';
import { Modal, Button, Badge, Card } from '../../ui';
import { SSHKeyPair } from '../../../types';
import { api } from '../../../services/api';

interface SSHKeyGeneratedModalProps {
  isOpen: boolean;
  onClose: () => void;
  keyPair: SSHKeyPair | null;
  onSavedToVault?: () => void;
}

export const SSHKeyGeneratedModal: React.FC<SSHKeyGeneratedModalProps> = ({
  isOpen,
  onClose,
  keyPair,
  onSavedToVault,
}) => {
  const [copiedPublic, setCopiedPublic] = useState(false);
  const [copiedPrivate, setCopiedPrivate] = useState(false);
  const [isSavingToVault, setIsSavingToVault] = useState(false);
  const [savedToVault, setSavedToVault] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  if (!keyPair) return null;

  const handleCopyPublic = () => {
    navigator.clipboard.writeText(keyPair.publicKey);
    setCopiedPublic(true);
    setTimeout(() => setCopiedPublic(false), 2000);
  };

  const handleCopyPrivate = () => {
    const priv = keyPair.privateKey || (keyPair as any).privateKeyPEM || '';
    navigator.clipboard.writeText(priv);
    setCopiedPrivate(true);
    setTimeout(() => setCopiedPrivate(false), 2000);
  };

  const handleDownloadPrivateKey = () => {
    const priv = keyPair.privateKey || (keyPair as any).privateKeyPEM || '';
    const blob = new Blob([priv], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'id_ed25519';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSaveToVault = async () => {
    setIsSavingToVault(true);
    setVaultError(null);
    try {
      const priv = keyPair.privateKey || (keyPair as any).privateKeyPEM || '';
      const title = `SSH Key (${keyPair.fingerprint ? keyPair.fingerprint.replace('SHA256:', '').slice(0, 10) : 'Ed25519'})`;
      const secretId = 'id_' + Date.now();
      await api.saveSecret({
        id: secretId,
        title,
        type: 'ssh_key',
        scope: 'shared',
        value: priv,
      });
      setSavedToVault(true);
      onSavedToVault?.();
    } catch (err: any) {
      console.error('Failed to save key to vault:', err);
      setVaultError(err?.message || 'Не удалось сохранить ключ в Сейф');
    } finally {
      setIsSavingToVault(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header
        icon={<Shield className="text-emerald-500 w-5 h-5" />}
        title="Сгенерирован SSH-ключ (Ed25519)"
        subtitle="Современная и криптостойкая пара ключей для SSH-авторизации"
      />
      <Modal.Body className="p-5 space-y-4">
        {keyPair.fingerprint && (
          <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Отпечаток:</span>
            <Badge variant="neutral" size="sm">
              {keyPair.fingerprint}
            </Badge>
          </div>
        )}

        {/* Public Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-semibold text-gray-800 dark:text-gray-200">
              Открытый ключ (Public Key)
            </label>
            <span className="text-[11px] text-gray-400">
              для ~/.ssh/authorized_keys на сервере
            </span>
          </div>
          <div className="relative">
            <textarea
              readOnly
              rows={3}
              value={keyPair.publicKey}
              className="w-full bg-black/5 dark:bg-black/30 border border-base-border rounded-xl p-2.5 text-xs font-mono text-emerald-600 dark:text-emerald-400 select-all resize-none focus:outline-none"
            />
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handleCopyPublic}
              className="absolute top-2 right-2 shadow-sm"
              icon={copiedPublic ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            >
              {copiedPublic ? 'Скопировано' : 'Копировать'}
            </Button>
          </div>
        </div>

        {/* Private Key section */}
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <Key size={14} />
              <span>Закрытый ключ (Private Key)</span>
            </div>
            <Badge variant="warning" size="sm">
              Секретно
            </Badge>
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
            Сохраните приватный ключ в зашифрованный Сейф приложения или скачайте файл <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono">id_ed25519</code> на свой компьютер.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleDownloadPrivateKey}
              icon={<Download size={13} />}
            >
              Скачать id_ed25519
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyPrivate}
              icon={copiedPrivate ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            >
              {copiedPrivate ? 'Скопировано' : 'Копировать PEM'}
            </Button>
          </div>
        </div>

        {/* Vault Save Action */}
        <Card className="p-3.5 flex items-center justify-between gap-3 bg-emerald-500/5 border-emerald-500/20">
          <div className="flex items-center space-x-2.5">
            <Database size={16} className="text-emerald-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                Зашифрованное хранилище Vault
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                Доступен для SSH хостов и SFTP соединений
              </div>
            </div>
          </div>
          {savedToVault ? (
            <Badge variant="success" size="md" icon={<CheckCircle2 size={13} />}>
              В Сейфе
            </Badge>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isSavingToVault}
              onClick={handleSaveToVault}
              icon={<Database size={13} />}
            >
              {isSavingToVault ? 'Сохранение...' : 'Сохранить в Сейф'}
            </Button>
          )}
        </Card>
        {vaultError && (
          <div className="text-xs text-red-500">{vaultError}</div>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-end p-4">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Готово
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
