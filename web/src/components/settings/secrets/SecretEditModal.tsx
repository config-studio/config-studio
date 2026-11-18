import React from 'react';
import { Key, Check } from 'lucide-react';
import { SecretType, SecretScope } from '../../../types';
import { Modal, Input, Textarea, Dropdown, DropdownOption, Button } from '../../ui';

interface SecretEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingSecretId: string | null;
  secretTitle: string;
  setSecretTitle: (val: string) => void;
  secretId: string;
  setSecretId: (val: string) => void;
  secretType: SecretType;
  setSecretType: (val: SecretType) => void;
  secretScope: SecretScope;
  setSecretScope: (val: SecretScope) => void;
  secretValue: string;
  setSecretValue: (val: string) => void;
  secretEditorError: string;
  isSavingSecret: boolean;
  onSave: (e: React.FormEvent) => void;
  secretTypeOptions: DropdownOption[];
  secretScopeOptions: DropdownOption[];
  language: string;
  t: any;
}

export const SecretEditModal: React.FC<SecretEditModalProps> = ({
  isOpen,
  onClose,
  editingSecretId,
  secretTitle,
  setSecretTitle,
  secretId,
  setSecretId,
  secretType,
  setSecretType,
  secretScope,
  setSecretScope,
  secretValue,
  setSecretValue,
  secretEditorError,
  isSavingSecret,
  onSave,
  secretTypeOptions,
  secretScopeOptions,
  language,
  t,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header
        title={editingSecretId ? t.editSecretModalTitle : t.addSecretModalTitle}
        icon={<Key className="w-4 h-4 text-accent" />}
      />

      <form onSubmit={onSave}>
        <Modal.Body className="p-5 space-y-4">
          {/* Title */}
          <Input
            label={t.secretTitleLabel}
            value={secretTitle}
            onChange={(e) => setSecretTitle(e.target.value)}
            placeholder={t.secretTitlePlaceholder}
            autoFocus
          />

          {/* ID Identifier */}
          <Input
            label={t.secretIdLabel}
            value={secretId}
            onChange={(e) => setSecretId(e.target.value)}
            placeholder={t.secretIdPlaceholder}
            disabled={!!editingSecretId}
            className="font-mono"
            copyable={!!secretId}
            description={
              !editingSecretId
                ? language === 'en'
                  ? 'Leave blank to generate automatically from title'
                  : 'Оставьте пустым для автогенерации из названия'
                : undefined
            }
          />

          {/* Secret Type & Scope grid */}
          <div className="grid grid-cols-2 gap-3">
            <Dropdown
              label={t.secretTypeLabel}
              value={secretType}
              onChange={(val) => setSecretType(val as SecretType)}
              options={secretTypeOptions}
              size="sm"
            />

            <Dropdown
              label={t.secretScopeLabel}
              value={secretScope}
              onChange={(val) => setSecretScope(val as SecretScope)}
              options={secretScopeOptions}
              size="sm"
            />
          </div>

          {/* Secret Value */}
          {secretType === 'ssh_key' || secretType === 'certificate' || secretType === 'env' ? (
            <Textarea
              label={t.secretValueLabel}
              rows={5}
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder={
                secretType === 'certificate'
                  ? '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'
                  : secretType === 'ssh_key'
                  ? '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'
                  : 'KEY=value\nANOTHER_KEY=value'
              }
              className="font-mono text-xs"
            />
          ) : (
            <Input
              type="password"
              peekable
              copyable={!!secretValue}
              label={t.secretValueLabel}
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder={t.secretValuePlaceholder}
              className="font-mono"
            />
          )}

          {secretEditorError && (
            <p className="text-[11px] text-rose-500 font-medium">{secretEditorError}</p>
          )}
        </Modal.Body>

        <Modal.Footer justify="end">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={isSavingSecret}
            icon={<Check size={12} />}
          >
            {t.saveSecretBtn}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
};
