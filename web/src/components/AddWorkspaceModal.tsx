import React, { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Folder,
  Server,
  Box,
  Shield,
  Terminal,
  Globe,
  Cpu,
  Database,
  Lock,
} from 'lucide-react';
import { WorkspaceRoot, Settings } from '../types';
import { translations } from '../utils/i18n';
import { Modal, Input, Button, Toggle, Dropdown, DropdownOption } from './ui';

interface AddWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (root: Partial<WorkspaceRoot>) => Promise<void>;
  editingWorkspace?: WorkspaceRoot | null;
  settings: Settings;
}

const iconOptions: DropdownOption[] = [
  { value: 'folder', label: 'Папка (Folder)', icon: <Folder size={14} className="text-amber-400" /> },
  { value: 'server', label: 'Сервер (Server / Fleet)', icon: <Server size={14} className="text-blue-400" /> },
  { value: 'box', label: 'Контейнеры (Docker / Podman)', icon: <Box size={14} className="text-cyan-400" /> },
  { value: 'shield', label: 'Безопасность (Clash / VPN)', icon: <Shield size={14} className="text-emerald-400" /> },
  { value: 'terminal', label: 'Системный (System / Scripts)', icon: <Terminal size={14} className="text-purple-400" /> },
  { value: 'globe', label: 'Веб-сервер (Nginx / Web)', icon: <Globe size={14} className="text-indigo-400" /> },
  { value: 'cpu', label: 'Службы (Systemd / Daemons)', icon: <Cpu size={14} className="text-rose-400" /> },
  { value: 'database', label: 'Базы данных (Database / Storage)', icon: <Database size={14} className="text-teal-400" /> },
];

export const AddWorkspaceModal: React.FC<AddWorkspaceModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingWorkspace,
  settings,
}) => {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [icon, setIcon] = useState('folder');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = translations[settings.language] || translations.ru;

  useEffect(() => {
    if (editingWorkspace) {
      setId(editingWorkspace.id);
      setName(editingWorkspace.name);
      setPath(editingWorkspace.path);
      setReadOnly(editingWorkspace.readOnly);
      setIcon(editingWorkspace.icon || 'folder');
    } else {
      setId('');
      setName('');
      setPath('');
      setReadOnly(false);
      setIcon('folder');
    }
    setError(null);
  }, [editingWorkspace, isOpen]);

  // Auto-slugify name to ID when creating new
  const handleNameChange = (val: string) => {
    setName(val);
    if (!editingWorkspace && !id) {
      const slug = val
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      setId(slug);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = id.trim();
    const cleanPath = path.trim();

    if (!cleanId) {
      setError(t.workspaceId + ' обязателен');
      return;
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanId)) {
      setError('ID должен содержать только латиницу, цифры, дефис или подчеркивание');
      return;
    }
    if (!cleanPath) {
      setError(t.workspacePath + ' обязателен');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSave({
        id: cleanId,
        name: name.trim() || cleanId,
        path: cleanPath,
        readOnly,
        icon,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения рабочей области');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header
        title={editingWorkspace ? t.editWorkspaceTitle || 'Настройки рабочей папки' : t.addWorkspaceTitle || 'Добавить рабочую папку в проект'}
        subtitle="Подключение локального или системного каталога хоста в рабочую область (Multi-Root Workspace)"
        icon={editingWorkspace ? <Folder className="w-5 h-5 text-accent" /> : <Folder className="w-5 h-5 text-accent" />}
      />

      <form onSubmit={handleSubmit}>
        <Modal.Body className="space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-500 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label={t.workspaceName || 'Название папки'}
              placeholder="Nginx Fleet / Clash Meta"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              autoFocus
            />

            <Input
              label={t.workspaceId || 'Идентификатор (ID)'}
              placeholder="nginx, clash, docker"
              value={id}
              onChange={(e) => setId(e.target.value)}
              disabled={!!editingWorkspace}
            />
          </div>

          <Input
            label={t.workspacePath || 'Путь на сервере / ПК'}
            placeholder="/etc/nginx или C:\Users\user\configs"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            description="Абсолютный путь к директории на хосте, где запущен Config Studio"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <Dropdown
              label={t.workspaceIcon || 'Иконка папки'}
              options={iconOptions}
              value={icon}
              onChange={(val) => setIcon(String(val))}
              size="sm"
            />

            <div className="flex flex-col justify-end">
              <div className="p-3 bg-gray-100 dark:bg-black/20 border border-base-border rounded-xl flex items-center justify-between">
                <div className="space-y-0.5 pr-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center space-x-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t.workspaceReadOnly || 'Режим Read-Only'}</span>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    Защита от изменений
                  </p>
                </div>
                <Toggle
                  checked={readOnly}
                  onChange={(val) => setReadOnly(val)}
                  size="sm"
                />
              </div>
            </div>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t.cancel || 'Отмена'}
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {editingWorkspace ? 'Сохранить изменения' : t.addWorkspace || 'Добавить папку'}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
};
