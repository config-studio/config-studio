import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Header } from './components/Header';
import { FileExplorer } from './components/FileExplorer';
import { Editor } from './components/Editor';
import { StructureOutline } from './components/StructureOutline';
import { SettingsModal } from './components/SettingsModal';
import { SettingsTab } from './components/settings/types';
import { FilePropertiesModal } from './components/FilePropertiesModal';
import { LoginScreen } from './components/LoginScreen';
import { AddWorkspaceModal } from './components/AddWorkspaceModal';
import { PluginSplitPanel } from './components/PluginSplitPanel';
import { BottomDockStrip } from './components/BottomDockStrip';
import { CommandConfirmModal } from './components/CommandConfirmModal';
import { PreSaveGuardModal } from './components/PreSaveGuardModal';
import { api, PreSaveGuardError } from './services/api';
import { pluginManager, PluginSystemState } from './services/pluginLoader';
import { showGlobalToast } from './components/ui';
import { revisionHistoryService } from './services/revisionHistory';
import { Settings, FileItem, OpenFile, FileRevision, GuardIssue, GuardValidationResult, WorkspaceRoot, SSHHost } from './types';
import { parseContentToOutline } from './utils/astParser';
import { translations, Language, DEFAULT_LANGUAGE } from './utils/i18n';
import { adjustBrightness, getLuminance } from './utils/color';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({
    appTitle: 'Config Studio',
    baseColor: '#161b22',
    accentColor: '#00d2b4',
    themeMode: 'dark',
    language: DEFAULT_LANGUAGE,
    hasCustomIcon: false,
    authEnabled: false,
    authUser: 'admin',
    apiEnabled: false,
    apiKey: '',
    pluginExecUnrestricted: false,
  });

  const [pluginState, setPluginState] = useState<PluginSystemState>(pluginManager.getState());
  const [pendingConfirm, setPendingConfirm] = useState<{
    command: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const [authStatus, setAuthStatus] = useState<{
    authRequired: boolean;
    authenticated: boolean;
    user: string;
  }>({ authRequired: false, authenticated: true, user: 'guest' });

  const [workspaces, setWorkspaces] = useState<WorkspaceRoot[]>([]);
  const [itemsByRoot, setItemsByRoot] = useState<Record<string, { currentDir: string; items: FileItem[]; loading?: boolean }>>({});
  const [isAddWorkspaceOpen, setIsAddWorkspaceOpen] = useState<boolean>(false);
  const [editingWorkspace, setEditingWorkspace] = useState<WorkspaceRoot | null>(null);

  const [currentDir, setCurrentDir] = useState<string>('');
  const [dirItems, setDirItems] = useState<FileItem[]>([]);
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [isPropertiesOpen, setIsPropertiesOpen] = useState<boolean>(false);
  const [preSaveGuardIssue, setPreSaveGuardIssue] = useState<GuardIssue | null>(null);
  const [isPreSaveGuardOpen, setIsPreSaveGuardOpen] = useState<boolean>(false);
  const [guardResult, setGuardResult] = useState<GuardValidationResult | null>(null);
  const [isBottomDockOpen, setIsBottomDockOpen] = useState<boolean>(false);
  const [activeBottomDockId, setActiveBottomDockId] = useState<string>('problems');
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [isMobileFileDrawerOpen, setIsMobileFileDrawerOpen] = useState<boolean>(false);
  const [isMobileOutlineDrawerOpen, setIsMobileOutlineDrawerOpen] = useState<boolean>(false);
  const [isTimeMachineOpen, setIsTimeMachineOpen] = useState<boolean>(false);

  // Open bottom dock if a plugin requested a bottom panel
  useEffect(() => {
    if (pluginState.activeBottomPanelId) {
      setActiveBottomDockId(pluginState.activeBottomPanelId);
      setIsBottomDockOpen(true);
    }
  }, [pluginState.activeBottomPanelId]);

  // Global hotkeys (Ctrl+~, Ctrl+J to toggle bottom dock, Alt+H for Time Machine)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === '`' || e.key === '~' || e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setIsBottomDockOpen((prev) => !prev);
      } else if (e.altKey && (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р')) {
        e.preventDefault();
        setIsTimeMachineOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const editorRef = useRef<any>(null);
  const t = translations[settings.language] || translations.ru;

  const getTabKey = (tab: { root?: string; path: string; fullRelPath?: string }) =>
    tab.fullRelPath || (tab.root ? `${tab.root}:${tab.path}` : tab.path);

  const currentFile = useMemo(
    () => tabs.find((t) => getTabKey(t) === activeTabKey || t.path === activeTabKey) || null,
    [tabs, activeTabKey]
  );

  const currentFileRef = useRef(currentFile);
  currentFileRef.current = currentFile;
  const currentDirRef = useRef(currentDir);
  currentDirRef.current = currentDir;

  // Check initial authentication and load settings
  useEffect(() => {
    checkAuthAndInit();
  }, []);

  // Initialize Plugin System
  useEffect(() => {
    pluginManager.init({
      getActiveFile: () => currentFileRef.current,
      setActiveContent: (content: string) => {
        if (currentFileRef.current) {
          handleContentChange(content);
        }
      },
      showNotification: (msg, type) => {
        showGlobalToast(msg, (type as any) || 'info');
      },
      confirmCommand: (command: string) => {
        return new Promise<boolean>((resolve) => {
          setPendingConfirm({ command, resolve });
        });
      },
      openFile: async (path: string) => {
        await openFile(path);
      },
      createFile: async (path: string, content: string = '') => {
        await api.createItem(path, false);
        if (content) {
          await api.saveFile(path, content, false);
        }
        await loadDir(currentDirRef.current);
        await openFile(path);
      },
      refreshFiles: async () => {
        await loadDir(currentDirRef.current);
      },
      openCustomTab: async (customTab: {
        path: string;
        name: string;
        content: string;
        language?: string;
        readOnly?: boolean;
        badge?: string;
        onSave?: (content: string) => Promise<void>;
      }) => {
        const existing = tabs.find((t) => t.path === customTab.path);
        if (existing) {
          setActiveTabKey(getTabKey(existing));
          return;
        }
        const newTab: OpenFile = {
          path: customTab.path,
          name: customTab.name,
          content: customTab.content,
          initialContent: customTab.content,
          isDirty: false,
          readOnly: customTab.readOnly,
          badge: customTab.badge,
          language: customTab.language || customTab.name.split('.').pop() || '',
          revisions: [],
          onCustomSave: customTab.onSave,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabKey(customTab.path);
      },
    });

    const unsubscribe = pluginManager.subscribe((state) => {
      setPluginState(state);
    });

    pluginManager.loadPlugins();

    return () => {
      unsubscribe();
    };
  }, []);

  // Dispatch onFileOpen whenever active tab changes
  useEffect(() => {
    if (currentFile) {
      pluginManager.notifyFileOpen(currentFile);
    }
  }, [currentFile ? getTabKey(currentFile) : null]);

  // Sync active language to plugin manager
  useEffect(() => {
    if (settings.language) {
      pluginManager.setLanguage(settings.language);
    }
  }, [settings.language]);

  const checkAuthAndInit = async () => {
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
      if (!status.authRequired || status.authenticated) {
        await loadSettings();
        await loadWorkspaces();
      }
    } catch (e) {
      console.error('Failed to init auth:', e);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const loadWorkspaces = async () => {
    try {
      const res = await api.getWorkspaces();
      const wsList = res.workspaces || [];
      setWorkspaces(wsList);
      for (const ws of wsList) {
        await loadDir('', ws.id);
      }
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      // Fallback: load default root
      await loadDir('');
    }
  };

  const loadDir = async (path: string, rootId?: string) => {
    const root = rootId || workspaces[0]?.id || 'default';
    try {
      const res = await api.getTree(path, root);
      const targetDir = res.path || '';
      const targetItems = res.items || [];

      setItemsByRoot((prev) => ({
        ...prev,
        [root]: { currentDir: targetDir, items: targetItems, loading: false },
      }));

      // Keep legacy single dir state in sync with first workspace
      if (!workspaces.length || root === (workspaces[0]?.id || 'default')) {
        setCurrentDir(targetDir);
        setDirItems(targetItems);
      }

      // Auto-open first yaml/json file if no tabs open
      if (tabs.length === 0 && targetItems.length > 0) {
        const first = targetItems.find(
          (i) =>
            !i.isDir &&
            (i.extension === '.yml' ||
              i.extension === '.yaml' ||
              i.extension === '.json')
        );
        if (first) {
          openFile(first.path, root);
        }
      }
    } catch (err: any) {
      console.error(`Failed to list directory for root ${root}:`, err);
    }
  };

  // Open file into multi-tab system
  const openFile = async (filePath: string, rootId?: string) => {
    let root = rootId || '';
    let cleanPath = filePath;

    // Check if filePath is compound "root:path"
    if (!root && filePath.includes(':')) {
      const idx = filePath.indexOf(':');
      root = filePath.substring(0, idx);
      cleanPath = filePath.substring(idx + 1);
    }
    if (!root) {
      root = workspaces[0]?.id || 'default';
    }

    const targetKey = `${root}:${cleanPath}`;
    const existing = tabs.find(
      (t) => getTabKey(t) === targetKey || (t.root === root && t.path === cleanPath)
    );
    if (existing) {
      setActiveTabKey(getTabKey(existing));
      return;
    }

    try {
      const fileData = await api.getFile(cleanPath, root);
      const fullRelPath =
        fileData.fullRelPath || targetKey;

      const savedRevisions = revisionHistoryService.getRevisions(fullRelPath);
      const newTab: OpenFile = {
        path: fileData.path,
        root: fileData.root || root,
        fullRelPath,
        name: fileData.name,
        content: fileData.content,
        initialContent: fileData.content,
        isDirty: false,
        readOnly: fileData.readOnly,
        language: fileData.name.split('.').pop() || '',
        revisions: savedRevisions,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabKey(fullRelPath);
    } catch (err: any) {
      alert(`Error reading file: ${err.message}`);
    }
  };

  const handleOpenSftpFile = async (host: SSHHost, remotePath: string) => {
    try {
      setIsSaving(true);
      const fileData = await api.sftpRead({
        host: host.host,
        port: host.port || 22,
        user: host.user || 'root',
        authType: host.authType,
        identityId: host.identityId,
        password: host.password,
        privateKey: host.privateKey,
        passphrase: host.passphrase,
        path: remotePath,
      });

      const fileName = remotePath.split('/').pop() || remotePath;
      const sftpKey = `sftp://${host.host}:${host.port || 22}${remotePath}`;

      // If already open, switch to it
      const existing = tabs.find((t) => getTabKey(t) === sftpKey);
      if (existing) {
        setActiveTabKey(sftpKey);
        return;
      }

      const savedRevisions = revisionHistoryService.getRevisions(sftpKey);
      const newTab: OpenFile = {
        path: remotePath,
        root: `sftp:${host.id || host.host}`,
        fullRelPath: sftpKey,
        name: fileName,
        content: fileData.content || '',
        initialContent: fileData.content || '',
        isDirty: false,
        readOnly: false,
        language: fileName.split('.').pop() || '',
        revisions: savedRevisions,
        badge: `SFTP: ${host.name || host.host}`,
        onCustomSave: async (newContent: string) => {
          await api.sftpWrite({
            host: host.host,
            port: host.port || 22,
            user: host.user || 'root',
            authType: host.authType,
            identityId: host.identityId,
            password: host.password,
            privateKey: host.privateKey,
            passphrase: host.passphrase,
            path: remotePath,
            content: newContent,
          });
        },
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabKey(sftpKey);
      showGlobalToast(
        settings.language === 'ru'
          ? `Файл ${fileName} открыт с сервера ${host.name || host.host}`
          : `Opened ${fileName} from ${host.name || host.host}`,
        'success'
      );
    } catch (err: any) {
      alert(`Ошибка чтения файла по SFTP: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseTab = (tabKey: string) => {
    const tabToClose = tabs.find((t) => getTabKey(t) === tabKey || t.path === tabKey);
    if (tabToClose?.isDirty) {
      const msg = t.unsavedWarning.replace('{name}', tabToClose.name);
      if (!confirm(msg)) {
        return;
      }
    }

    const keyToClose = tabToClose ? getTabKey(tabToClose) : tabKey;
    const idx = tabs.findIndex((t) => getTabKey(t) === keyToClose);
    const nextTabs = tabs.filter((t) => getTabKey(t) !== keyToClose);
    setTabs(nextTabs);

    if (activeTabKey === keyToClose || (tabToClose && activeTabKey === tabToClose.path)) {
      if (nextTabs.length === 0) {
        setActiveTabKey(null);
      } else {
        const nextIdx = Math.min(Math.max(0, idx - 1), nextTabs.length - 1);
        setActiveTabKey(getTabKey(nextTabs[nextIdx]));
      }
    }
  };

  // Window beforeunload prompt if any tab is dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasDirty = tabs.some((tab) => tab.isDirty);
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [tabs]);

  // Sync <head> title and favicon
  useEffect(() => {
    const filePart = currentFile ? currentFile.name : currentDir ? currentDir : 'Workspace';
    document.title = `${settings.appTitle} — ${filePart}`;

    const favicon = document.getElementById('app-favicon') as HTMLLinkElement;
    if (favicon) {
      if (settings.hasCustomIcon) {
        favicon.href = `/api/branding/icon?t=${Date.now()}`;
        if (settings.iconMime) {
          favicon.type = settings.iconMime;
        }
      } else {
        const initials = (settings.appTitle || 'CS').substring(0, 2).toUpperCase();
        favicon.href = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='${encodeURIComponent(
          settings.accentColor
        )}'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='48' font-weight='bold' fill='%23121212'>${initials}</text></svg>`;
        favicon.type = 'image/svg+xml';
      }
    }
  }, [settings.appTitle, settings.hasCustomIcon, settings.iconMime, settings.accentColor, currentFile, currentDir]);

  // Apply CSS color variables dynamically
  useEffect(() => {
    const base = settings.baseColor || '#161b22';
    const isBaseLight = getLuminance(base) > 0.55;
    const isDark = settings.themeMode === 'dark' && !isBaseLight;

    if (isDark) {
      document.documentElement.classList.add('dark');
      const surface = adjustBrightness(base, 6);
      const surfaceHover = adjustBrightness(base, 14);
      const border = adjustBrightness(base, 20);

      document.documentElement.style.setProperty('--color-base', base);
      document.documentElement.style.setProperty('--color-surface', surface);
      document.documentElement.style.setProperty('--color-surface-hover', surfaceHover);
      document.documentElement.style.setProperty('--color-border', border);
    } else {
      document.documentElement.classList.remove('dark');
      const lightBase = isBaseLight ? base : '#f8fafc';
      const surface = isBaseLight ? adjustBrightness(base, -4) : '#ffffff';
      const surfaceHover = isBaseLight ? adjustBrightness(base, -8) : '#f1f5f9';
      const border = isBaseLight ? adjustBrightness(base, -14) : '#e2e8f0';

      document.documentElement.style.setProperty('--color-base', lightBase);
      document.documentElement.style.setProperty('--color-surface', surface);
      document.documentElement.style.setProperty('--color-surface-hover', surfaceHover);
      document.documentElement.style.setProperty('--color-border', border);
    }

    document.documentElement.style.setProperty('--color-accent', settings.accentColor || '#00d2b4');
  }, [settings.baseColor, settings.accentColor, settings.themeMode]);

  // Real-time AST parsing for Outline
  const { outline, parseError } = useMemo(() => {
    if (!currentFile) return { outline: [], parseError: undefined };
    const { outline, error } = parseContentToOutline(
      currentFile.content,
      currentFile.language,
      currentFile.name
    );
    return { outline, parseError: error };
  }, [currentFile?.content, currentFile?.language, currentFile?.name]);

  const handleContentChange = (newContent: string) => {
    if (!currentFile) return;
    const activeKey = getTabKey(currentFile);
    setTabs((prev) =>
      prev.map((tab) =>
        getTabKey(tab) === activeKey
          ? {
              ...tab,
              content: newContent,
              isDirty: newContent !== tab.initialContent,
            }
          : tab
      )
    );
  };

  // Background real-time Structure Guard check
  useEffect(() => {
    if (!currentFile) {
      setGuardResult(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.validateGuard(currentFile.path, currentFile.content);
        setGuardResult(res);
      } catch {
        // ignore validation background error
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [currentFile ? getTabKey(currentFile) : null, currentFile?.content]);

  const handleSaveFile = async (forceParam?: any) => {
    if (!currentFile) return;
    const force = forceParam === true;
    setIsSaving(true);
    try {
      if (currentFile.onCustomSave) {
        await currentFile.onCustomSave(currentFile.content);
        const activeKey = getTabKey(currentFile);

        const currentLines = currentFile.content.split('\n').length;
        const initialLines = currentFile.initialContent.split('\n').length;
        if (currentFile.revisions.length === 0 && currentFile.initialContent) {
          const baseRev: FileRevision = {
            id: `rev_base_${Date.now() - 1000}`,
            timestamp: new Date(Date.now() - 1000).toISOString(),
            content: currentFile.initialContent,
            linesCount: initialLines,
            linesDelta: 0,
          };
          revisionHistoryService.addRevision(activeKey, baseRev);
        }

        const newRev: FileRevision = {
          id: `rev_${Date.now()}`,
          timestamp: new Date().toISOString(),
          content: currentFile.content,
          linesCount: currentLines,
          linesDelta: currentLines - initialLines,
        };
        const updatedRevisions = revisionHistoryService.addRevision(activeKey, newRev);

        setTabs((prev) =>
          prev.map((tab) =>
            getTabKey(tab) === activeKey
              ? {
                  ...tab,
                  initialContent: currentFile.content,
                  isDirty: false,
                  revisions: updatedRevisions,
                }
              : tab
          )
        );
        pluginManager.notifyFileSave(currentFile);
        showGlobalToast(`${currentFile.name} успешно сохранен`, 'success');
        return;
      }

      await api.saveFile(
        currentFile.path,
        currentFile.content,
        true,
        force,
        currentFile.root
      );

      // Create and persist revision snapshot
      const activeKey = getTabKey(currentFile);
      const currentLines = currentFile.content.split('\n').length;
      const initialLines = currentFile.initialContent.split('\n').length;

      // If this is the first save of this file, record baseline before changes
      if (currentFile.revisions.length === 0 && currentFile.initialContent) {
        const baseRev: FileRevision = {
          id: `rev_base_${Date.now() - 1000}`,
          timestamp: new Date(Date.now() - 1000).toISOString(),
          content: currentFile.initialContent,
          linesCount: initialLines,
          linesDelta: 0,
        };
        revisionHistoryService.addRevision(activeKey, baseRev);
      }

      const newRev: FileRevision = {
        id: `rev_${Date.now()}`,
        timestamp: new Date().toISOString(),
        content: currentFile.content,
        linesCount: currentLines,
        linesDelta: currentLines - initialLines,
      };

      const updatedRevisions = revisionHistoryService.addRevision(activeKey, newRev);

      setTabs((prev) =>
        prev.map((tab) =>
          getTabKey(tab) === activeKey
            ? {
                ...tab,
                initialContent: currentFile.content,
                isDirty: false,
                revisions: updatedRevisions,
              }
            : tab
        )
      );

      setIsPreSaveGuardOpen(false);
      setPreSaveGuardIssue(null);
      pluginManager.notifyFileSave(currentFile);
      showGlobalToast(`${currentFile.name} успешно сохранен`, 'success');

      const rootToRefresh = currentFile.root || workspaces[0]?.id || 'default';
      const dirToRefresh = itemsByRoot[rootToRefresh]?.currentDir || '';
      await loadDir(dirToRefresh, rootToRefresh);
    } catch (err: any) {
      if (err instanceof PreSaveGuardError) {
        setPreSaveGuardIssue(err.guard);
        setIsPreSaveGuardOpen(true);
      } else {
        alert(`Failed to save file: ${err.message}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseGuardModal = (targetLine?: number, targetCol?: number) => {
    setIsPreSaveGuardOpen(false);
    if (editorRef.current && targetLine) {
      editorRef.current.revealLineInCenter(targetLine);
      editorRef.current.setPosition({ lineNumber: targetLine, column: targetCol || 1 });
      editorRef.current.focus();
    }
  };

  const handleRestoreRevision = (content: string) => {
    if (!currentFile) return;
    if (editorRef.current) {
      editorRef.current.setValue(content);
    }
    handleContentChange(content);
    showGlobalToast(
      settings.language === 'ru'
        ? `Откат к версии выполнен (${currentFile.name})`
        : `Restored revision for ${currentFile.name}`,
      'info'
    );
  };

  const handleDownload = () => {
    if (!currentFile) return;
    const url = api.getDownloadUrl(currentFile.path);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleJumpToLine = (line: number, shouldFocus: boolean = true) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      if (shouldFocus) {
        editorRef.current.setPosition({ lineNumber: line, column: 1 });
        editorRef.current.focus();
      }
    }
  };

  const handleCreateItem = async (path: string, isDir: boolean, rootId?: string) => {
    const root = rootId || workspaces[0]?.id || 'default';
    try {
      await api.createItem(path, isDir, root);
      const dirToRefresh = itemsByRoot[root]?.currentDir || '';
      await loadDir(dirToRefresh, root);
      if (!isDir) {
        await openFile(path, root);
      }
    } catch (err: any) {
      alert(`Error creating item: ${err.message}`);
    }
  };

  const handleDeleteItem = async (path: string, rootId?: string) => {
    const root = rootId || workspaces[0]?.id || 'default';
    try {
      await api.deleteItem(path, root);
      const targetKey = `${root}:${path}`;
      const remaining = tabs.filter(
        (t) => !(getTabKey(t) === targetKey || (t.path === path && t.root === root))
      );
      setTabs(remaining);
      if (currentFile && (getTabKey(currentFile) === targetKey || (currentFile.path === path && currentFile.root === root))) {
        setActiveTabKey(remaining.length > 0 ? getTabKey(remaining[0]) : null);
      }
      const dirToRefresh = itemsByRoot[root]?.currentDir || '';
      await loadDir(dirToRefresh, root);
    } catch (err: any) {
      alert(`Error deleting item: ${err.message}`);
    }
  };

  const handleRenameItem = async (oldPath: string, newPath: string, rootId?: string) => {
    const root = rootId || workspaces[0]?.id || 'default';
    try {
      await api.renameItem(oldPath, newPath, root);
      const oldKey = `${root}:${oldPath}`;
      const newKey = `${root}:${newPath}`;
      setTabs((prev) =>
        prev.map((t) =>
          getTabKey(t) === oldKey || (t.path === oldPath && (!root || t.root === root))
            ? {
                ...t,
                path: newPath,
                fullRelPath: newKey,
                name: newPath.split('/').pop() || newPath,
              }
            : t
        )
      );
      if (currentFile && (getTabKey(currentFile) === oldKey || currentFile.path === oldPath)) {
        setActiveTabKey(newKey);
      }
      const dirToRefresh = itemsByRoot[root]?.currentDir || '';
      await loadDir(dirToRefresh, root);
    } catch (err: any) {
      alert(`Error renaming item: ${err.message}`);
    }
  };

  const handleUploadFile = async (dirPath: string, file: File, rootId?: string) => {
    const root = rootId || workspaces[0]?.id || 'default';
    try {
      const savedPath = await api.uploadFile(dirPath, file, root);
      const dirToRefresh = itemsByRoot[root]?.currentDir || '';
      await loadDir(dirToRefresh, root);
      await openFile(savedPath, root);
    } catch (err: any) {
      alert(`Error uploading file: ${err.message}`);
    }
  };

  const handleSaveWorkspace = async (rootData: Partial<WorkspaceRoot>) => {
    if (editingWorkspace) {
      await api.updateWorkspace(editingWorkspace.id, rootData);
      showGlobalToast('Рабочая область обновлена', 'success');
    } else {
      await api.addWorkspace(rootData);
      showGlobalToast('Рабочая папка успешно добавлена', 'success');
    }
    await loadWorkspaces();
  };

  const handleDeleteWorkspace = async (rootId: string) => {
    try {
      await api.deleteWorkspace(rootId);
      showGlobalToast('Рабочая папка отмонтирована', 'info');
      // Close tabs belonging to this unmounted root
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.root !== rootId);
        if (currentFile && currentFile.root === rootId) {
          setActiveTabKey(remaining.length > 0 ? getTabKey(remaining[0]) : null);
        }
        return remaining;
      });
      await loadWorkspaces();
    } catch (err: any) {
      alert(`Ошибка удаления рабочей области: ${err.message}`);
    }
  };

  const handleSaveSettings = async (newSettings: Partial<Settings>) => {
    const updated = await api.updateSettings(newSettings);
    setSettings(updated);
    showGlobalToast('Настройки успешно обновлены', 'success');
  };

  const handleUploadIcon = async (file: File) => {
    const updated = await api.uploadIcon(file);
    setSettings(updated);
  };

  const handleToggleTheme = async () => {
    const nextMode = settings.themeMode === 'dark' ? 'light' : 'dark';
    const updated = await api.updateSettings({ themeMode: nextMode });
    setSettings(updated);
  };

  const handleChangeLanguage = async (newLang: Language) => {
    const updated = await api.updateSettings({ language: newLang });
    setSettings(updated);
  };

  const handleLogin = async (user: string, pass: string) => {
    await api.login(user, pass);
    await checkAuthAndInit();
  };

  const handleLogout = async () => {
    await api.logout();
    setAuthStatus({ authRequired: true, authenticated: false, user: '' });
  };

  // If authentication is required and not authenticated, show Login Screen
  if (authStatus.authRequired && !authStatus.authenticated) {
    return <LoginScreen settings={settings} onLogin={handleLogin} />;
  }

  const activeSplitPanel = pluginState.splitPanels.find(
    (p) => p.id === pluginState.activeSplitPanelId && p.open
  );

  return (
    <div className="h-full w-full h-[100dvh] flex flex-col overflow-hidden bg-base text-gray-900 dark:text-gray-100 select-none">
      {/* Top Header */}
      <Header
        settings={settings}
        currentFile={currentFile}
        currentDir={currentDir}
        isSaving={isSaving}
        pluginHeaderItems={pluginState.headerItems}
        activePluginsCount={pluginState.plugins.filter((p) => p.enabled).length}
        onSave={() => handleSaveFile(false)}
        onDownload={handleDownload}
        onOpenSettings={() => {
          setSettingsTab('general');
          setIsSettingsOpen(true);
        }}
        onOpenPlugins={() => {
          setSettingsTab('plugins');
          setIsSettingsOpen(true);
        }}
        onOpenProperties={() => setIsPropertiesOpen(true)}
        onToggleTheme={handleToggleTheme}
        onChangeLanguage={handleChangeLanguage}
        onLogout={authStatus.authRequired ? handleLogout : undefined}
        onOpenFile={openFile}
        onNavigateDir={loadDir}
        onToggleMobileFiles={() => setIsMobileFileDrawerOpen((prev) => !prev)}
        onToggleMobileOutline={() => setIsMobileOutlineDrawerOpen((prev) => !prev)}
        isMobileOutlineOpen={isMobileOutlineDrawerOpen}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: File Explorer with Multi-Root Workspace support */}
        <FileExplorer
          items={dirItems}
          currentDir={currentDir}
          selectedFilePath={currentFile ? getTabKey(currentFile) : null}
          settings={settings}
          workspaces={workspaces}
          activeRootId={currentFile?.root || undefined}
          itemsByRoot={itemsByRoot}
          onSelectFile={openFile}
          onNavigateDir={loadDir}
          onRefresh={(rootId) => {
            if (rootId) {
              loadDir(itemsByRoot[rootId]?.currentDir || '', rootId);
            } else {
              loadWorkspaces();
            }
          }}
          onCreateItem={handleCreateItem}
          onDeleteItem={handleDeleteItem}
          onRenameItem={handleRenameItem}
          onUploadFile={handleUploadFile}
          onAddWorkspace={() => {
            setEditingWorkspace(null);
            setIsAddWorkspaceOpen(true);
          }}
          onEditWorkspace={(ws) => {
            setEditingWorkspace(ws);
            setIsAddWorkspaceOpen(true);
          }}
          onDeleteWorkspace={handleDeleteWorkspace}
          isMobileDrawerOpen={isMobileFileDrawerOpen}
          onCloseMobileDrawer={() => setIsMobileFileDrawerOpen(false)}
          onOpenSftpFile={handleOpenSftpFile}
          onOpenTerminalHost={(host) => {
            setIsBottomDockOpen(true);
            setActiveBottomDockId('terminal');
          }}
          onOpenSettingsSsh={() => {
            setSettingsTab('ssh');
            setIsSettingsOpen(true);
          }}
        />

        {/* Center: Monaco Editor with multi-tabs & full-width tag bar & bottom dock */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
          <Editor
            tabs={tabs}
            activeFilePath={activeTabKey}
            settings={settings}
            workspaces={workspaces}
            outline={outline}
            pluginButtons={pluginState.toolbarButtons}
            guardResult={guardResult}
            onOpenGuardModal={() => {
              if (guardResult && guardResult.issues.length > 0) {
                setPreSaveGuardIssue(guardResult.issues[0]);
              }
              setIsPreSaveGuardOpen(true);
            }}
            onSelectTab={setActiveTabKey}
            onCloseTab={handleCloseTab}
            onChangeContent={handleContentChange}
            onSave={() => handleSaveFile(false)}
            onSelectLine={handleJumpToLine}
            onCursorChange={(line, col) => setCursorPos({ line, col })}
            editorRef={editorRef}
            isTimeMachineOpen={isTimeMachineOpen}
            onToggleTimeMachine={setIsTimeMachineOpen}
            onRestoreRevision={handleRestoreRevision}
          />

          <BottomDockStrip
            panels={pluginState.bottomPanels}
            activePanelId={activeBottomDockId}
            isOpen={isBottomDockOpen}
            dockMode={settings.bottomDockMode || 'auto'}
            guardResult={guardResult}
            currentFile={currentFile}
            cursorPos={cursorPos}
            language={settings.language}
            onToggleOpen={(open) => setIsBottomDockOpen((prev) => (open !== undefined ? open : !prev))}
            onSelectPanel={(panelId) => {
              setActiveBottomDockId(panelId);
              setIsBottomDockOpen(true);
            }}
            onClosePanel={(panelId) => {
              pluginManager.closeBottomPanel(panelId);
              if (activeBottomDockId === panelId) {
                setActiveBottomDockId('problems');
              }
            }}
            onJumpToLine={(line, col) => handleJumpToLine(line, true)}
            accentColor={settings.accentColor}
          />
        </div>

        {/* Optional Plugin Split Panel (e.g. Web DevKit Live Preview) */}
        {activeSplitPanel && (
          <PluginSplitPanel
            panel={activeSplitPanel}
            onClose={() => pluginManager.closeSplitPanel(activeSplitPanel.id)}
          />
        )}

        {/* Right: Structure Outline with Quick Jump tags */}
        <StructureOutline
          outline={outline}
          error={parseError}
          settings={settings}
          onSelectLine={handleJumpToLine}
          isMobileDrawerOpen={isMobileOutlineDrawerOpen}
          onCloseMobileDrawer={() => setIsMobileOutlineDrawerOpen(false)}
        />
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        onReloadSettings={loadSettings}
        onReloadPlugins={async () => {
          await pluginManager.loadPlugins();
        }}
        onUploadIcon={handleUploadIcon}
        initialTab={settingsTab}
        onOpenTerminal={(host) => {
          setIsSettingsOpen(false);
          setIsBottomDockOpen(true);
          setActiveBottomDockId('terminal');
        }}
      />

      {/* File Properties & History Modal */}
      <FilePropertiesModal
        isOpen={isPropertiesOpen}
        onClose={() => setIsPropertiesOpen(false)}
        file={currentFile}
        settings={settings}
        onRestoreRevision={handleRestoreRevision}
        onOpenTimeMachine={() => {
          setIsPropertiesOpen(false);
          setIsTimeMachineOpen(true);
        }}
      />

      {/* Sensitive Command Confirmation Modal */}
      <CommandConfirmModal
        isOpen={!!pendingConfirm}
        command={pendingConfirm?.command || ''}
        onConfirm={() => {
          pendingConfirm?.resolve(true);
          setPendingConfirm(null);
        }}
        onDeny={() => {
          pendingConfirm?.resolve(false);
          setPendingConfirm(null);
        }}
      />

      {/* Structure Guard / Pre-Save Guard Modal */}
      <PreSaveGuardModal
        isOpen={isPreSaveGuardOpen}
        issue={preSaveGuardIssue}
        filePath={currentFile?.path || ''}
        isSaving={isSaving}
        onClose={handleCloseGuardModal}
        onForceSave={() => handleSaveFile(true)}
      />

      {/* Add / Edit Workspace Modal */}
      <AddWorkspaceModal
        isOpen={isAddWorkspaceOpen}
        onClose={() => {
          setIsAddWorkspaceOpen(false);
          setEditingWorkspace(null);
        }}
        onSave={handleSaveWorkspace}
        editingWorkspace={editingWorkspace}
        settings={settings}
      />
    </div>
  );
};
