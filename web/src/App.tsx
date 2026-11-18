import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Header } from './components/Header';
import { FileExplorer } from './components/FileExplorer';
import { Editor } from './components/Editor';
import { StructureOutline } from './components/StructureOutline';
import { SettingsTab } from './components/settings/types';
import { LoginScreen } from './components/LoginScreen';
import { PluginSplitPanel } from './components/PluginSplitPanel';
import { BottomDockStrip } from './components/BottomDockStrip';
import { AppModals } from './components/AppModals';
import { api, PreSaveGuardError } from './services/api';
import { pluginManager, PluginSystemState } from './services/pluginLoader';
import { showGlobalToast } from './components/ui';
import { revisionHistoryService } from './services/revisionHistory';
import { Settings, OpenFileOptions, FileRevision, GuardIssue, GuardValidationResult, WorkspaceRoot, SSHHost } from './types';
import { parseContentToOutline } from './utils/astParser';
import { translations, Language, DEFAULT_LANGUAGE } from './utils/i18n';
import { adjustBrightness, getLuminance } from './utils/color';
import { useTabsManager } from './hooks/useTabsManager';
import { useWorkspaceTree } from './hooks/useWorkspaceTree';

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

  const [isAddWorkspaceOpen, setIsAddWorkspaceOpen] = useState<boolean>(false);
  const [editingWorkspace, setEditingWorkspace] = useState<WorkspaceRoot | null>(null);

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

  const editorRef = useRef<any>(null);
  const t = translations[settings.language] || translations.ru;

  const handleJumpToLine = (
    line: number,
    colOrFocus?: number | boolean,
    shouldFocus: boolean = true,
    highlight: boolean = false
  ) => {
    let col = 1;
    let focus = shouldFocus;
    if (typeof colOrFocus === 'number') {
      col = colOrFocus;
    } else if (typeof colOrFocus === 'boolean') {
      focus = colOrFocus;
    }

    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      if (focus) {
        editorRef.current.setPosition({ lineNumber: line, column: col });
        editorRef.current.focus();
      }
      if (highlight) {
        try {
          const monacoObj = (window as any).monaco;
          if (monacoObj && monacoObj.Range) {
            const decorations = editorRef.current.deltaDecorations([], [
              {
                range: new monacoObj.Range(line, 1, line, 1),
                options: {
                  isWholeLine: true,
                  className: 'cs-line-highlight-flash',
                },
              },
            ]);
            setTimeout(() => {
              if (editorRef.current) {
                editorRef.current.deltaDecorations(decorations, []);
              }
            }, 1600);
          }
        } catch (_) {
          // ignore decorative animation error
        }
      }
    }
  };

  // Tabs management
  const dummyWorkspacesRef = useRef<WorkspaceRoot[]>([]);
  const {
    tabs,
    setTabs,
    activeTabKey,
    setActiveTabKey,
    currentFile,
    currentFileRef,
    getTabKey,
    openFile,
    handleOpenSftpFile,
    handleCloseTab,
    handleContentChange,
    handleRestoreRevision,
    handleDownload,
  } = useTabsManager({
    workspacesRef: dummyWorkspacesRef,
    language: settings.language,
    unsavedWarningText: t.unsavedWarning,
    onJumpToLine: handleJumpToLine,
    editorRef,
  });

  // Workspace tree management
  const {
    workspaces,
    setWorkspaces,
    workspacesRef,
    itemsByRoot,
    setItemsByRoot,
    currentDir,
    dirItems,
    setDirItems,
    loadWorkspaces,
    loadDir,
    handleCreateItem,
    handleDeleteItem,
    handleRenameItem,
    handleUploadFile,
    handleDeleteWorkspace,
  } = useWorkspaceTree({
    tabs,
    setTabs,
    currentFile,
    setActiveTabKey,
    getTabKey,
    openFile,
  });

  // Update dummy reference to point to actual workspaces
  dummyWorkspacesRef.current = workspaces;

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

  const checkAuthAndInit = async () => {
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
      if (!status.authRequired || status.authenticated) {
        await loadSettings();
        await loadWorkspaces();
        await pluginManager.loadPlugins();
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
      openFile: async (path: string, options?: OpenFileOptions) => {
        const root = currentFileRef.current?.root || workspacesRef.current?.[0]?.id || '';
        await openFile(path, root, options);
      },
      createFile: async (path: string, content: string = '') => {
        let root = currentFileRef.current?.root || workspacesRef.current?.[0]?.id || '';
        let cleanPath = path;
        if (cleanPath.includes(':')) {
          const idx = cleanPath.indexOf(':');
          const prefix = cleanPath.substring(0, idx);
          if (prefix.length > 1) {
            root = prefix;
            cleanPath = cleanPath.substring(idx + 1);
          }
        }
        await api.saveFile(cleanPath, content, true, false, root);
        await loadDir('', root);
        await openFile(cleanPath, root);
      },
      refreshFiles: async () => {
        await loadWorkspaces();
      },
    });

    const unsubscribe = pluginManager.subscribe((state) => {
      setPluginState(state);
    });

    // Auto-load active plugins on startup
    pluginManager.loadPlugins();

    return () => {
      unsubscribe();
    };
  }, []);

  // Sync active file to plugin manager
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

  // Listen for terminal and SFTP requests from plugins
  useEffect(() => {
    const handleOpenSSHTerminal = () => {
      setIsBottomDockOpen(true);
      setActiveBottomDockId('terminal');
    };
    window.addEventListener('cs:open-ssh-terminal', handleOpenSSHTerminal);
    return () => window.removeEventListener('cs:open-ssh-terminal', handleOpenSSHTerminal);
  }, []);

  // Listen for remote endpoint changes (switching between Localhost and Fleet Agents)
  useEffect(() => {
    const handleRemoteEndpointChanged = async (e: any) => {
      const { endpoint } = e.detail || {};
      if (endpoint) {
        setWorkspaces([]);
        setItemsByRoot({});
        await loadDir('');
      } else {
        await loadWorkspaces();
      }
    };
    window.addEventListener('cs:remote-endpoint-changed', handleRemoteEndpointChanged);
    return () => window.removeEventListener('cs:remote-endpoint-changed', handleRemoteEndpointChanged);
  }, []);

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
    const targetPath = currentFile.fullRelPath || currentFile.path || currentFile.name;
    const { outline, error } = parseContentToOutline(
      currentFile.content,
      currentFile.language,
      targetPath
    );
    return { outline, parseError: error };
  }, [
    currentFile?.content,
    currentFile?.language,
    currentFile?.name,
    currentFile?.fullRelPath,
    currentFile?.path,
    pluginState,
  ]);

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

  const openSplitPanels = pluginState.splitPanels.filter((p) => p.open);

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
          onOpenTerminalHost={() => {
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
            themeMode={settings.themeMode}
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
            onJumpToLine={(line, col) => handleJumpToLine(line, col || 1, true, true)}
            accentColor={settings.accentColor}
          />
        </div>

        {/* Optional Plugin Split Panel */}
        {openSplitPanels.length > 0 && (
          <PluginSplitPanel
            panels={openSplitPanels}
            activePanelId={pluginState.activeSplitPanelId}
            onSelectPanel={(panelId) => pluginManager.setActiveSplitPanel(panelId)}
            onClose={(panelId) => pluginManager.closeSplitPanel(panelId)}
          />
        )}

        {/* Right: Structure Outline with Quick Jump tags */}
        <StructureOutline
          outline={outline}
          error={parseError}
          settings={settings}
          onSelectLine={(line) => handleJumpToLine(line, 1, true, true)}
          isMobileDrawerOpen={isMobileOutlineDrawerOpen}
          onCloseMobileDrawer={() => setIsMobileOutlineDrawerOpen(false)}
        />
      </div>

      {/* Extracted App Modals */}
      <AppModals
        settings={settings}
        currentFile={currentFile}
        isSaving={isSaving}
        isSettingsOpen={isSettingsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        settingsTab={settingsTab}
        onSaveSettings={handleSaveSettings}
        onReloadSettings={loadSettings}
        onReloadPlugins={async () => {
          await pluginManager.loadPlugins();
        }}
        onUploadIcon={handleUploadIcon}
        onOpenTerminal={() => {
          setIsSettingsOpen(false);
          setIsBottomDockOpen(true);
          setActiveBottomDockId('terminal');
        }}
        isPropertiesOpen={isPropertiesOpen}
        setIsPropertiesOpen={setIsPropertiesOpen}
        onRestoreRevision={handleRestoreRevision}
        onOpenTimeMachine={() => {
          setIsPropertiesOpen(false);
          setIsTimeMachineOpen(true);
        }}
        pendingConfirm={pendingConfirm}
        setPendingConfirm={setPendingConfirm}
        isPreSaveGuardOpen={isPreSaveGuardOpen}
        preSaveGuardIssue={preSaveGuardIssue}
        onCloseGuardModal={handleCloseGuardModal}
        onForceSave={() => handleSaveFile(true)}
        isAddWorkspaceOpen={isAddWorkspaceOpen}
        setIsAddWorkspaceOpen={setIsAddWorkspaceOpen}
        editingWorkspace={editingWorkspace}
        setEditingWorkspace={setEditingWorkspace}
        onSaveWorkspace={handleSaveWorkspace}
      />
    </div>
  );
};
