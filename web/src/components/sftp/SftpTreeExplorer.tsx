import React, { useState, useEffect, useRef } from 'react';
import {
  Server,
  Folder,
  FileCode,
  FileText,
  RefreshCw,
  CornerLeftUp,
  Terminal,
  Settings as SettingsIcon,
  Plus,
  Trash2,
  Edit2,
  UploadCloud,
  Download,
  AlertCircle,
  FolderPlus,
  FilePlus,
  Home,
  CheckCircle,
} from 'lucide-react';
import { FileFormatIcon } from '../icons/FileFormatIcon';
import { SSHHost, SFTPFileInfo, Settings } from '../../types';
import { sshHostService } from '../../services/sshHosts';
import { api } from '../../services/api';
import { formatBytes } from '../../utils/color';
import { translations } from '../../utils/i18n';

interface SftpTreeExplorerProps {
  settings: Settings;
  onOpenFile: (host: SSHHost, remotePath: string) => void;
  onOpenTerminal?: (host: SSHHost) => void;
  onOpenSettingsSsh?: () => void;
  onCloseMobileDrawer?: () => void;
}

export const SftpTreeExplorer: React.FC<SftpTreeExplorerProps> = ({
  settings,
  onOpenFile,
  onOpenTerminal,
  onOpenSettingsSsh,
  onCloseMobileDrawer,
}) => {
  const [hosts, setHosts] = useState<SSHHost[]>(() => sshHostService.list());
  const [selectedHostId, setSelectedHostId] = useState<string>(() => {
    const last = sshHostService.getLastActiveHostId();
    const available = sshHostService.list();
    if (last && available.some((h) => h.id === last)) return last;
    return available[0]?.id || '';
  });

  const [currentPath, setCurrentPath] = useState<string>('/etc');
  const [entries, setEntries] = useState<SFTPFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isEditingPath, setIsEditingPath] = useState<boolean>(false);
  const [pathInputVal, setPathInputVal] = useState<string>('/etc');
  const fileUploadInputRef = useRef<HTMLInputElement>(null);

  const t = translations[settings.language] || translations.ru;
  const activeHost = hosts.find((h) => h.id === selectedHostId) || null;

  // Subscribe to host changes
  useEffect(() => {
    const unsub = sshHostService.subscribe((updated) => {
      setHosts(updated);
      if (updated.length > 0 && (!selectedHostId || !updated.some((h) => h.id === selectedHostId))) {
        const nextId = updated[0].id;
        setSelectedHostId(nextId);
        sshHostService.setLastActiveHostId(nextId);
      }
    });
    return () => unsub();
  }, [selectedHostId]);

  useEffect(() => {
    const handleOpenHost = (e: any) => {
      const detail = e.detail;
      if (!detail) return;
      const currentHosts = sshHostService.list();
      setHosts(currentHosts);
      let targetHost = currentHosts.find(
        (h) => h.id === detail.id || (h.host === detail.host && h.user === (detail.user || 'root'))
      );
      if (targetHost) {
        setSelectedHostId(targetHost.id);
        sshHostService.setLastActiveHostId(targetHost.id);
        const lastPath = sshHostService.getLastSftpPath(targetHost.id) || '/etc';
        loadDirectory(lastPath, targetHost);
      }
    };
    window.addEventListener('cs:open-sftp-host', handleOpenHost);
    return () => window.removeEventListener('cs:open-sftp-host', handleOpenHost);
  }, []);

  // Load directory when active host or path changes
  useEffect(() => {
    if (!activeHost) {
      setEntries([]);
      return;
    }
    const lastPath = sshHostService.getLastSftpPath(activeHost.id) || '/etc';
    setCurrentPath(lastPath);
    setPathInputVal(lastPath);
    loadDirectory(lastPath, activeHost);
  }, [selectedHostId]);

  const loadDirectory = async (dirPath: string, host: SSHHost | null = activeHost) => {
    if (!host) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.sftpList({
        host: host.host,
        port: host.port || 22,
        user: host.user || 'root',
        authType: host.authType,
        password: host.password,
        privateKey: host.privateKey,
        passphrase: host.passphrase,
        identityId: host.identityId,
        path: dirPath,
      });

      const sorted = (res.entries || []).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setEntries(sorted);
      setCurrentPath(res.path || dirPath);
      setPathInputVal(res.path || dirPath);
      sshHostService.setLastSftpPath(host.id, res.path || dirPath);
    } catch (err: any) {
      console.error('[SFTP Explorer] Failed to list directory:', err);
      setErrorMessage(err.message || 'Ошибка подключения по SFTP');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectHost = (hostId: string) => {
    setSelectedHostId(hostId);
    sshHostService.setLastActiveHostId(hostId);
    const lastPath = sshHostService.getLastSftpPath(hostId) || '/etc';
    setCurrentPath(lastPath);
    setPathInputVal(lastPath);
  };

  const navigateTo = (path: string) => {
    const clean = path.trim() || '/';
    setCurrentPath(clean);
    setPathInputVal(clean);
    loadDirectory(clean);
  };

  const navigateUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const up = '/' + parts.join('/');
    navigateTo(up || '/');
  };

  const handleOpenFileClick = (entry: SFTPFileInfo) => {
    if (!activeHost) return;
    onOpenFile(activeHost, entry.path);
    onCloseMobileDrawer?.();
  };

  const handleCreateFile = async () => {
    if (!activeHost) return;
    const name = prompt(t.newFilePrompt || 'Введите имя нового файла:');
    if (!name?.trim()) return;
    const fullPath = currentPath.replace(/\/+$/, '') + '/' + name.trim();
    try {
      await api.sftpWrite({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user || 'root',
        authType: activeHost.authType,
        password: activeHost.password,
        identityId: activeHost.identityId,
        path: fullPath,
        content: '',
      });
      await loadDirectory(currentPath);
      onOpenFile(activeHost, fullPath);
      onCloseMobileDrawer?.();
    } catch (err: any) {
      alert(`Не удалось создать файл: ${err.message}`);
    }
  };

  const handleCreateFolder = async () => {
    if (!activeHost) return;
    const name = prompt(t.newFolderPrompt || 'Введите имя новой папки:');
    if (!name?.trim()) return;
    const fullPath = currentPath.replace(/\/+$/, '') + '/' + name.trim();
    try {
      await api.sftpMkdir({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user || 'root',
        authType: activeHost.authType,
        password: activeHost.password,
        identityId: activeHost.identityId,
        path: fullPath,
      });
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Не удалось создать папку: ${err.message}`);
    }
  };

  const handleDeleteItem = async (entry: SFTPFileInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeHost) return;
    if (!confirm(`Удалить ${entry.isDir ? 'папку' : 'файл'} "${entry.name}" на сервере ${activeHost.name || activeHost.host}?`)) {
      return;
    }
    try {
      await api.sftpDelete({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user || 'root',
        authType: activeHost.authType,
        password: activeHost.password,
        identityId: activeHost.identityId,
        path: entry.path,
      });
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Не удалось удалить: ${err.message}`);
    }
  };

  const handleRenameItem = async (entry: SFTPFileInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeHost) return;
    const newName = prompt('Новое имя:', entry.name);
    if (!newName?.trim() || newName.trim() === entry.name) return;
    const parentDir = entry.path.substring(0, entry.path.lastIndexOf('/')) || '';
    const newPath = (parentDir ? parentDir + '/' : '/') + newName.trim();
    try {
      await api.sftpRename({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user || 'root',
        authType: activeHost.authType,
        password: activeHost.password,
        identityId: activeHost.identityId,
        path: entry.path,
        newPath,
      });
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Не удалось переименовать: ${err.message}`);
    }
  };

  const handleDownloadFile = async (entry: SFTPFileInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeHost) return;
    try {
      const data = await api.sftpRead({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user || 'root',
        authType: activeHost.authType,
        password: activeHost.password,
        identityId: activeHost.identityId,
        path: entry.path,
      });
      const blob = new Blob([data.content || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Ошибка скачивания: ${err.message}`);
    }
  };

  const handleUploadLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeHost) return;
    try {
      setIsLoading(true);
      const content = await file.text();
      const remoteTarget = currentPath.replace(/\/+$/, '') + '/' + file.name;
      await api.sftpWrite({
        host: activeHost.host,
        port: activeHost.port || 22,
        user: activeHost.user || 'root',
        authType: activeHost.authType,
        password: activeHost.password,
        identityId: activeHost.identityId,
        path: remoteTarget,
        content,
      });
      if (fileUploadInputRef.current) fileUploadInputRef.current.value = '';
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Ошибка загрузки: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // If no hosts are configured
  if (hosts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-5 text-center select-none bg-base-surface">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-3">
          <Server className="w-6 h-6" />
        </div>
        <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">
          {settings.language === 'ru' ? 'Нет подключенных серверов' : 'No SFTP servers configured'}
        </h4>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4 leading-relaxed max-w-xs">
          {settings.language === 'ru'
            ? 'Добавьте SSH/SFTP сервер для удаленного просмотра и редактирования файлов'
            : 'Add an SSH/SFTP server to browse and edit remote files'}
        </p>
        <button
          type="button"
          onClick={onOpenSettingsSsh}
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-accent text-white hover:opacity-90 active:scale-95 transition shadow-xs flex items-center space-x-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{settings.language === 'ru' ? 'Настроить серверы' : 'Configure servers'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 select-none bg-base-surface">
      {/* 1. Host Picker Toolbar */}
      <div className="p-2.5 border-b border-base-border bg-base-surface flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex-1 min-w-0">
          <select
            value={selectedHostId}
            onChange={(e) => handleSelectHost(e.target.value)}
            className="w-full bg-black/10 dark:bg-black/30 border border-base-border rounded-lg px-2 py-1 text-xs text-gray-900 dark:text-gray-100 font-semibold focus:outline-hidden focus:border-accent cursor-pointer truncate"
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id} className="bg-gray-900 text-gray-100">
                {h.name || h.host} ({h.user || 'root'}@{h.host}:{h.port || 22})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {/* Quick Terminal Action */}
          {activeHost && onOpenTerminal && (
            <button
              type="button"
              onClick={() => onOpenTerminal(activeHost)}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-accent dark:text-gray-400 dark:hover:text-accent transition"
              title="Открыть SSH терминал внизу"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Refresh Directory */}
          <button
            type="button"
            onClick={() => loadDirectory(currentPath)}
            disabled={isLoading}
            className={`p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition ${
              isLoading ? 'animate-spin text-accent' : ''
            }`}
            title="Обновить каталог"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Manage Hosts in Settings */}
          {onOpenSettingsSsh && (
            <button
              type="button"
              onClick={onOpenSettingsSsh}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition"
              title="Управление SSH хостами"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Path Breadcrumb / Editable Bar */}
      <div className="px-2.5 py-1.5 border-b border-base-border/70 bg-black/5 dark:bg-black/20 flex items-center justify-between text-xs gap-1.5 shrink-0">
        <div className="flex items-center space-x-1 shrink-0 text-gray-400">
          <button
            type="button"
            onClick={() => navigateTo('/')}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-accent transition"
            title="Перейти в корень (/)"
          >
            /
          </button>
          <button
            type="button"
            onClick={() => navigateTo('~')}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-accent transition"
            title="Перейти в домашнюю папку (~)"
          >
            <Home className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={navigateUp}
            disabled={currentPath === '/' || currentPath === ''}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="На уровень выше (..)"
          >
            <CornerLeftUp className="w-3 h-3" />
          </button>
        </div>

        {/* Path Text or Input */}
        <div className="flex-1 min-w-0">
          {isEditingPath ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setIsEditingPath(false);
                navigateTo(pathInputVal);
              }}
            >
              <input
                type="text"
                value={pathInputVal}
                onChange={(e) => setPathInputVal(e.target.value)}
                onBlur={() => {
                  setIsEditingPath(false);
                  navigateTo(pathInputVal);
                }}
                autoFocus
                className="w-full bg-black/30 border border-accent rounded px-1.5 py-0.5 text-xs font-mono text-gray-100 focus:outline-hidden"
              />
            </form>
          ) : (
            <div
              onClick={() => setIsEditingPath(true)}
              className="font-mono text-[11px] text-gray-600 dark:text-gray-300 truncate hover:text-accent cursor-text px-1 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition"
              title="Нажмите для прямого ввода пути"
            >
              {currentPath}
            </div>
          )}
        </div>
      </div>

      {/* 3. Directory Content Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar min-h-0">
        {errorMessage && (
          <div className="p-3 my-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 space-y-2">
            <div className="flex items-center space-x-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Не удалось подключиться</span>
            </div>
            <p className="text-[11px] break-all opacity-90">{errorMessage}</p>
            <button
              type="button"
              onClick={() => loadDirectory(currentPath)}
              className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[11px] font-semibold transition"
            >
              Повторить попытку
            </button>
          </div>
        )}

        {isLoading && entries.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400 space-y-2">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto text-accent" />
            <p>Загрузка каталога...</p>
          </div>
        )}

        {!isLoading && !errorMessage && entries.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400 space-y-1">
            <Folder className="w-6 h-6 mx-auto opacity-30 text-accent" />
            <p>{t.emptyFolder || 'Каталог пуст'}</p>
          </div>
        )}

        {entries.map((entry) => {
          if (entry.isDir) {
            return (
              <div
                key={entry.path}
                onClick={() => navigateTo(entry.path)}
                className="group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
                title={`Папка: ${entry.path}`}
              >
                <div className="flex items-center space-x-2 truncate min-w-0">
                  <Folder className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="truncate font-medium">{entry.name}</span>
                </div>

                <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-0.5 shrink-0 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => handleRenameItem(entry, e)}
                    className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    title="Переименовать"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(entry, e)}
                    className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-500"
                    title="Удалить папку"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          }

          // File item
          return (
            <div
              key={entry.path}
              onClick={() => handleOpenFileClick(entry)}
              className="group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
              title={`${entry.name} (${formatBytes(entry.size)}) — кликните для открытия в редакторе`}
            >
              <div className="flex items-center space-x-2 truncate min-w-0">
                <FileFormatIcon filename={entry.name} isDir={false} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate font-mono text-[11px] text-gray-800 dark:text-gray-200">
                  {entry.name}
                </span>
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                <span className="text-[10px] font-mono text-gray-400 group-hover:hidden">
                  {formatBytes(entry.size)}
                </span>

                <div className="hidden group-hover:flex items-center space-x-0.5">
                  <button
                    type="button"
                    onClick={(e) => handleDownloadFile(entry, e)}
                    className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-accent"
                    title="Скачать на ПК"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRenameItem(entry, e)}
                    className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    title="Переименовать"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(entry, e)}
                    className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-500"
                    title="Удалить файл"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. Bottom Quick Actions: + New File, + New Folder, Upload */}
      <div className="p-2 border-t border-base-border bg-base-surface flex items-center justify-between gap-1 text-xs shrink-0">
        <input
          type="file"
          ref={fileUploadInputRef}
          onChange={handleUploadLocalFile}
          className="hidden"
        />

        <button
          type="button"
          onClick={handleCreateFile}
          disabled={!activeHost || isLoading}
          className="flex-1 py-1.5 px-2 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 flex items-center justify-center space-x-1 text-[11px] font-semibold transition"
          title="Создать новый файл на сервере"
        >
          <FilePlus className="w-3 h-3 text-accent" />
          <span>+ Файл</span>
        </button>

        <button
          type="button"
          onClick={handleCreateFolder}
          disabled={!activeHost || isLoading}
          className="flex-1 py-1.5 px-2 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 flex items-center justify-center space-x-1 text-[11px] font-semibold transition"
          title="Создать новую папку на сервере"
        >
          <FolderPlus className="w-3 h-3 text-accent" />
          <span>+ Папка</span>
        </button>

        <button
          type="button"
          onClick={() => fileUploadInputRef.current?.click()}
          disabled={!activeHost || isLoading}
          className="p-1.5 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 transition"
          title="Загрузить локальный файл в эту папку"
        >
          <UploadCloud className="w-3.5 h-3.5 text-accent" />
        </button>
      </div>
    </div>
  );
};
