import { ContextMenuItem, ContextMenuTarget, WorkspaceRoot } from '../../types';
import { contextMenuRegistry } from '../../services/contextMenuRegistry';

export interface FileContextMenuOptions {
  workspaces: WorkspaceRoot[];
  t: Record<string, string>;
  itemsByRoot: Record<string, { currentDir?: string }>;
  onSelectFile: (path: string, rootId?: string) => void;
  onNavigateDir: (path: string, rootId?: string) => void;
  onCreateItem: (path: string, isDir: boolean, rootId?: string) => void;
  onRenameItem: (oldPath: string, newPath: string, rootId?: string) => void;
  onDeleteItem: (path: string, rootId?: string) => void;
  onRefresh: (rootId?: string) => void;
  onEditWorkspace?: (root: WorkspaceRoot) => void;
  onDeleteWorkspace?: (rootId: string) => void;
  triggerUpload: (rootId: string, dirPath?: string) => void;
  handleCreatePrompt: (isDir: boolean, rootId?: string) => void;
  setSftpSendTarget: (target: { path: string; root?: string; name: string }) => void;
}

export function buildFileContextMenuItems(
  target: ContextMenuTarget,
  opts: FileContextMenuOptions
): ContextMenuItem[] {
  const {
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
  } = opts;

  const coreItems: ContextMenuItem[] = [];

  // 1. Right clicked a root header
  if ((target as any).isRoot) {
    const rootId = (target as any).rootId;
    const root = workspaces.find((w) => w.id === rootId);

    coreItems.push({
      id: 'core.root.new-file',
      label: t.ctxNewFileHere || 'Новый файл...',
      icon: 'FilePlus',
      group: 'edit',
      order: 10,
      onClick: () => handleCreatePrompt(false, rootId),
    });

    coreItems.push({
      id: 'core.root.new-folder',
      label: t.ctxNewFolderHere || 'Новая папка...',
      icon: 'FolderPlus',
      group: 'edit',
      order: 20,
      onClick: () => handleCreatePrompt(true, rootId),
    });

    if (!root?.readOnly) {
      coreItems.push({
        id: 'core.root.upload',
        label: t.uploadFileHere || 'Загрузить файлы сюда...',
        icon: 'UploadCloud',
        group: 'edit',
        order: 25,
        onClick: () => triggerUpload(rootId, itemsByRoot[rootId]?.currentDir || ''),
      });
    }

    coreItems.push({
      id: 'core.root.refresh',
      label: t.ctxRefresh || 'Обновить',
      icon: 'RefreshCw',
      group: 'tools',
      order: 30,
      onClick: () => onRefresh(rootId),
    });

    if (root && onEditWorkspace) {
      coreItems.push({
        id: 'core.root.edit',
        label: t.editWorkspaceTitle || 'Настройки рабочей папки',
        icon: 'Settings',
        group: 'tools',
        order: 40,
        onClick: () => onEditWorkspace(root),
      });
    }

    if (workspaces.length > 1 && onDeleteWorkspace && root) {
      coreItems.push({
        id: 'core.root.delete',
        label: t.removeWorkspace || 'Удалить из рабочей области',
        icon: 'Trash2',
        group: 'danger',
        order: 50,
        onClick: () => {
          const msg = (t.removeWorkspaceConfirm || 'Удалить "{name}" из рабочей области?').replace('{name}', root.name);
          if (confirm(msg)) {
            onDeleteWorkspace(rootId);
          }
        },
      });
    }

    return coreItems;
  }

  // 2. Right clicked a file or folder
  if (target.name) {
    const itemRoot = (target as any).root;

    // Group 'open'
    if (!target.isDir) {
      coreItems.push({
        id: 'core.open',
        label: t.ctxOpen || 'Открыть',
        icon: 'FileCode',
        group: 'open',
        order: 10,
        onClick: () => onSelectFile(target.path, itemRoot),
      });
    } else {
      coreItems.push({
        id: 'core.open-folder',
        label: t.ctxOpenFolder || 'Открыть папку',
        icon: 'Folder',
        group: 'open',
        order: 10,
        onClick: () => onNavigateDir(target.path, itemRoot),
      });
    }

    // Group 'clipboard'
    coreItems.push({
      id: 'core.copy-path',
      label: t.ctxCopyPath || 'Копировать относительный путь',
      icon: 'Copy',
      group: 'clipboard',
      order: 10,
      shortcut: 'Ctrl+C',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(target.path);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = target.path;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
      },
    });

    // SFTP Direct Send for files
    if (!target.isDir) {
      coreItems.push({
        id: 'core.sftp.send',
        label: 'Отправить по SFTP...',
        icon: 'Send',
        group: 'tools',
        order: 25,
        onClick: () => {
          setSftpSendTarget({
            path: target.path,
            root: itemRoot,
            name: target.name,
          });
        },
      });
    }

    // Group 'edit' (New item inside this folder if target is directory)
    if (target.isDir) {
      coreItems.push({
        id: 'core.new-file-here',
        label: t.ctxNewFileHere || 'Новый файл...',
        icon: 'FilePlus',
        group: 'edit',
        order: 10,
        onClick: () => {
          const name = prompt(t.enterFileName || 'Имя нового файла:');
          if (name && name.trim()) {
            const full = `${target.path}/${name.trim()}`;
            onCreateItem(full, false, itemRoot);
          }
        },
      });
      coreItems.push({
        id: 'core.new-folder-here',
        label: t.ctxNewFolderHere || 'Новая папка...',
        icon: 'FolderPlus',
        group: 'edit',
        order: 20,
        onClick: () => {
          const name = prompt(t.enterFolderName || 'Имя новой папки:');
          if (name && name.trim()) {
            const full = `${target.path}/${name.trim()}`;
            onCreateItem(full, true, itemRoot);
          }
        },
      });

      const wsObj = workspaces.find((w) => w.id === itemRoot);
      if (!wsObj?.readOnly) {
        coreItems.push({
          id: 'core.folder.upload',
          label: t.uploadFileHere || 'Загрузить файлы сюда...',
          icon: 'UploadCloud',
          group: 'edit',
          order: 25,
          onClick: () => triggerUpload(itemRoot, target.path),
        });
      }
    }

    // Group 'edit' (Rename & Delete)
    coreItems.push({
      id: 'core.rename',
      label: t.ctxRename || 'Переименовать',
      icon: 'Edit2',
      group: 'edit',
      order: 30,
      shortcut: 'F2',
      onClick: () => {
        const newName = prompt(t.enterNewName || 'Новое имя:', target.name);
        if (!newName || !newName.trim() || newName.trim() === target.name) return;
        const dir = target.path.includes('/')
          ? target.path.substring(0, target.path.lastIndexOf('/'))
          : '';
        const newPath = dir ? `${dir}/${newName.trim()}` : newName.trim();
        onRenameItem(target.path, newPath, itemRoot);
      },
    });

    coreItems.push({
      id: 'core.delete',
      label: t.ctxDelete || 'Удалить',
      icon: 'Trash2',
      group: 'danger',
      order: 40,
      shortcut: 'Del',
      onClick: () => {
        const msg = (t.deleteConfirm || 'Удалить "{name}"?').replace('{name}', target.name);
        if (confirm(msg)) {
          onDeleteItem(target.path, itemRoot);
        }
      },
    });
  }

  // Add plugin items
  const pluginItems = contextMenuRegistry.getItemsForTarget(target);
  return [...coreItems, ...pluginItems];
}
