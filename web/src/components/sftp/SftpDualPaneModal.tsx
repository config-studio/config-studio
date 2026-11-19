import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Server,
  Folder,
  FolderPlus,
  RefreshCw,
  CornerLeftUp,
  Home,
  Trash2,
  Copy,
  Move,
  Search,
  X,
  Laptop,
  CheckCircle,
  AlertCircle,
  UploadCloud,
  Edit2,
  FileCode,
} from 'lucide-react';
import { Modal, ContextMenu, ContextMenuItem } from '../ui';
import { FileFormatIcon } from '../icons/FileFormatIcon';
import { SSHHost, Settings, WorkspaceRoot, SFTPFileInfo } from '../../types';
import { sshHostService } from '../../services/sshHosts';
import { api } from '../../services/api';
import { formatBytes } from '../../utils/color';
import { translations } from '../../utils/i18n';
import { joinSafePath, resolveSafeParentDir } from '../../utils/pathSecurity';

export interface SftpDualPaneModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialHost: SSHHost | null;
  initialPath?: string;
  workspaces?: WorkspaceRoot[];
  activeRootId?: string;
  onOpenFile?: (host: SSHHost | null, path: string) => void;
  settings: Settings;
}

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  permissions?: string;
  modTime?: string;
}

export const SftpDualPaneModal: React.FC<SftpDualPaneModalProps> = ({
  isOpen,
  onClose,
  initialHost,
  initialPath = '/etc',
  workspaces = [],
  activeRootId,
  onOpenFile,
  settings,
}) => {
  const t = translations[settings.language] || translations.ru;
  const [hosts, setHosts] = useState<SSHHost[]>(() => sshHostService.list());

  // Left Pane State (starts with initialHost & initialPath)
  const [leftHostId, setLeftHostId] = useState<string>(() => initialHost?.id || (hosts[0]?.id || 'local'));
  const [leftPath, setLeftPath] = useState<string>(() => initialPath);
  const [leftEntries, setLeftEntries] = useState<FileEntry[]>([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [leftFilter, setLeftFilter] = useState('');
  const [selectedLeftName, setSelectedLeftName] = useState<string | null>(null);

  // Right Pane State (starts in '__picker__' mode as requested by user)
  const [rightHostId, setRightHostId] = useState<string>('__picker__');
  const [rightPath, setRightPath] = useState<string>('/etc');
  const [rightEntries, setRightEntries] = useState<FileEntry[]>([]);
  const [rightLoading, setRightLoading] = useState(false);
  const [rightFilter, setRightFilter] = useState('');
  const [selectedRightName, setSelectedRightName] = useState<string | null>(null);

  // Focus tracking ('left' | 'right')
  const [activePane, setActivePane] = useState<'left' | 'right'>('left');

  // Request sequence IDs to prevent race conditions (RACE-04)
  const leftReqIdRef = useRef(0);
  const rightReqIdRef = useRef(0);

  // Status message & notification toast
  const [statusText, setStatusText] = useState<string>('Готов к работе. Перетащите файлы между панелями.');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // Drag and drop tracking
  const [draggedItem, setDraggedItem] = useState<{ sourcePane: 'left' | 'right'; item: FileEntry } | null>(null);
  const [dragOverPane, setDragOverPane] = useState<'left' | 'right' | null>(null);

  // Context Menu State
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    pane: 'left' | 'right';
    entry?: FileEntry;
  } | null>(null);

  // Sync hosts & timer cleanup
  useEffect(() => {
    const unsub = sshHostService.subscribe((updated) => setHosts(updated));
    return () => {
      unsub();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // Sync props when modal is opened or target changes
  useEffect(() => {
    if (isOpen) {
      const startHost = initialHost?.id || (hosts[0]?.id || 'local');
      setLeftHostId(startHost);
      setLeftPath(initialPath || (startHost === 'local' ? '' : '/etc'));
      setRightHostId('__picker__');
      setSelectedLeftName(null);
      setSelectedRightName(null);
    }
  }, [isOpen, initialHost, initialPath]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Host Options for Dropdown
  const hostDropdownOptions = useMemo(() => {
    const list = [
      { id: 'local', name: '💻 Локальный ПК (Воркспейс)', host: 'localhost', user: 'local' },
      ...hosts,
    ];
    return list;
  }, [hosts]);

  // Load Left Directory (with RACE-04 guard)
  const loadLeftDirectory = useCallback(async (path: string, hostId: string) => {
    if (hostId === '__picker__') return;
    const currentReqId = ++leftReqIdRef.current;
    setLeftLoading(true);
    setSelectedLeftName(null);
    try {
      if (hostId === 'local') {
        const root = activeRootId || workspaces[0]?.id || '';
        const res = await api.getTree(path, root);
        if (currentReqId !== leftReqIdRef.current) return;
        const mapped: FileEntry[] = (res.items || []).map((it) => ({
          name: it.name,
          path: it.path,
          isDir: it.isDir,
          size: it.size || 0,
          permissions: it.isDir ? 'drwxr-xr-x' : '-rw-r--r--',
          modTime: it.modTime || '',
        }));
        setLeftEntries(mapped);
      } else {
        const host = hosts.find((h) => h.id === hostId);
        if (!host) throw new Error('Хост не найден');
        const res = await api.sftpList({
          host: host.host,
          port: host.port || 22,
          user: host.user || 'root',
          authType: host.authType,
          password: host.password,
          identityId: host.identityId,
          path,
        });
        if (currentReqId !== leftReqIdRef.current) return;
        const mapped: FileEntry[] = (res.entries || []).map((it: SFTPFileInfo) => ({
          name: it.name,
          path: it.path,
          isDir: it.isDir,
          size: it.size || 0,
          permissions: it.mode || (it.isDir ? 'drwxr-xr-x' : '-rw-r--r--'),
          modTime: it.modTime ? new Date(it.modTime).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }) : '',
        }));
        setLeftEntries(mapped);
      }
      setLeftPath(path);
    } catch (err: any) {
      if (currentReqId === leftReqIdRef.current) {
        showToast(`Ошибка загрузки слева: ${err.message}`);
      }
    } finally {
      if (currentReqId === leftReqIdRef.current) {
        setLeftLoading(false);
      }
    }
  }, [activeRootId, workspaces, hosts, showToast]);

  // Load Right Directory (with RACE-04 guard)
  const loadRightDirectory = useCallback(async (path: string, hostId: string) => {
    if (hostId === '__picker__') return;
    const currentReqId = ++rightReqIdRef.current;
    setRightLoading(true);
    setSelectedRightName(null);
    try {
      if (hostId === 'local') {
        const root = activeRootId || workspaces[0]?.id || '';
        const res = await api.getTree(path, root);
        if (currentReqId !== rightReqIdRef.current) return;
        const mapped: FileEntry[] = (res.items || []).map((it) => ({
          name: it.name,
          path: it.path,
          isDir: it.isDir,
          size: it.size || 0,
          permissions: it.isDir ? 'drwxr-xr-x' : '-rw-r--r--',
          modTime: it.modTime || '',
        }));
        setRightEntries(mapped);
      } else {
        const host = hosts.find((h) => h.id === hostId);
        if (!host) throw new Error('Хост не найден');
        const res = await api.sftpList({
          host: host.host,
          port: host.port || 22,
          user: host.user || 'root',
          authType: host.authType,
          password: host.password,
          identityId: host.identityId,
          path,
        });
        if (currentReqId !== rightReqIdRef.current) return;
        const mapped: FileEntry[] = (res.entries || []).map((it: SFTPFileInfo) => ({
          name: it.name,
          path: it.path,
          isDir: it.isDir,
          size: it.size || 0,
          permissions: it.mode || (it.isDir ? 'drwxr-xr-x' : '-rw-r--r--'),
          modTime: it.modTime ? new Date(it.modTime).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }) : '',
        }));
        setRightEntries(mapped);
      }
      setRightPath(path);
    } catch (err: any) {
      if (currentReqId === rightReqIdRef.current) {
        showToast(`Ошибка загрузки справа: ${err.message}`);
      }
    } finally {
      if (currentReqId === rightReqIdRef.current) {
        setRightLoading(false);
      }
    }
  }, [activeRootId, workspaces, hosts, showToast]);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      loadLeftDirectory(leftPath, leftHostId);
      if (rightHostId !== '__picker__') {
        loadRightDirectory(rightPath, rightHostId);
      }
    }
  }, [isOpen]);

  // Transfer file logic (Local <-> Remote, Remote A <-> Remote B)
  const transferFile = async (
    sourcePane: 'left' | 'right',
    item: FileEntry,
    isMove: boolean = false
  ) => {
    const fromHostId = sourcePane === 'left' ? leftHostId : rightHostId;
    const toHostId = sourcePane === 'left' ? rightHostId : leftHostId;
    const targetDir = sourcePane === 'left' ? rightPath : leftPath;

    if (toHostId === '__picker__') {
      showToast('Сначала выберите целевой хост в противоположной панели!');
      return;
    }

    if (item.isDir) {
      showToast('Передача целых каталогов через Drag-and-Drop в процессе расширения');
      return;
    }

    // Binary file corruption protection (DATA-02)
    const isBinaryExt = /\.(png|jpe?g|gif|ico|webp|zip|tar|gz|bz2|7z|pdf|exe|bin|iso|woff2?|wasm|so|dll|dylib)$/i.test(item.name);
    if (isBinaryExt) {
      showToast(`Передача бинарного файла "${item.name}" через текстовый буфер не поддерживается.`);
      return;
    }

    setStatusText(`Передача файла "${item.name}"...`);
    try {
      let content = '';

      // 1. Read source
      if (fromHostId === 'local') {
        const root = activeRootId || workspaces[0]?.id || '';
        const fileData = await api.getFile(item.path, root);
        content = fileData.content || '';
      } else {
        const srcHost = hosts.find((h) => h.id === fromHostId);
        if (!srcHost) throw new Error('Исходный хост не найден');
        const res = await api.sftpRead({
          host: srcHost.host,
          port: srcHost.port || 22,
          user: srcHost.user || 'root',
          authType: srcHost.authType,
          password: srcHost.password,
          identityId: srcHost.identityId,
          path: item.path,
        });
        content = res.content || '';
      }

      // 2. Write destination (SEC-01 Path Traversal mitigation)
      let destPath: string;
      try {
        destPath = joinSafePath(targetDir, item.name);
      } catch (err: any) {
        showToast(err.message);
        return;
      }

      if (toHostId === 'local') {
        const root = activeRootId || workspaces[0]?.id || '';
        await api.saveFile(destPath, content, false, true, root);
      } else {
        const destHost = hosts.find((h) => h.id === toHostId);
        if (!destHost) throw new Error('Целевой хост не найден');
        await api.sftpWrite({
          host: destHost.host,
          port: destHost.port || 22,
          user: destHost.user || 'root',
          authType: destHost.authType,
          password: destHost.password,
          identityId: destHost.identityId,
          path: destPath,
          content,
        });
      }

      // 3. Move (delete source if requested)
      if (isMove) {
        if (fromHostId === 'local') {
          const root = activeRootId || workspaces[0]?.id || '';
          await api.deleteItem(item.path, root);
        } else {
          const srcHost = hosts.find((h) => h.id === fromHostId);
          if (srcHost) {
            await api.sftpDelete({
              host: srcHost.host,
              port: srcHost.port || 22,
              user: srcHost.user || 'root',
              authType: srcHost.authType,
              password: srcHost.password,
              identityId: srcHost.identityId,
              path: item.path,
            });
          }
        }
        // reload source pane
        if (sourcePane === 'left') loadLeftDirectory(leftPath, leftHostId);
        else loadRightDirectory(rightPath, rightHostId);
      }

      // reload target pane
      if (sourcePane === 'left') loadRightDirectory(rightPath, rightHostId);
      else loadLeftDirectory(leftPath, leftHostId);

      setStatusText(`Файл "${item.name}" успешно передан.`);
      showToast(`Файл "${item.name}" скопирован.`);
    } catch (err: any) {
      showToast(`Ошибка передачи: ${err.message}`);
      setStatusText(`Ошибка передачи: ${err.message}`);
    }
  };

  // Keyboard Shortcuts Handler (F5, F6, F7, F8, Escape) - LIFE-05
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      const targetTag = (e.target as HTMLElement)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;

      if (e.key === 'F5') {
        e.preventDefault();
        const activeItem = activePane === 'left'
          ? leftEntries.find((f) => f.name === selectedLeftName)
          : rightEntries.find((f) => f.name === selectedRightName);
        if (activeItem) transferFile(activePane, activeItem, false);
        else showToast('Выберите файл для копирования (F5)');
      } else if (e.key === 'F6') {
        e.preventDefault();
        const activeItem = activePane === 'left'
          ? leftEntries.find((f) => f.name === selectedLeftName)
          : rightEntries.find((f) => f.name === selectedRightName);
        if (activeItem) transferFile(activePane, activeItem, true);
        else showToast('Выберите файл для перемещения (F6)');
      } else if (e.key === 'F7') {
        e.preventDefault();
        handleCreateFolder(activePane);
      } else if (e.key === 'F8') {
        e.preventDefault();
        handleDelete(activePane);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activePane, leftEntries, rightEntries, selectedLeftName, selectedRightName, leftHostId, rightHostId, leftPath, rightPath, onClose]);

  // Create folder prompt
  const handleCreateFolder = async (pane: 'left' | 'right') => {
    const hostId = pane === 'left' ? leftHostId : rightHostId;
    const currentDir = pane === 'left' ? leftPath : rightPath;
    if (hostId === '__picker__') return;
    const name = prompt(t.newFolderPrompt || 'Введите имя новой папки:');
    if (!name?.trim()) return;

    let target: string;
    try {
      target = joinSafePath(currentDir, name.trim());
    } catch (err: any) {
      showToast(err.message);
      return;
    }

    try {
      if (hostId === 'local') {
        const root = activeRootId || workspaces[0]?.id || '';
        await api.createItem(target, true, root);
      } else {
        const host = hosts.find((h) => h.id === hostId);
        if (!host) return;
        await api.sftpMkdir({
          host: host.host,
          port: host.port || 22,
          user: host.user || 'root',
          authType: host.authType,
          password: host.password,
          identityId: host.identityId,
          path: target,
        });
      }
      showToast(`Папка "${name.trim()}" создана.`);
      if (pane === 'left') loadLeftDirectory(leftPath, leftHostId);
      else loadRightDirectory(rightPath, rightHostId);
    } catch (err: any) {
      showToast(`Ошибка создания папки: ${err.message}`);
    }
  };

  // Delete item
  const handleDelete = async (pane: 'left' | 'right', targetItem?: FileEntry) => {
    const hostId = pane === 'left' ? leftHostId : rightHostId;
    const selectedName = pane === 'left' ? selectedLeftName : selectedRightName;
    const entries = pane === 'left' ? leftEntries : rightEntries;
    const item = targetItem || entries.find((e) => e.name === selectedName);
    if (!item || hostId === '__picker__') {
      showToast('Выберите элемент для удаления (F8)');
      return;
    }

    if (!confirm(`Удалить ${item.isDir ? 'папку' : 'файл'} "${item.name}"?`)) return;

    try {
      if (hostId === 'local') {
        const root = activeRootId || workspaces[0]?.id || '';
        await api.deleteItem(item.path, root);
      } else {
        const host = hosts.find((h) => h.id === hostId);
        if (!host) return;
        await api.sftpDelete({
          host: host.host,
          port: host.port || 22,
          user: host.user || 'root',
          authType: host.authType,
          password: host.password,
          identityId: host.identityId,
          path: item.path,
        });
      }
      showToast(`"${item.name}" удален.`);
      if (pane === 'left') {
        setSelectedLeftName(null);
        loadLeftDirectory(leftPath, leftHostId);
      } else {
        setSelectedRightName(null);
        loadRightDirectory(rightPath, rightHostId);
      }
    } catch (err: any) {
      showToast(`Ошибка удаления: ${err.message}`);
    }
  };

  // Rename item
  const handleRename = async (pane: 'left' | 'right', item: FileEntry) => {
    const hostId = pane === 'left' ? leftHostId : rightHostId;
    if (hostId === '__picker__') return;
    const newName = prompt('Новое имя:', item.name);
    if (!newName?.trim() || newName.trim() === item.name) return;

    const parentDir = resolveSafeParentDir(item.path, hostId === 'local');
    let newPath: string;
    try {
      newPath = joinSafePath(parentDir, newName.trim());
    } catch (err: any) {
      showToast(err.message);
      return;
    }

    try {
      if (hostId === 'local') {
        const root = activeRootId || workspaces[0]?.id || '';
        await api.renameItem(item.path, newPath, root);
      } else {
        const host = hosts.find((h) => h.id === hostId);
        if (!host) return;
        await api.sftpRename({
          host: host.host,
          port: host.port || 22,
          user: host.user || 'root',
          authType: host.authType,
          password: host.password,
          identityId: host.identityId,
          path: item.path,
          newPath,
        });
      }
      showToast(`Переименовано в "${newName.trim()}".`);
      if (pane === 'left') loadLeftDirectory(leftPath, leftHostId);
      else loadRightDirectory(rightPath, rightHostId);
    } catch (err: any) {
      showToast(`Ошибка переименования: ${err.message}`);
    }
  };

  // Context Menu Items Builder
  const getPaneContextMenuItems = (pane: 'left' | 'right', item?: FileEntry): ContextMenuItem[] => {
    const hostId = pane === 'left' ? leftHostId : rightHostId;
    const isPicker = hostId === '__picker__';
    if (isPicker) return [];

    const otherPane = pane === 'left' ? 'right' : 'left';
    const otherHostId = otherPane === 'left' ? leftHostId : rightHostId;
    const otherIsPicker = otherHostId === '__picker__';

    if (!item) {
      return [
        {
          id: 'new-folder',
          label: settings.language === 'en' ? 'New Folder...' : 'Новая папка...',
          icon: <FolderPlus className="w-4 h-4 text-accent" />,
          shortcut: 'F7',
          onClick: () => handleCreateFolder(pane),
        },
        {
          id: 'refresh',
          label: settings.language === 'en' ? 'Refresh' : 'Обновить',
          icon: <RefreshCw className="w-4 h-4 text-gray-400" />,
          onClick: () => {
            if (pane === 'left') loadLeftDirectory(leftPath, leftHostId);
            else loadRightDirectory(rightPath, rightHostId);
          },
        },
      ];
    }

    const items: ContextMenuItem[] = [];

    if (item.isDir) {
      items.push({
        id: 'open-dir',
        label: settings.language === 'en' ? 'Open Folder' : 'Открыть папку',
        icon: <Folder className="w-4 h-4 text-amber-400" />,
        onClick: () => {
          const cPath = pane === 'left' ? leftPath : rightPath;
          const next = cPath.replace(/\/+$/, '') + '/' + item.name;
          if (pane === 'left') loadLeftDirectory(next, leftHostId);
          else loadRightDirectory(next, rightHostId);
        },
      });
    } else {
      items.push({
        id: 'open-editor',
        label: settings.language === 'en' ? 'Open in Editor' : 'Открыть в редакторе',
        icon: <FileCode className="w-4 h-4 text-accent" />,
        onClick: () => {
          const host = hostId === 'local' ? null : hosts.find((h) => h.id === hostId) || null;
          onOpenFile?.(host, item.path);
          onClose();
        },
      });
    }

    if (!item.isDir && !otherIsPicker) {
      items.push({
        id: 'transfer-copy',
        label: settings.language === 'en' ? 'Copy to Opposite Pane' : 'Копировать в противоположную панель',
        icon: <Copy className="w-4 h-4 text-accent" />,
        shortcut: 'F5',
        onClick: () => transferFile(pane, item, false),
      });
      items.push({
        id: 'transfer-move',
        label: settings.language === 'en' ? 'Move to Opposite Pane' : 'Переместить в противоположную панель',
        icon: <Move className="w-4 h-4 text-sky-400" />,
        shortcut: 'F6',
        onClick: () => transferFile(pane, item, true),
      });
    }

    items.push({
      id: 'copy-path',
      label: settings.language === 'en' ? 'Copy Path' : 'Копировать путь',
      icon: <Copy className="w-4 h-4 text-gray-400" />,
      shortcut: 'Ctrl+C',
      onClick: () => {
        navigator.clipboard.writeText(item.path);
        showToast(settings.language === 'en' ? 'Path copied to clipboard' : 'Путь скопирован в буфер');
      },
    });

    items.push({
      id: 'rename',
      label: settings.language === 'en' ? 'Rename' : 'Переименовать',
      icon: <Edit2 className="w-4 h-4 text-gray-400" />,
      shortcut: 'F2',
      onClick: () => handleRename(pane, item),
    });

    items.push({
      id: 'new-folder',
      label: settings.language === 'en' ? 'New Folder...' : 'Новая папка...',
      icon: <FolderPlus className="w-4 h-4 text-accent" />,
      shortcut: 'F7',
      onClick: () => handleCreateFolder(pane),
    });

    items.push({
      id: 'delete',
      label: settings.language === 'en' ? 'Delete' : 'Удалить',
      icon: <Trash2 className="w-4 h-4 text-red-500" />,
      danger: true,
      shortcut: 'F8',
      onClick: () => {
        if (pane === 'left') setSelectedLeftName(item.name);
        else setSelectedRightName(item.name);
        handleDelete(pane, item);
      },
    });

    return items;
  };

  // Navigate folder helper (SEC-03 workspace escape mitigation)
  const navigatePane = (pane: 'left' | 'right', targetPath: string) => {
    const isLeft = pane === 'left';
    const hostId = isLeft ? leftHostId : rightHostId;
    const currentP = isLeft ? leftPath : rightPath;

    let resolved = targetPath;
    if (targetPath === '..') {
      resolved = resolveSafeParentDir(currentP, hostId === 'local');
    } else if (targetPath === '/') {
      resolved = hostId === 'local' ? '' : '/';
    } else if (targetPath === '~') {
      resolved = hostId === 'local' ? '' : '/home';
    }

    if (isLeft) {
      loadLeftDirectory(resolved, leftHostId);
    } else {
      loadRightDirectory(resolved, rightHostId);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xxl"
      height="full"
      allowMaximize={true}
      defaultMaximized={false}
      className="p-0 overflow-hidden bg-base-surface border border-base-border shadow-2xl flex flex-col"
    >
      {/* 1. Modal Header with Maximize/Fullscreen toggle & Close button */}
      <Modal.Header
        title="SFTP Двухпанельный файловый менеджер"
        subtitle="Синхронизация и прямая передача файлов Local ↔ SFTP и Server ↔ Server"
        badge={
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-mono">
            Dual-Pane
          </span>
        }
        icon={
          <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
            <Server className="w-4 h-4" />
          </div>
        }
        className="px-4 py-2.5 bg-base-surface"
      />

      {/* 2. Dual Panes Grid (50% / 50%) */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-base-border min-h-0 bg-base select-none">
        {/* ================= LEFT PANE ================= */}
        <div
          onClick={() => setActivePane('left')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverPane('left');
          }}
          onDragLeave={() => setDragOverPane(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverPane(null);
            if (draggedItem && draggedItem.sourcePane === 'right') {
              transferFile('right', draggedItem.item, false);
            }
          }}
          className={`flex flex-col min-h-0 relative transition-colors ${
            activePane === 'left' ? 'ring-1 ring-accent/30' : ''
          } ${dragOverPane === 'left' ? 'bg-accent/5 ring-2 ring-accent' : ''}`}
        >
          {/* Top Host Selector & Actions */}
          <div className="p-2 border-b border-base-border bg-base-surface flex items-center justify-between gap-2 shrink-0">
            <div className="flex-1 max-w-xs">
              <select
                value={leftHostId}
                onChange={(e) => {
                  const val = e.target.value;
                  setLeftHostId(val);
                  if (val === 'local') setLeftPath('');
                  else setLeftPath('/etc');
                  loadLeftDirectory(val === 'local' ? '' : '/etc', val);
                }}
                className="w-full bg-base border border-base-border rounded-xl px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent cursor-pointer"
              >
                {hostDropdownOptions.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.id === 'local' ? '💻 Локальный ПК (Воркспейс)' : `🟢 🖧 ${h.name} (${h.host})`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center space-x-1 shrink-0">
              <button
                type="button"
                onClick={() => navigatePane('left', '/')}
                className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                title="В корень (/)"
              >
                <span className="font-mono text-xs font-bold">/</span>
              </button>
              <button
                type="button"
                onClick={() => navigatePane('left', '~')}
                className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                title="Домой (~)"
              >
                <Home className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigatePane('left', '..')}
                className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                title="На уровень вверх (⤴)"
              >
                <CornerLeftUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleCreateFolder('left')}
                className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                title="Создать папку (F7)"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => loadLeftDirectory(leftPath, leftHostId)}
                className={`p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition ${
                  leftLoading ? 'animate-spin text-accent' : ''
                }`}
                title="Обновить"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Breadcrumbs & Filter */}
          <div className="px-3 py-1.5 bg-black/5 dark:bg-black/20 border-b border-base-border flex items-center justify-between gap-2 text-xs shrink-0 font-mono">
            <div className="truncate text-gray-600 dark:text-gray-300">
              <span className="text-accent font-semibold">{leftHostId === 'local' ? 'local:' : leftHostId + ':'}</span>
              <span className="ml-1">{leftPath || '/'}</span>
            </div>
            <input
              type="text"
              value={leftFilter}
              onChange={(e) => setLeftFilter(e.target.value)}
              placeholder="Фильтр..."
              className="w-24 sm:w-32 px-2 py-0.5 rounded-lg bg-base border border-base-border text-xs focus:outline-none focus:border-accent"
            />
          </div>

          {/* Left File Table */}
          <div
            className="flex-1 overflow-y-auto min-h-0 relative custom-scrollbar"
            onContextMenu={(e) => {
              e.preventDefault();
              setActivePane('left');
              setContextMenuState({ x: e.clientX, y: e.clientY, pane: 'left' });
            }}
          >
            {leftLoading && (
              <div className="absolute inset-0 bg-base/50 backdrop-blur-xs flex items-center justify-center z-10">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <table className="w-full border-collapse text-left text-xs font-mono">
              <thead className="sticky top-0 bg-base-surface/95 backdrop-blur-xs text-[10px] text-gray-500 uppercase tracking-wider border-b border-base-border z-1">
                <tr>
                  <th className="py-1.5 px-3 font-semibold">Имя</th>
                  <th className="py-1.5 px-2 font-semibold w-24 hidden sm:table-cell">Права</th>
                  <th className="py-1.5 px-2 font-semibold w-24 hidden md:table-cell">Изменён</th>
                  <th className="py-1.5 px-3 font-semibold w-20 text-right">Размер</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-border/50 text-[11px]">
                {/* Parent directory entry if not root */}
                {leftPath && leftPath !== '/' && (
                  <tr
                    onClick={() => navigatePane('left', '..')}
                    className="hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                  >
                    <td colSpan={4} className="py-1.5 px-3 flex items-center space-x-2">
                      <CornerLeftUp className="w-3.5 h-3.5 text-accent" />
                      <span>.. (Вверх)</span>
                    </td>
                  </tr>
                )}
                {leftEntries
                  .filter((e) => !leftFilter || e.name.toLowerCase().includes(leftFilter.toLowerCase()))
                  .map((item) => (
                    <tr
                      key={item.name}
                      draggable={!item.isDir}
                      onDragStart={() => setDraggedItem({ sourcePane: 'left', item })}
                      onClick={() => setSelectedLeftName(item.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActivePane('left');
                        setSelectedLeftName(item.name);
                        setContextMenuState({ x: e.clientX, y: e.clientY, pane: 'left', entry: item });
                      }}
                      onDoubleClick={() => {
                        if (item.isDir) {
                          const next = leftPath.replace(/\/+$/, '') + '/' + item.name;
                          loadLeftDirectory(next, leftHostId);
                        } else {
                          const host = leftHostId === 'local' ? null : hosts.find((h) => h.id === leftHostId) || null;
                          onOpenFile?.(host, item.path);
                          onClose();
                        }
                      }}
                      className={`cursor-pointer transition-colors ${
                        selectedLeftName === item.name
                          ? 'bg-accent/15 text-accent font-semibold'
                          : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-800 dark:text-gray-200'
                      }`}
                    >
                      <td className="py-1.5 px-3 flex items-center space-x-2 truncate">
                        {item.isDir ? (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <FileFormatIcon filename={item.name} className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span className={`truncate ${item.isDir ? 'text-amber-500 dark:text-amber-300 font-bold' : ''}`}>
                          {item.name}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-gray-400 text-[10px] hidden sm:table-cell font-mono">
                        {item.permissions || '-'}
                      </td>
                      <td className="py-1.5 px-2 text-gray-400 text-[10px] hidden md:table-cell">
                        {item.modTime || '-'}
                      </td>
                      <td className="py-1.5 px-3 text-right text-gray-400 text-[10px] font-mono">
                        {item.isDir ? '-' : formatBytes(item.size)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ================= RIGHT PANE ================= */}
        <div
          onClick={() => setActivePane('right')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverPane('right');
          }}
          onDragLeave={() => setDragOverPane(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverPane(null);
            if (draggedItem && draggedItem.sourcePane === 'left') {
              transferFile('left', draggedItem.item, false);
            }
          }}
          className={`flex flex-col min-h-0 relative transition-colors ${
            activePane === 'right' ? 'ring-1 ring-accent/30' : ''
          } ${dragOverPane === 'right' ? 'bg-accent/5 ring-2 ring-accent' : ''}`}
        >
          {/* Top Host Selector & Actions */}
          <div className="p-2 border-b border-base-border bg-base-surface flex items-center justify-between gap-2 shrink-0">
            <div className="flex-1 max-w-xs">
              <select
                value={rightHostId}
                onChange={(e) => {
                  const val = e.target.value;
                  setRightHostId(val);
                  if (val === '__picker__') return;
                  if (val === 'local') setRightPath('');
                  else setRightPath('/etc');
                  loadRightDirectory(val === 'local' ? '' : '/etc', val);
                }}
                className="w-full bg-base border border-base-border rounded-xl px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="__picker__">🖥️ Выберите хост...</option>
                <option value="local">💻 Локальный ПК (Воркспейс)</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    🟢 🖧 {h.name} ({h.host})
                  </option>
                ))}
              </select>
            </div>

            {rightHostId !== '__picker__' && (
              <div className="flex items-center space-x-1 shrink-0">
                <button
                  type="button"
                  onClick={() => navigatePane('right', '/')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                  title="В корень (/)"
                >
                  <span className="font-mono text-xs font-bold">/</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigatePane('right', '~')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                  title="Домой (~)"
                >
                  <Home className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => navigatePane('right', '..')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                  title="На уровень вверх (⤴)"
                >
                  <CornerLeftUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateFolder('right')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition"
                  title="Создать папку (F7)"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => loadRightDirectory(rightPath, rightHostId)}
                  className={`p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition ${
                    rightLoading ? 'animate-spin text-accent' : ''
                  }`}
                  title="Обновить"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Right Content: If __picker__, show HostPickerView; else show Table */}
          {rightHostId === '__picker__' ? (
            <div className="flex-1 flex flex-col items-center justify-start p-6 overflow-y-auto custom-scrollbar">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-2.5">
                <Server className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                Выберите хост
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-xs mb-4 text-center max-w-xs">
                Выберите хост, чтобы просмотреть и передавать файлы
              </p>

              <div className="w-full max-w-sm mb-3">
                <input
                  type="text"
                  value={rightFilter}
                  onChange={(e) => setRightFilter(e.target.value)}
                  placeholder="Поиск хостов..."
                  className="w-full px-3 py-2 rounded-xl bg-base border border-base-border text-xs text-gray-800 dark:text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent transition shadow-inner"
                />
              </div>

              <div className="w-full max-w-sm space-y-1.5">
                {/* Local Workspace Option */}
                {(!rightFilter || 'локальный пк воркспейс'.includes(rightFilter.toLowerCase())) && (
                  <div
                    onClick={() => {
                      setRightHostId('local');
                      setRightPath('');
                      loadRightDirectory('', 'local');
                    }}
                    className="p-2.5 rounded-xl bg-base-surface hover:bg-black/5 dark:hover:bg-white/5 border border-base-border hover:border-accent/50 transition cursor-pointer flex items-center justify-between group active:scale-[0.99]"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center shrink-0">
                        <Laptop className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-accent truncate">
                          Локальный ПК
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono truncate">
                          Текущий рабочий каталог
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-accent opacity-0 group-hover:opacity-100 transition">
                      Выбрать ➔
                    </span>
                  </div>
                )}

                {/* Remote SSH Hosts */}
                {hosts
                  .filter(
                    (h) =>
                      !rightFilter ||
                      h.name.toLowerCase().includes(rightFilter.toLowerCase()) ||
                      h.host.toLowerCase().includes(rightFilter.toLowerCase())
                  )
                  .map((h) => (
                    <div
                      key={h.id}
                      onClick={() => {
                        setRightHostId(h.id);
                        setRightPath('/etc');
                        loadRightDirectory('/etc', h.id);
                      }}
                      className="p-2.5 rounded-xl bg-base-surface hover:bg-black/5 dark:hover:bg-white/5 border border-base-border hover:border-accent/50 transition cursor-pointer flex items-center justify-between group active:scale-[0.99]"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-accent/10 text-accent border border-accent/20 flex items-center justify-center shrink-0">
                          <Server className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-accent truncate flex items-center gap-1.5">
                            {h.name}
                            <span className="text-[9px] px-1 py-0.2 rounded bg-accent/10 text-accent font-mono">
                              {(h.authType || 'ssh').toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono truncate">
                            {h.user || 'root'}@{h.host}:{h.port || 22}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-accent opacity-0 group-hover:opacity-100 transition">
                        Выбрать ➔
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <>
              {/* Breadcrumbs & Filter */}
              <div className="px-3 py-1.5 bg-black/5 dark:bg-black/20 border-b border-base-border flex items-center justify-between gap-2 text-xs shrink-0 font-mono">
                <div className="truncate text-gray-600 dark:text-gray-300">
                  <span className="text-accent font-semibold">{rightHostId === 'local' ? 'local:' : rightHostId + ':'}</span>
                  <span className="ml-1">{rightPath || '/'}</span>
                </div>
                <input
                  type="text"
                  value={rightFilter}
                  onChange={(e) => setRightFilter(e.target.value)}
                  placeholder="Фильтр..."
                  className="w-24 sm:w-32 px-2 py-0.5 rounded-lg bg-base border border-base-border text-xs focus:outline-none focus:border-accent"
                />
              </div>

              {/* Right File Table */}
              <div
                className="flex-1 overflow-y-auto min-h-0 relative custom-scrollbar"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActivePane('right');
                  setContextMenuState({ x: e.clientX, y: e.clientY, pane: 'right' });
                }}
              >
                {rightLoading && (
                  <div className="absolute inset-0 bg-base/50 backdrop-blur-xs flex items-center justify-center z-10">
                    <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead className="sticky top-0 bg-base-surface/95 backdrop-blur-xs text-[10px] text-gray-500 uppercase tracking-wider border-b border-base-border z-1">
                    <tr>
                      <th className="py-1.5 px-3 font-semibold">Имя</th>
                      <th className="py-1.5 px-2 font-semibold w-24 hidden sm:table-cell">Права</th>
                      <th className="py-1.5 px-2 font-semibold w-24 hidden md:table-cell">Изменён</th>
                      <th className="py-1.5 px-3 font-semibold w-20 text-right">Размер</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-border/50 text-[11px]">
                    {rightPath && rightPath !== '/' && (
                      <tr
                        onClick={() => navigatePane('right', '..')}
                        className="hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                      >
                        <td colSpan={4} className="py-1.5 px-3 flex items-center space-x-2">
                          <CornerLeftUp className="w-3.5 h-3.5 text-accent" />
                          <span>.. (Вверх)</span>
                        </td>
                      </tr>
                    )}
                    {rightEntries
                      .filter((e) => !rightFilter || e.name.toLowerCase().includes(rightFilter.toLowerCase()))
                      .map((item) => (
                        <tr
                          key={item.name}
                          draggable={!item.isDir}
                          onDragStart={() => setDraggedItem({ sourcePane: 'right', item })}
                          onClick={() => setSelectedRightName(item.name)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setActivePane('right');
                            setSelectedRightName(item.name);
                            setContextMenuState({ x: e.clientX, y: e.clientY, pane: 'right', entry: item });
                          }}
                          onDoubleClick={() => {
                            if (item.isDir) {
                              const next = rightPath.replace(/\/+$/, '') + '/' + item.name;
                              loadRightDirectory(next, rightHostId);
                            } else {
                              const host = rightHostId === 'local' ? null : hosts.find((h) => h.id === rightHostId) || null;
                              onOpenFile?.(host, item.path);
                              onClose();
                            }
                          }}
                          className={`cursor-pointer transition-colors ${
                            selectedRightName === item.name
                              ? 'bg-accent/15 text-accent font-semibold'
                              : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-800 dark:text-gray-200'
                          }`}
                        >
                          <td className="py-1.5 px-3 flex items-center space-x-2 truncate">
                            {item.isDir ? (
                              <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            ) : (
                              <FileFormatIcon filename={item.name} className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className={`truncate ${item.isDir ? 'text-amber-500 dark:text-amber-300 font-bold' : ''}`}>
                              {item.name}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-gray-400 text-[10px] hidden sm:table-cell font-mono">
                            {item.permissions || '-'}
                          </td>
                          <td className="py-1.5 px-2 text-gray-400 text-[10px] hidden md:table-cell">
                            {item.modTime || '-'}
                          </td>
                          <td className="py-1.5 px-3 text-right text-gray-400 text-[10px] font-mono">
                            {item.isDir ? '-' : formatBytes(item.size)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 3. Bottom Hotkey Actions & Status */}
      <div className="h-11 bg-base-surface border-t border-base-border px-3 flex items-center justify-between shrink-0 text-xs select-none">
        <div className="flex items-center space-x-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              const activeItem = activePane === 'left'
                ? leftEntries.find((f) => f.name === selectedLeftName)
                : rightEntries.find((f) => f.name === selectedRightName);
              if (activeItem) transferFile(activePane, activeItem, false);
              else showToast('Выберите файл для копирования');
            }}
            className="px-2.5 py-1 rounded-lg bg-base hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 border border-base-border transition flex items-center gap-1 active:scale-95"
          >
            <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-black/30 text-[10px] text-accent font-mono">F5</kbd>
            <span>Копировать</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const activeItem = activePane === 'left'
                ? leftEntries.find((f) => f.name === selectedLeftName)
                : rightEntries.find((f) => f.name === selectedRightName);
              if (activeItem) transferFile(activePane, activeItem, true);
              else showToast('Выберите файл для перемещения');
            }}
            className="px-2.5 py-1 rounded-lg bg-base hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 border border-base-border transition flex items-center gap-1 active:scale-95"
          >
            <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-black/30 text-[10px] text-accent font-mono">F6</kbd>
            <span>Переместить</span>
          </button>

          <button
            type="button"
            onClick={() => handleCreateFolder(activePane)}
            className="px-2.5 py-1 rounded-lg bg-base hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 border border-base-border transition flex items-center gap-1 active:scale-95"
          >
            <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-black/30 text-[10px] text-accent font-mono">F7</kbd>
            <span>Папка</span>
          </button>

          <button
            type="button"
            onClick={() => handleDelete(activePane)}
            className="px-2.5 py-1 rounded-lg bg-base hover:bg-rose-500/10 text-rose-500 border border-base-border hover:border-rose-500/30 transition flex items-center gap-1 active:scale-95"
          >
            <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-black/30 text-[10px] text-rose-500 font-mono">F8</kbd>
            <span>Удалить</span>
          </button>
        </div>

        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="truncate max-w-xs sm:max-w-md">{statusText}</span>
        </div>
      </div>

      {/* 4. Animated Toast Overlay */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 max-w-sm bg-base-surface border border-accent/40 text-gray-900 dark:text-gray-100 px-4 py-2.5 rounded-xl shadow-2xl transition-all duration-300 flex items-center gap-2.5 z-50 text-xs animate-in slide-in-from-bottom-2">
          <CheckCircle className="w-4 h-4 text-accent shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 5. Custom Context Menu for Dual-Pane Table Items */}
      {contextMenuState && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          items={getPaneContextMenuItems(contextMenuState.pane, contextMenuState.entry)}
          target={contextMenuState.entry}
          onClose={() => setContextMenuState(null)}
        />
      )}
    </Modal>
  );
};
