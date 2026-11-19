import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Folder,
  FolderPlus,
  FilePlus,
  RefreshCw,
  FileText,
  FileCode,
  Trash2,
  Edit2,
  UploadCloud,
  CornerLeftUp,
  ChevronDown,
  ChevronRight,
  Server,
  Box,
  Shield,
  Terminal,
  Globe,
  Cpu,
  Database,
  Lock,
  MoreVertical,
  X,
} from 'lucide-react';
import { FileFormatIcon } from './icons/FileFormatIcon';
import {
  FileItem,
  Settings,
  ContextMenuItem,
  ContextMenuTarget,
  WorkspaceRoot,
  SSHHost,
} from '../types';
import { translations } from '../utils/i18n';
import { SectionHeader, PillTabs, PillTabItem, ContextMenu } from '@config-studio/ui';
import { buildFileContextMenuItems } from './explorer/useFileContextMenu';
import { contextMenuRegistry } from '../services/contextMenuRegistry';
import { SftpSendModal } from './sftp/SftpSendModal';
import { SftpTreeExplorer } from './sftp/SftpTreeExplorer';
import { SftpDualPaneModal } from './sftp/SftpDualPaneModal';
import { sshHostService } from '../services/sshHosts';
import { showGlobalToast } from './ui';

interface FileExplorerProps {
  items?: FileItem[];
  currentDir?: string;
  selectedFilePath: string | null;
  settings: Settings;
  workspaces?: WorkspaceRoot[];
  activeRootId?: string;
  itemsByRoot?: Record<string, { currentDir: string; items: FileItem[]; loading?: boolean; error?: string }>;
  onSelectFile: (path: string, root?: string) => void;
  onNavigateDir: (path: string, root?: string) => void;
  onRefresh: (rootId?: string) => void;
  onCreateItem: (path: string, isDir: boolean, root?: string) => void;
  onDeleteItem: (path: string, root?: string) => void;
  onRenameItem: (oldPath: string, newPath: string, root?: string) => void;
  onUploadFile: (dirPath: string, file: File, root?: string) => void;
  onAddWorkspace?: () => void;
  onEditWorkspace?: (root: WorkspaceRoot) => void;
  onDeleteWorkspace?: (rootId: string) => void;
  isMobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
  onOpenSftpFile?: (host: SSHHost, remotePath: string) => void;
  onOpenTerminalHost?: (host: SSHHost) => void;
  onOpenSettingsSsh?: () => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  items = [],
  currentDir = '',
  selectedFilePath,
  settings,
  workspaces = [],
  activeRootId,
  itemsByRoot = {},
  onSelectFile,
  onNavigateDir,
  onRefresh,
  onCreateItem,
  onDeleteItem,
  onRenameItem,
  onUploadFile,
  onAddWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  isMobileDrawerOpen = false,
  onCloseMobileDrawer,
  onOpenSftpFile,
  onOpenTerminalHost,
  onOpenSettingsSsh,
}) => {
  const t = translations[settings.language] || translations.ru;
  const [sidebarTab, setSidebarTab] = useState<'workspaces' | 'sftp'>('workspaces');
  const [hostsCount, setHostsCount] = useState<number>(() => sshHostService.list().length);

  const sidebarTabItems = useMemo<PillTabItem[]>(() => [
    {
      id: 'workspaces',
      label: (t as any).workspacesShort || 'Среды',
      icon: <Folder className="w-3.5 h-3.5 shrink-0" />,
      closable: false,
    },
    {
      id: 'sftp',
      label: 'SFTP',
      icon: <Server className="w-3.5 h-3.5 shrink-0" />,
      badge: hostsCount > 0 ? hostsCount : undefined,
      badgeColor: 'gray',
      closable: false,
    },
  ], [(t as any).workspacesShort, hostsCount]);
  const [isDragging, setIsDragging] = useState(false);
  const [collapsedRoots, setCollapsedRoots] = useState<Record<string, boolean>>({});
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    target: ContextMenuTarget;
  } | null>(null);
  const [, setRegistryTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedRootId, setSelectedRootId] = useState<string>(activeRootId || workspaces[0]?.id || 'default');
  const [uploadTargetRoot, setUploadTargetRoot] = useState<string>('');
  const [uploadTargetDir, setUploadTargetDir] = useState<string>('');
  const [dragOverRootId, setDragOverRootId] = useState<string | null>(null);
  const [sftpSendTarget, setSftpSendTarget] = useState<{ path: string; root?: string; name: string } | null>(null);
  const [dualPaneTarget, setDualPaneTarget] = useState<{ host: SSHHost | null; path: string } | null>(null);

  useEffect(() => {
    const handleOpenDualPane = (e: any) => {
      const detail = e.detail;
      const hostId = detail?.hostId;
      const host = hostId ? sshHostService.list().find((h) => h.id === hostId) || null : null;
      setDualPaneTarget({
        host,
        path: detail?.path || (host ? '/etc' : ''),
      });
    };
    window.addEventListener('cs-open-sftp-modal', handleOpenDualPane);
    return () => window.removeEventListener('cs-open-sftp-modal', handleOpenDualPane);
  }, []);

  useEffect(() => {
    if (activeRootId) {
      setSelectedRootId(activeRootId);
    }
  }, [activeRootId]);

  const triggerUpload = (rootId: string, dirPath?: string) => {
    setUploadTargetRoot(rootId);
    setUploadTargetDir(dirPath !== undefined ? dirPath : (itemsByRoot[rootId]?.currentDir || ''));
    setSelectedRootId(rootId);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  useEffect(() => {
    const unsub = sshHostService.subscribe((hosts) => {
      setHostsCount(hosts.length);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    return contextMenuRegistry.subscribe(() => {
      setRegistryTick((prev) => prev + 1);
    });
  }, []);

  useEffect(() => {
    const handleSwitchSidebarTab = (e: any) => {
      if (e.detail === 'sftp' || e.detail === 'workspaces') {
        setSidebarTab(e.detail);
      }
    };
    const handleOpenSftpHost = () => {
      setSidebarTab('sftp');
    };
    const handleRemoteChanged = () => {
      onRefresh();
    };
    window.addEventListener('cs:switch-sidebar-tab', handleSwitchSidebarTab);
    window.addEventListener('cs:open-sftp-host', handleOpenSftpHost);
    window.addEventListener('cs:remote-endpoint-changed', handleRemoteChanged);
    return () => {
      window.removeEventListener('cs:switch-sidebar-tab', handleSwitchSidebarTab);
      window.removeEventListener('cs:open-sftp-host', handleOpenSftpHost);
      window.removeEventListener('cs:remote-endpoint-changed', handleRemoteChanged);
    };
  }, [onRefresh]);

  const toggleRootCollapse = (rootId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedRoots((prev) => ({
      ...prev,
      [rootId]: !prev[rootId],
    }));
  };

  const renderRootIcon = (iconName?: string) => {
    switch (iconName) {
      case 'server':
        return <Server className="w-4 h-4 text-sky-400 shrink-0" />;
      case 'box':
        return <Box className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'shield':
        return <Shield className="w-4 h-4 text-indigo-400 shrink-0" />;
      case 'terminal':
        return <Terminal className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'globe':
        return <Globe className="w-4 h-4 text-teal-400 shrink-0" />;
      case 'cpu':
        return <Cpu className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'database':
        return <Database className="w-4 h-4 text-purple-400 shrink-0" />;
      case 'folder':
      default:
        return <Folder className="w-4 h-4 text-accent shrink-0" />;
    }
  };

  const getContextMenuItems = (target: ContextMenuTarget): ContextMenuItem[] => {
    return buildFileContextMenuItems(target, {
      workspaces,
      t,
      itemsByRoot,
      onSelectFile,
      onNavigateDir,
      onCreateItem,
      onRenameItem,
      onDeleteItem,
      onRefresh,
      onEditWorkspace,
      onDeleteWorkspace,
      triggerUpload,
      handleCreatePrompt,
      setSftpSendTarget,
    });
  };

  const handleDrop = (e: React.DragEvent, rootId?: string, dirPath?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragOverRootId(null);
    const targetRoot = rootId || selectedRootId || activeRootId || workspaces[0]?.id || 'default';
    const dir = dirPath !== undefined
      ? dirPath
      : (itemsByRoot[targetRoot]?.currentDir || '');
    setSelectedRootId(targetRoot);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        onUploadFile(dir, e.dataTransfer.files[i], targetRoot);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const targetRoot = uploadTargetRoot || selectedRootId || activeRootId || workspaces[0]?.id || 'default';
      const dir = uploadTargetDir !== undefined
        ? uploadTargetDir
        : (itemsByRoot[targetRoot]?.currentDir || '');
      for (let i = 0; i < e.target.files.length; i++) {
        onUploadFile(dir, e.target.files[i], targetRoot);
      }
      setUploadTargetRoot('');
      setUploadTargetDir('');
    }
  };

  const handleCreatePrompt = (isDir: boolean, rootId?: string) => {
    const promptMsg = isDir ? t.enterFolderName : t.enterFileName;
    const name = prompt(promptMsg);
    if (!name || !name.trim()) return;

    const targetRoot = rootId || selectedRootId || activeRootId || workspaces[0]?.id || 'default';
    const dir = itemsByRoot[targetRoot]?.currentDir || currentDir || '';
    const fullPath = dir ? `${dir}/${name.trim()}` : name.trim();
    onCreateItem(fullPath, isDir, targetRoot);
  };

  const handleRenamePrompt = (item: FileItem, e: React.MouseEvent, rootId?: string) => {
    e.stopPropagation();
    const newName = prompt(t.enterNewName, item.name);
    if (!newName || !newName.trim() || newName.trim() === item.name) return;
    const dir = item.path.includes('/')
      ? item.path.substring(0, item.path.lastIndexOf('/'))
      : '';
    const newPath = dir ? `${dir}/${newName.trim()}` : newName.trim();
    onRenameItem(item.path, newPath, rootId || item.root);
  };

  const handleDeleteConfirm = (item: FileItem, e: React.MouseEvent, rootId?: string) => {
    e.stopPropagation();
    const msg = t.deleteConfirm.replace('{name}', item.name);
    if (confirm(msg)) {
      onDeleteItem(item.path, rootId || item.root);
    }
  };

  const getFileIcon = (item: FileItem) => {
    return <FileFormatIcon filename={item.name} isDir={item.isDir} className="w-4 h-4 shrink-0" />;
  };

  const goUp = (rootId: string) => {
    const ws = workspaces.find((w) => w.id === rootId);
    const wsData = itemsByRoot[rootId];
    const cDir = wsData?.currentDir || currentDir;
    if (!cDir) return;
    const normDir = cDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const normWsPath = (ws?.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (normDir === '' || normDir === '.' || (normWsPath && normDir === normWsPath)) {
      return;
    }
    const parts = normDir.split('/').filter(Boolean);
    parts.pop();
    const target = normDir.startsWith('/') ? '/' + parts.join('/') : parts.join('/');
    // Do not navigate above workspace root
    if (normWsPath && target.length < normWsPath.length && !target.startsWith(normWsPath)) {
      onNavigateDir('', rootId);
      return;
    }
    onNavigateDir(target, rootId);
  };

  // Render a single root's files
  const renderRootFiles = (ws: WorkspaceRoot) => {
    const wsData = itemsByRoot[ws.id];
    const isRemote = Boolean(ws.server && ws.server !== 'local');
    const isSingleLocalDefault = workspaces.length <= 1 && (ws.id === 'default' || !ws.server || ws.server === 'local');
    const wsItems = wsData?.items || (isSingleLocalDefault && !isRemote ? items : []);
    const wsDir = wsData?.currentDir || (isSingleLocalDefault && !isRemote ? currentDir : '');
    const normWsDir = wsDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const normWsPath = (ws.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const isAtRoot = !normWsDir || normWsDir === '.' || (normWsPath && normWsDir === normWsPath);

    return (
      <div className="space-y-0.5 pl-2 border-l border-base-border/50 ml-2.5 my-1">
        {/* Parent dir up link */}
        {!isAtRoot && !wsData?.error && (
          <div
            onClick={() => goUp(ws.id)}
            className="px-2 py-1.5 flex items-center space-x-1.5 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer rounded-lg transition-colors"
            title="На уровень выше"
          >
            <CornerLeftUp className="w-3.5 h-3.5 text-accent" />
            <span className="truncate font-mono">.. ({wsDir})</span>
          </div>
        )}

        {wsData?.error ? (
          <div className="text-[11px] text-red-400 py-2 px-2 text-center bg-red-500/10 rounded-lg mx-1 my-1">
            {wsData.error}
          </div>
        ) : wsItems.length === 0 ? (
          <div className="text-[11px] text-gray-400 dark:text-gray-500 py-3 text-center">
            {t.emptyFolder || 'Папка пуста'}
          </div>
        ) : (
          wsItems.map((item) => {
            const itemKey = item.fullRelPath || (item.root ? `${item.root}:${item.path}` : item.path);
            const isSelected = selectedFilePath === itemKey || selectedFilePath === item.path;

            return (
              <div
                key={itemKey}
                onClick={() => {
                  setSelectedRootId(ws.id);
                  if (item.isDir) {
                    onNavigateDir(item.path, ws.id);
                  } else {
                    onSelectFile(item.path, ws.id);
                    onCloseMobileDrawer?.();
                  }
                }}
                onDragOver={item.isDir && !ws.readOnly ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                } : undefined}
                onDrop={item.isDir && !ws.readOnly ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDrop(e, ws.id, item.path);
                } : undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenuState({
                    x: e.clientX,
                    y: e.clientY,
                    target: {
                      path: item.path,
                      name: item.name,
                      isDir: item.isDir,
                      extension: item.extension || '',
                      currentDir: wsDir,
                      root: ws.id,
                    } as any,
                  });
                }}
                className={`group flex items-center justify-between px-2 py-1.5 rounded-xl text-xs cursor-pointer min-h-[30px] transition-colors ${
                  isSelected
                    ? 'bg-accent/15 text-gray-900 dark:text-white font-medium border border-accent/40 shadow-xs'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2 truncate min-w-0">
                  {getFileIcon(item)}
                  <span className="truncate">{item.name}</span>
                </div>

                {/* Hover actions */}
                {!ws.readOnly && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 pl-1 shrink-0 transition-opacity">
                    <button
                      onClick={(e) => handleRenamePrompt(item, e, ws.id)}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-gray-900 dark:hover:text-white"
                      title={t.rename}
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteConfirm(item, e, ws.id)}
                      className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-500"
                      title={t.delete}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  };

  const explorerAside = (
    <aside className="w-72 sm:w-64 bg-base-surface border-r border-base-border flex flex-col h-full select-none shrink-0">
      {/* Top Sidebar Tab Switcher: Workspaces vs SFTP (PillTabs) */}
      <div className="h-11 min-h-11 max-h-11 bg-base-surface border-b border-base-border flex items-center px-2 shrink-0">
        <PillTabs
          items={sidebarTabItems}
          activeId={sidebarTab}
          onChange={(id) => setSidebarTab(id as 'workspaces' | 'sftp')}
          variant="segmented"
          size="sm"
          className="w-full"
        />
      </div>

      {sidebarTab === 'workspaces' ? (
        <>
          {/* Title & Toolbar */}
          <div className="h-[42px] min-h-[42px] max-h-[42px] px-3 bg-base-surface border-b border-base-border flex items-center shrink-0">
            <SectionHeader
              className="w-full"
              title={t.workspaces || t.fileExplorer || 'Рабочие области'}
              rightElement={
                <div className="flex items-center space-x-1">
                  {onAddWorkspace && (
                    <button
                      onClick={onAddWorkspace}
                      className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-accent dark:text-gray-400 dark:hover:text-accent transition-colors"
                      title={t.addWorkspace || 'Добавить рабочую папку'}
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => onRefresh()}
                    className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                    title={t.refresh}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  {onCloseMobileDrawer && (
                    <button
                      onClick={onCloseMobileDrawer}
                      className="md:hidden p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      title="Закрыть"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              }
            />
          </div>

      {/* Workspaces Multi-Root Tree */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenuState({
            x: e.clientX,
            y: e.clientY,
            target: {
              path: currentDir,
              name: '',
              isDir: true,
              extension: '',
              currentDir,
            },
          });
        }}
      >
        {workspaces && workspaces.length > 0 ? (
          workspaces.map((ws) => {
            const isCollapsed = collapsedRoots[ws.id] || false;

            return (
              <div
                key={ws.id}
                className={`space-y-0.5 rounded-xl transition-all ${
                  dragOverRootId === ws.id ? 'ring-2 ring-accent/60 bg-accent/5' : ''
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverRootId(ws.id);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverRootId(null);
                }}
                onDrop={(e) => handleDrop(e, ws.id, itemsByRoot[ws.id]?.currentDir || '')}
              >
                {/* Root Folder Header */}
                <div
                  onClick={() => {
                    setSelectedRootId(ws.id);
                  }}
                  onDoubleClick={(e) => toggleRootCollapse(ws.id, e)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedRootId(ws.id);
                    setContextMenuState({
                      x: e.clientX,
                      y: e.clientY,
                      target: {
                        isRoot: true,
                        rootId: ws.id,
                        name: ws.name,
                        path: '',
                        isDir: true,
                        extension: '',
                      } as any,
                    });
                  }}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                    selectedRootId === ws.id
                      ? 'bg-accent/15 text-gray-900 dark:text-white font-bold border border-accent/30 shadow-xs'
                      : 'text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
                  }`}
                  title={`${ws.name} (${ws.path})`}
                >
                  <div className="flex items-center space-x-1.5 truncate min-w-0">
                    <button
                      onClick={(e) => toggleRootCollapse(ws.id, e)}
                      className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {renderRootIcon(ws.icon)}
                    <span className="truncate">{ws.name}</span>
                    {ws.readOnly && (
                      <span className="px-1.5 py-0.2 text-[9px] font-mono uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-md">
                        RO
                      </span>
                    )}
                  </div>

                  {/* Quick action buttons on root header hover */}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-0.5 shrink-0 transition-opacity">
                    {!ws.readOnly && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRootId(ws.id);
                            handleCreatePrompt(false, ws.id);
                          }}
                          className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-gray-900 dark:hover:text-white"
                          title={t.newFile || 'Новый файл'}
                        >
                          <FilePlus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerUpload(ws.id, itemsByRoot[ws.id]?.currentDir || '');
                          }}
                          className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-gray-900 dark:hover:text-white"
                          title={t.uploadFile || 'Загрузить файл'}
                        >
                          <UploadCloud className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRootId(ws.id);
                        setContextMenuState({
                          x: e.clientX,
                          y: e.clientY,
                          target: {
                            isRoot: true,
                            rootId: ws.id,
                            name: ws.name,
                            path: '',
                            isDir: true,
                            extension: '',
                          } as any,
                        });
                      }}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-gray-900 dark:hover:text-white"
                      title="Меню"
                    >
                      <MoreVertical className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Subfolder & Files of this root */}
                {!isCollapsed && renderRootFiles(ws)}
              </div>
            );
          })
        ) : (
          /* Fallback for single root without workspaces array */
          renderRootFiles({
            id: 'default',
            name: 'Configs',
            path: '',
            readOnly: false,
            icon: 'folder',
          })
        )}

        {/* Add Workspace Button in Tree */}
        {onAddWorkspace && (
          <button
            onClick={onAddWorkspace}
            className="w-full mt-3 py-2 px-3 border border-dashed border-base-border hover:border-accent/40 rounded-xl text-xs text-gray-500 hover:text-accent flex items-center justify-center space-x-1.5 transition-colors group"
          >
            <FolderPlus className="w-3.5 h-3.5 text-gray-400 group-hover:text-accent" />
            <span>{t.addWorkspace || 'Добавить рабочую папку...'}</span>
          </button>
        )}
      </div>

      {/* Upload Dropzone at Bottom */}
      <div className="p-3 border-t border-base-border">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          className="hidden"
        />
        {(() => {
          const targetRoot = selectedRootId || activeRootId || workspaces[0]?.id || 'default';
          const activeWs = workspaces.find((w) => w.id === targetRoot) || workspaces[0];
          const targetDir = itemsByRoot[targetRoot]?.currentDir || '';

          return (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => handleDrop(e, targetRoot, targetDir)}
              onClick={() => triggerUpload(targetRoot, targetDir)}
              className={`border-2 border-dashed rounded-2xl p-3 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-accent bg-accent/10'
                  : 'border-gray-300 dark:border-white/10 hover:border-accent/60 bg-gray-50 dark:bg-black/20 hover:bg-gray-100 dark:hover:bg-black/30'
              }`}
            >
              <UploadCloud className="w-5 h-5 mx-auto mb-1 text-accent opacity-90" />
              <p className="text-[11px] text-gray-700 dark:text-gray-300 font-medium">
                {t.dropFiles}
              </p>
              <p className="text-[10px] text-accent mt-0.5 hover:underline font-semibold">
                {t.clickToUpload}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 font-mono truncate">
                {t.uploadTo || 'Загрузка в'}: <span className="text-accent font-semibold">{activeWs?.name || targetRoot}</span>
                {targetDir ? ` / ${targetDir}` : ''}
              </p>
            </div>
          );
        })()}
      </div>
        </>
      ) : (
        <SftpTreeExplorer
          settings={settings}
          onOpenFile={(host, remotePath) => onOpenSftpFile?.(host, remotePath)}
          onOpenTerminal={onOpenTerminalHost}
          onOpenSettingsSsh={onOpenSettingsSsh}
          onOpenDualPane={(host, path) => setDualPaneTarget({ host, path })}
          onCloseMobileDrawer={onCloseMobileDrawer}
        />
      )}

      {/* Context Menu Modal / Popup */}
      {contextMenuState && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          items={getContextMenuItems(contextMenuState.target)}
          target={contextMenuState.target}
          onClose={() => setContextMenuState(null)}
        />
      )}

      {/* SFTP Direct Send Modal */}
      {sftpSendTarget && (
        <SftpSendModal
          isOpen={Boolean(sftpSendTarget)}
          filePath={sftpSendTarget.path}
          rootId={sftpSendTarget.root}
          fileName={sftpSendTarget.name}
          onClose={() => setSftpSendTarget(null)}
          onSuccess={(msg) => showGlobalToast(msg, 'success')}
          accentColor={settings.accentColor}
        />
      )}

      {/* SFTP Dual-Pane File Manager Modal */}
      {dualPaneTarget && (
        <SftpDualPaneModal
          key={`${dualPaneTarget.host?.id || 'local'}-${dualPaneTarget.path}`}
          isOpen={Boolean(dualPaneTarget)}
          onClose={() => setDualPaneTarget(null)}
          initialHost={dualPaneTarget.host}
          initialPath={dualPaneTarget.path}
          workspaces={workspaces}
          activeRootId={activeRootId}
          onOpenFile={(host, path) => {
            setDualPaneTarget(null);
            if (host) onOpenSftpFile?.(host, path);
            else onSelectFile(path, activeRootId);
          }}
          settings={settings}
        />
      )}
    </aside>
  );

  return (
    <>
      {/* Desktop view (always visible on md+) */}
      <div className="hidden md:flex h-full shrink-0">
        {explorerAside}
      </div>

      {/* Mobile Drawer (visible on < md when open) */}
      {isMobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex animate-in fade-in duration-200">
          <div className="h-full shadow-2xl animate-in slide-in-from-left duration-200">
            {explorerAside}
          </div>
          <div
            className="flex-1 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobileDrawer}
            aria-hidden="true"
          />
        </div>
      )}
    </>
  );
};
