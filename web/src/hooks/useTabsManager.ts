import { useState, useRef, useMemo, useEffect } from 'react';
import { OpenFile, OpenFileOptions, FileRevision, SSHHost, WorkspaceRoot } from '../types';
import { api } from '../services/api';
import { revisionHistoryService } from '../services/revisionHistory';
import { showGlobalToast } from '../components/ui';

export const getTabKey = (tab: { root?: string; path: string; fullRelPath?: string }) =>
  tab.fullRelPath || (tab.root ? `${tab.root}:${tab.path}` : tab.path);

interface UseTabsManagerOptions {
  workspacesRef: React.MutableRefObject<WorkspaceRoot[]>;
  language: string;
  unsavedWarningText: string;
  onJumpToLine?: (line: number, col?: number, shouldFocus?: boolean, highlight?: boolean) => void;
  editorRef?: React.MutableRefObject<any>;
}

export function useTabsManager({
  workspacesRef,
  language,
  unsavedWarningText,
  onJumpToLine,
  editorRef,
}: UseTabsManagerOptions) {
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);

  const currentFile = useMemo(
    () =>
      tabs.find(
        (t) =>
          getTabKey(t) === activeTabKey ||
          (t.fullRelPath && t.fullRelPath === activeTabKey) ||
          (!t.root && t.path === activeTabKey)
      ) || null,
    [tabs, activeTabKey]
  );

  const currentFileRef = useRef(currentFile);
  currentFileRef.current = currentFile;

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

  const openFile = async (filePath: string, rootId?: string, options?: OpenFileOptions) => {
    let root = rootId || '';
    let cleanPath = filePath;

    // Check if filePath is compound "root:path"
    if (cleanPath.includes(':')) {
      const idx = cleanPath.indexOf(':');
      const prefix = cleanPath.substring(0, idx);
      if (prefix.length > 1) {
        if (!root || root === 'default') {
          root = prefix;
        }
        cleanPath = cleanPath.substring(idx + 1);
      }
    }
    cleanPath = cleanPath.replace(/^\/+/, '');
    if (!root || root === 'default') {
      root = currentFileRef.current?.root || workspacesRef.current?.[0]?.id || '';
    }

    const targetKey = root ? `${root}:${cleanPath}` : cleanPath;
    const existing = tabs.find(
      (t) =>
        getTabKey(t) === targetKey ||
        (root && t.root === root && t.path === cleanPath) ||
        (!root && !t.root && t.path === cleanPath) ||
        t.fullRelPath === targetKey
    );
    if (existing) {
      setActiveTabKey(getTabKey(existing));
      if (options?.line && onJumpToLine) {
        setTimeout(() => {
          onJumpToLine(options.line!, options.column || 1, true, options.highlight);
        }, 50);
      }
      return;
    }

    try {
      const fileData = await api.getFile(cleanPath, root === 'default' ? '' : root);
      const tabRoot = fileData.root || root;
      const fullRelPath =
        fileData.fullRelPath || (tabRoot ? `${tabRoot}:${cleanPath}` : cleanPath);

      const savedRevisions = revisionHistoryService.getRevisions(fullRelPath);
      const tabId = `tab-${tabRoot ? tabRoot + '-' : ''}${cleanPath.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now().toString(36)}`;
      const newTab: OpenFile = {
        id: tabId,
        path: fileData.path,
        root: tabRoot,
        fullRelPath,
        name: fileData.name,
        content: fileData.content,
        initialContent: fileData.content,
        isDirty: false,
        readOnly: fileData.readOnly,
        language: fileData.name.split('.').pop() || '',
        revisions: savedRevisions,
      };

      setTabs((prev) => {
        const isAlreadyOpen = prev.some(
          (t) =>
            getTabKey(t) === fullRelPath ||
            (tabRoot && t.root === tabRoot && t.path === fileData.path) ||
            (!tabRoot && !t.root && t.path === fileData.path) ||
            t.fullRelPath === fullRelPath
        );
        if (isAlreadyOpen) {
          return prev;
        }
        return [...prev, newTab];
      });
      setActiveTabKey(fullRelPath);
      if (options?.line && onJumpToLine) {
        setTimeout(() => {
          onJumpToLine(options.line!, options.column || 1, true, options.highlight);
        }, 120);
      }
    } catch (err: any) {
      alert(`Error reading file: ${err.message}`);
    }
  };

  const handleOpenSftpFile = async (host: SSHHost, remotePath: string) => {
    try {
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

      const existing = tabs.find((t) => getTabKey(t) === sftpKey);
      if (existing) {
        setActiveTabKey(sftpKey);
        return;
      }

      const savedRevisions = revisionHistoryService.getRevisions(sftpKey);
      const tabId = `tab-sftp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
      const newTab: OpenFile = {
        id: tabId,
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

      setTabs((prev) => {
        const isAlreadyOpen = prev.some(
          (t) => getTabKey(t) === sftpKey || t.fullRelPath === sftpKey
        );
        if (isAlreadyOpen) {
          return prev;
        }
        return [...prev, newTab];
      });
      setActiveTabKey(sftpKey);
      showGlobalToast(
        language === 'ru'
          ? `Файл ${fileName} открыт с сервера ${host.name || host.host}`
          : `Opened ${fileName} from ${host.name || host.host}`,
        'success'
      );
    } catch (err: any) {
      alert(`Ошибка чтения файла по SFTP: ${err.message}`);
    }
  };

  const handleCloseTab = (tabKey: string) => {
    const idx = tabs.findIndex(
      (t) => (t.id && t.id === tabKey) || getTabKey(t) === tabKey || (t.fullRelPath && t.fullRelPath === tabKey)
    );
    if (idx === -1) return;

    const tabToClose = tabs[idx];
    if (tabToClose?.isDirty) {
      const msg = unsavedWarningText.replace('{name}', tabToClose.name);
      if (!confirm(msg)) {
        return;
      }
    }

    const keyToClose = getTabKey(tabToClose);
    const nextTabs = tabs.filter((_, i) => i !== idx);
    setTabs(nextTabs);

    if (activeTabKey === keyToClose || activeTabKey === tabToClose.path || activeTabKey === tabKey) {
      if (nextTabs.length === 0) {
        setActiveTabKey(null);
      } else {
        const nextIdx = Math.min(Math.max(0, idx - 1), nextTabs.length - 1);
        setActiveTabKey(getTabKey(nextTabs[nextIdx]));
      }
    }
  };

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

  const handleRestoreRevision = (content: string) => {
    if (!currentFile) return;
    if (editorRef?.current) {
      editorRef.current.setValue(content);
    }
    handleContentChange(content);
    showGlobalToast(
      language === 'ru'
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

  return {
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
  };
}
