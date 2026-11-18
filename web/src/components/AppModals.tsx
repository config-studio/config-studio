import React from 'react';
import { SettingsModal } from './SettingsModal';
import { FilePropertiesModal } from './FilePropertiesModal';
import { CommandConfirmModal } from './CommandConfirmModal';
import { PreSaveGuardModal } from './PreSaveGuardModal';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { Settings, OpenFile, GuardIssue, WorkspaceRoot, SSHHost } from '../types';
import { SettingsTab } from './settings/types';

interface AppModalsProps {
  settings: Settings;
  currentFile: OpenFile | null;
  isSaving: boolean;
  // Settings modal
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  settingsTab: SettingsTab;
  onSaveSettings: (settings: Partial<Settings>) => Promise<void>;
  onReloadSettings: () => Promise<void>;
  onReloadPlugins: () => Promise<void>;
  onUploadIcon: (file: File) => Promise<void>;
  onOpenTerminal: (host: SSHHost) => void;
  // File properties
  isPropertiesOpen: boolean;
  setIsPropertiesOpen: (open: boolean) => void;
  onRestoreRevision: (content: string) => void;
  onOpenTimeMachine: () => void;
  // Command confirmation
  pendingConfirm: { command: string; resolve: (ok: boolean) => void } | null;
  setPendingConfirm: (confirm: { command: string; resolve: (ok: boolean) => void } | null) => void;
  // Pre-save guard
  isPreSaveGuardOpen: boolean;
  preSaveGuardIssue: GuardIssue | null;
  onCloseGuardModal: (targetLine?: number, targetCol?: number) => void;
  onForceSave: () => void;
  // Add/Edit workspace
  isAddWorkspaceOpen: boolean;
  setIsAddWorkspaceOpen: (open: boolean) => void;
  editingWorkspace: WorkspaceRoot | null;
  setEditingWorkspace: (ws: WorkspaceRoot | null) => void;
  onSaveWorkspace: (rootData: Partial<WorkspaceRoot>) => Promise<void>;
}

export const AppModals: React.FC<AppModalsProps> = ({
  settings,
  currentFile,
  isSaving,
  isSettingsOpen,
  setIsSettingsOpen,
  settingsTab,
  onSaveSettings,
  onReloadSettings,
  onReloadPlugins,
  onUploadIcon,
  onOpenTerminal,
  isPropertiesOpen,
  setIsPropertiesOpen,
  onRestoreRevision,
  onOpenTimeMachine,
  pendingConfirm,
  setPendingConfirm,
  isPreSaveGuardOpen,
  preSaveGuardIssue,
  onCloseGuardModal,
  onForceSave,
  isAddWorkspaceOpen,
  setIsAddWorkspaceOpen,
  editingWorkspace,
  setEditingWorkspace,
  onSaveWorkspace,
}) => {
  return (
    <>
      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={onSaveSettings}
        onReloadSettings={onReloadSettings}
        onReloadPlugins={onReloadPlugins}
        onUploadIcon={onUploadIcon}
        initialTab={settingsTab}
        onOpenTerminal={onOpenTerminal}
      />

      {/* File Properties & History Modal */}
      <FilePropertiesModal
        isOpen={isPropertiesOpen}
        onClose={() => setIsPropertiesOpen(false)}
        file={currentFile}
        settings={settings}
        onRestoreRevision={onRestoreRevision}
        onOpenTimeMachine={onOpenTimeMachine}
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
        onClose={onCloseGuardModal}
        onForceSave={onForceSave}
      />

      {/* Add / Edit Workspace Modal */}
      <AddWorkspaceModal
        isOpen={isAddWorkspaceOpen}
        onClose={() => {
          setIsAddWorkspaceOpen(false);
          setEditingWorkspace(null);
        }}
        onSave={onSaveWorkspace}
        editingWorkspace={editingWorkspace}
        settings={settings}
      />
    </>
  );
};
