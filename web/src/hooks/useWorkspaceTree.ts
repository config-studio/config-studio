import { useState, useRef } from 'react';
import { WorkspaceRoot, FileItem, OpenFile } from '../types';
import { api, getRemoteEndpoint } from '../services/api';
import { showGlobalToast } from '../components/ui';

interface UseWorkspaceTreeOptions {
  tabs: OpenFile[];
  setTabs: React.Dispatch<React.SetStateAction<OpenFile[]>>;
  currentFile: OpenFile | null;
  setActiveTabKey: (key: string | null) => void;
  getTabKey: (tab: { root?: string; path: string; fullRelPath?: string }) => string;
  openFile: (path: string, rootId?: string) => Promise<void>;
}

export function useWorkspaceTree({
  tabs,
  setTabs,
  currentFile,
  setActiveTabKey,
  getTabKey,
  openFile,
}: UseWorkspaceTreeOptions) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRoot[]>([]);
  const [itemsByRoot, setItemsByRoot] = useState<
    Record<string, { currentDir: string; items: FileItem[]; loading?: boolean; error?: string }>
  >({});
  const [currentDir, setCurrentDir] = useState<string>('');
  const [dirItems, setDirItems] = useState<FileItem[]>([]);
  const hasAutoOpenedRef = useRef(false);

  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;

  const loadWorkspaces = async () => {
    try {
      setItemsByRoot({});
      const res = await api.getWorkspaces();
      const wsList = res.workspaces || [];
      setWorkspaces(wsList);
      if (wsList.length === 0) {
        setDirItems([]);
      }
      for (const ws of wsList) {
        await loadDir('', ws.id);
      }
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      const { endpoint } = getRemoteEndpoint();
      if (!endpoint) {
        await loadDir('');
      } else {
        setWorkspaces([]);
        setItemsByRoot({});
        setDirItems([]);
      }
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

      if (!workspaces.length || root === (workspaces[0]?.id || 'default')) {
        setCurrentDir(targetDir);
        setDirItems(targetItems);
      }

      if (!hasAutoOpenedRef.current && tabs.length === 0 && targetItems.length > 0) {
        const first = targetItems.find(
          (i) =>
            !i.isDir &&
            (i.extension === '.yml' ||
              i.extension === '.yaml' ||
              i.extension === '.json')
        );
        if (first) {
          hasAutoOpenedRef.current = true;
          openFile(first.path, root);
        }
      }
    } catch (err: any) {
      console.error(`Failed to list directory for root ${root}:`, err);
      setItemsByRoot((prev) => ({
        ...prev,
        [root]: { currentDir: path, items: [], loading: false, error: err.message },
      }));
      if (!workspaces.length || root === (workspaces[0]?.id || 'default')) {
        setDirItems([]);
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
      if (
        currentFile &&
        (getTabKey(currentFile) === targetKey || (currentFile.path === path && currentFile.root === root))
      ) {
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

  const handleDeleteWorkspace = async (rootId: string) => {
    try {
      await api.deleteWorkspace(rootId);
      showGlobalToast('Рабочая папка отмонтирована', 'info');
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

  return {
    workspaces,
    setWorkspaces,
    workspacesRef,
    itemsByRoot,
    setItemsByRoot,
    currentDir,
    setCurrentDir,
    dirItems,
    setDirItems,
    loadWorkspaces,
    loadDir,
    handleCreateItem,
    handleDeleteItem,
    handleRenameItem,
    handleUploadFile,
    handleDeleteWorkspace,
  };
}
