import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Server,
  Folder,
  Send,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  FolderPlus,
  Lock,
} from 'lucide-react';
import { SSHHost, SFTPFileInfo } from '../../types';
import { sshHostService } from '../../services/sshHosts';
import { api } from '../../services/api';
import { Dropdown, DropdownOption, Modal, Button, Input, StatusBadge, Card } from '@config-studio/ui';

interface SftpSendModalProps {
  filePath: string;
  rootId?: string;
  fileName: string;
  fileContent?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  accentColor?: string;
}

export const SftpSendModal: React.FC<SftpSendModalProps> = ({
  filePath,
  rootId,
  fileName,
  fileContent,
  isOpen,
  onClose,
  onSuccess,
  accentColor = '#00d2b4',
}) => {
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [remotePath, setRemotePath] = useState<string>('/etc');
  const [isSending, setIsSending] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Directory picker state
  const [pickerEntries, setPickerEntries] = useState<SFTPFileInfo[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const hostOptions = useMemo<DropdownOption[]>(() => {
    return hosts.map((h) => ({
      value: h.id,
      label: h.name || h.host,
      subtitle: `${h.user}@${h.host}:${h.port || 22}`,
      badge: h.authType === 'password' ? 'pass' : h.authType === 'vault' ? 'vault' : 'key',
      badgeColor: 'blue',
      icon: <Server size={14} />,
      statusDot: 'online',
    }));
  }, [hosts]);

  useEffect(() => {
    if (!isOpen) {
      setStatusMessage(null);
      setIsBrowsing(false);
      return;
    }

    const availableHosts = sshHostService.list();
    setHosts(availableHosts);

    if (availableHosts.length > 0) {
      const lastHostId = sshHostService.getLastActiveHostId();
      const defaultHost = availableHosts.find((h) => h.id === lastHostId) || availableHosts[0];
      setSelectedHostId(defaultHost.id);

      const lastPath = sshHostService.getLastSftpPath(defaultHost.id);
      setRemotePath(lastPath || '/etc');
    }
  }, [isOpen]);

  const activeHost = hosts.find((h) => h.id === selectedHostId);

  const handleHostChange = (hostId: string) => {
    setSelectedHostId(hostId);
    sshHostService.setLastActiveHostId(hostId);
    const lastPath = sshHostService.getLastSftpPath(hostId);
    setRemotePath(lastPath || '/etc');
    setStatusMessage(null);
    setIsBrowsing(false);
  };

  const loadDirectoryEntries = async (dirPath: string) => {
    if (!activeHost) return;
    setPickerLoading(true);
    try {
      const res = await api.sftpList({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user,
        authType: activeHost.authType,
        password: activeHost.password,
        privateKey: activeHost.privateKey,
        passphrase: activeHost.passphrase,
        identityId: activeHost.identityId,
        path: dirPath,
      });
      setPickerEntries(res.entries.filter((e) => e.isDir));
    } catch (err: any) {
      console.error('[SFTP] Failed to list remote dir:', err);
    } finally {
      setPickerLoading(false);
    }
  };

  const handleOpenBrowser = () => {
    setIsBrowsing(true);
    loadDirectoryEntries(remotePath || '/');
  };

  const handleSelectDirectory = (dirPath: string) => {
    setRemotePath(dirPath);
    loadDirectoryEntries(dirPath);
  };

  const handleNavigateUp = () => {
    if (remotePath === '/' || remotePath === '') return;
    const parts = remotePath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    setRemotePath(parent);
    loadDirectoryEntries(parent);
  };

  const handleSend = async () => {
    if (!activeHost) {
      setStatusMessage({ type: 'error', text: 'Выберите SSH-хост для отправки' });
      return;
    }

    setIsSending(true);
    setStatusMessage(null);

    try {
      // 1. Get file content if not provided
      let contentToSend = fileContent;
      if (contentToSend === undefined) {
        const fileData = await api.getFile(filePath, rootId);
        contentToSend = fileData.content;
      }

      // 2. Format target path
      let cleanDir = remotePath.trim();
      if (!cleanDir.startsWith('/')) cleanDir = '/' + cleanDir;
      if (cleanDir.endsWith('/') && cleanDir.length > 1) {
        cleanDir = cleanDir.slice(0, -1);
      }
      const targetFilePath = `${cleanDir}/${fileName}`;

      // 3. Write via SFTP
      await api.sftpWrite({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user,
        authType: activeHost.authType,
        password: activeHost.password,
        privateKey: activeHost.privateKey,
        passphrase: activeHost.passphrase,
        identityId: activeHost.identityId,
        path: targetFilePath,
        content: contentToSend,
        encoding: 'utf8',
      });

      // 4. Remember last path
      sshHostService.setLastSftpPath(activeHost.id, cleanDir);

      const msg = `Файл ${fileName} успешно отправлен на ${activeHost.name || activeHost.host}:${targetFilePath}`;
      setStatusMessage({ type: 'success', text: msg });
      if (onSuccess) onSuccess(msg);

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Ошибка отправки файла по SFTP',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header
        icon={<Send size={16} style={{ color: accentColor }} />}
        onClose={onClose}
      >
        Отправить по SFTP
      </Modal.Header>

      <Modal.Body className="space-y-4">
        {/* File summary */}
        <Card className="p-3 bg-black/5 dark:bg-black/30 flex items-center justify-between border-base-border">
          <div className="flex items-center space-x-2.5 min-w-0">
            <Folder size={15} className="text-accent shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--text-primary)] truncate">{fileName}</div>
              <div className="text-[11px] text-[var(--text-muted)] truncate font-mono">
                {rootId ? `${rootId}:${filePath}` : filePath}
              </div>
            </div>
          </div>
        </Card>

        {/* Host selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--text-secondary)] flex items-center justify-between">
            <span>Целевой сервер (SSH Хост):</span>
            {hosts.length === 0 && (
              <span className="text-[11px] text-amber-500 dark:text-amber-400 font-medium">Нет сохраненных хостов</span>
            )}
          </label>
          {hosts.length > 0 ? (
            <Dropdown
              options={hostOptions}
              value={selectedHostId}
              onChange={(val) => handleHostChange(val)}
              placeholder="Выберите SSH хост..."
            />
          ) : (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 dark:text-amber-300">
              Добавьте SSH хост в разделе Настройки → SSH & Хосты для отправки файлов.
            </div>
          )}
        </div>

        {/* Remote Directory */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--text-secondary)] flex items-center justify-between">
            <span>Удаленная папка на сервере:</span>
            {activeHost && (
              <button
                type="button"
                onClick={handleOpenBrowser}
                className="text-[11px] text-accent hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <FolderPlus size={12} />
                <span>{isBrowsing ? 'Обновить обзор' : 'Обзор папок'}</span>
              </button>
            )}
          </label>
          <div className="flex items-center space-x-2">
            <Input
              type="text"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              placeholder="/etc/nginx или /var/www"
              className="font-mono text-xs"
            />
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Файл будет сохранен как: <span className="text-[var(--text-primary)] font-mono">{remotePath.replace(/\/$/, '')}/{fileName}</span>
          </div>
        </div>

        {/* Directory Picker Explorer */}
        {isBrowsing && (
          <div className="border border-base-border rounded-xl bg-black/5 dark:bg-black/30 p-2.5 space-y-2 max-h-48 flex flex-col">
            <div className="flex items-center justify-between pb-1 border-b border-base-border text-[11px] text-[var(--text-muted)]">
              <span className="font-mono truncate">{remotePath}</span>
              <Button
                variant="secondary"
                size="xs"
                onClick={handleNavigateUp}
              >
                .. Наверх
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
              {pickerLoading ? (
                <div className="flex items-center justify-center p-4 text-xs text-[var(--text-muted)]">
                  <RefreshCw size={13} className="animate-spin mr-2" /> Загрузка каталогов...
                </div>
              ) : pickerEntries.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)] italic p-2 text-center">
                  Вложенных подкаталогов нет
                </div>
              ) : (
                pickerEntries.map((e) => (
                  <div
                    key={e.path}
                    onClick={() => handleSelectDirectory(e.path)}
                    className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                  >
                    <Folder size={13} className="text-amber-500 dark:text-amber-400 shrink-0" />
                    <span className="truncate flex-1 font-mono">{e.name}</span>
                    <ChevronRight size={11} className="text-gray-400" />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Status Message */}
        {statusMessage && (
          <StatusBadge
            status={statusMessage.type === 'success' ? 'success' : 'error'}
            size="md"
            icon={statusMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            className="w-full justify-start py-2"
          >
            {statusMessage.text}
          </StatusBadge>
        )}
      </Modal.Body>

      <Modal.Footer justify="end">
        <Button
          variant="secondary"
          size="sm"
          onClick={onClose}
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSend}
          disabled={isSending || hosts.length === 0}
          loading={isSending}
          icon={<Send size={13} />}
        >
          {isSending ? 'Отправка...' : 'Отправить на сервер'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SftpSendModal;
