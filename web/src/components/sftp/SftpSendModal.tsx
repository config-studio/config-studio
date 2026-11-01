import React, { useState, useEffect } from 'react';
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#161b22] border border-gray-700/80 rounded-xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden text-gray-200">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between bg-[#0d1117]">
          <div className="flex items-center space-x-2.5">
            <Send size={16} style={{ color: accentColor }} />
            <h2 className="text-sm font-semibold text-white tracking-wide">
              Отправить по SFTP
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* File summary */}
          <div className="p-3 bg-gray-900/60 rounded-lg border border-gray-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5 min-w-0">
              <Folder size={15} className="text-accent shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{fileName}</div>
                <div className="text-[11px] text-gray-400 truncate font-mono">
                  {rootId ? `${rootId}:${filePath}` : filePath}
                </div>
              </div>
            </div>
          </div>

          {/* Host selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300 flex items-center justify-between">
              <span>Целевой сервер (SSH Хост):</span>
              {hosts.length === 0 && (
                <span className="text-[11px] text-amber-400">Нет сохраненных хостов</span>
              )}
            </label>
            {hosts.length > 0 ? (
              <select
                value={selectedHostId}
                onChange={(e) => handleHostChange(e.target.value)}
                className="w-full px-3 py-2 bg-[#0d1117] border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-accent"
              >
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name || h.host} ({h.user}@{h.host}:{h.port || 22})
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300">
                Добавьте SSH хост в разделе Настройки → SSH & Хосты для отправки файлов.
              </div>
            )}
          </div>

          {/* Remote Directory */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300 flex items-center justify-between">
              <span>Удаленная папка на сервере:</span>
              {activeHost && (
                <button
                  type="button"
                  onClick={handleOpenBrowser}
                  className="text-[11px] text-accent hover:underline flex items-center space-x-1"
                >
                  <FolderPlus size={12} />
                  <span>{isBrowsing ? 'Обновить обзор' : 'Обзор папок'}</span>
                </button>
              )}
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                placeholder="/etc/nginx или /var/www"
                className="flex-1 px-3 py-2 bg-[#0d1117] border border-gray-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-accent"
              />
            </div>
            <div className="text-[11px] text-gray-400">
              Файл будет сохранен как: <span className="text-gray-200 font-mono">{remotePath.replace(/\/$/, '')}/{fileName}</span>
            </div>
          </div>

          {/* Directory Picker Explorer */}
          {isBrowsing && (
            <div className="border border-gray-700 rounded-lg bg-[#0d1117] p-2.5 space-y-2 max-h-48 flex flex-col">
              <div className="flex items-center justify-between pb-1 border-b border-gray-800 text-[11px] text-gray-400">
                <span className="font-mono truncate">{remotePath}</span>
                <button
                  type="button"
                  onClick={handleNavigateUp}
                  className="text-gray-300 hover:text-white px-1.5 py-0.5 rounded bg-gray-800 text-[10px]"
                >
                  .. Наверх
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                {pickerLoading ? (
                  <div className="flex items-center justify-center p-4 text-xs text-gray-400">
                    <RefreshCw size={13} className="animate-spin mr-2" /> Загрузка каталогов...
                  </div>
                ) : pickerEntries.length === 0 ? (
                  <div className="text-xs text-gray-500 italic p-2 text-center">
                    Вложенных подкаталогов нет
                  </div>
                ) : (
                  pickerEntries.map((e) => (
                    <div
                      key={e.path}
                      onClick={() => handleSelectDirectory(e.path)}
                      className="flex items-center space-x-2 px-2 py-1 rounded hover:bg-gray-800/80 cursor-pointer text-xs text-gray-300 transition"
                    >
                      <Folder size={13} className="text-amber-400 shrink-0" />
                      <span className="truncate flex-1">{e.name}</span>
                      <ChevronRight size={11} className="text-gray-500" />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center space-x-2 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle size={14} className="shrink-0" />
              ) : (
                <AlertCircle size={14} className="shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 bg-[#0d1117] flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs text-gray-400 hover:text-white rounded-lg transition"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending || hosts.length === 0}
            className="flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold text-black transition shadow-lg disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
          >
            {isSending ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Отправка...</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Отправить на сервер</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SftpSendModal;
