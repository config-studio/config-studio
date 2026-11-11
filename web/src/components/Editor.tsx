import React, { useRef, useEffect, useMemo, useState } from 'react';
import MonacoEditor, { DiffEditor, OnMount } from '@monaco-editor/react';
import { OpenFile, Settings, OutlineNode, ToolbarButtonDef, GuardValidationResult, WorkspaceRoot, FileRevision } from '../types';
import { X, FileCode, Hash, ShieldAlert, ShieldCheck, History, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { translations } from '../utils/i18n';
import { getLuminance } from '../utils/color';
import { pluginManager } from '../services/pluginLoader';
import { ActionToolbar } from './ActionToolbar';
import { ScrollArea, EmptyState, Button, PillTabs, PillTabItem, Dropdown, DropdownOption } from '@config-studio/ui';
import { FileFormatIcon } from './icons/FileFormatIcon';

interface EditorProps {
  tabs: OpenFile[];
  activeFilePath: string | null;
  settings: Settings;
  workspaces?: WorkspaceRoot[];
  outline?: OutlineNode[];
  pluginButtons?: ToolbarButtonDef[];
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onChangeContent: (val: string) => void;
  onSave: () => void;
  onSelectLine?: (line: number, shouldFocus?: boolean) => void;
  onCursorChange?: (line: number, col: number) => void;
  editorRef: React.MutableRefObject<any>;
  guardResult?: GuardValidationResult | null;
  onOpenGuardModal?: () => void;
  isTimeMachineOpen?: boolean;
  onToggleTimeMachine?: (open: boolean) => void;
  onRestoreRevision?: (content: string) => void;
}

export const Editor: React.FC<EditorProps> = ({
  tabs,
  activeFilePath,
  settings,
  workspaces = [],
  outline = [],
  pluginButtons = [],
  guardResult = null,
  onOpenGuardModal,
  isTimeMachineOpen,
  onToggleTimeMachine,
  onRestoreRevision,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onSave,
  onSelectLine,
  onCursorChange,
  editorRef,
}) => {
  const monacoInstanceRef = useRef<any>(null);
  const tagsScrollRef = useRef<HTMLDivElement>(null);
  const [showMobileTags, setShowMobileTags] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [localTimeMachineOpen, setLocalTimeMachineOpen] = useState(false);
  const [selectedRevIndex, setSelectedRevIndex] = useState(0);

  const isTimeMachineActive = isTimeMachineOpen !== undefined ? isTimeMachineOpen : localTimeMachineOpen;
  const setTimeMachineActive = (val: boolean | ((prev: boolean) => boolean)) => {
    if (onToggleTimeMachine) {
      onToggleTimeMachine(typeof val === 'function' ? val(isTimeMachineActive) : val);
    } else {
      setLocalTimeMachineOpen(val);
    }
  };

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const t = translations[settings.language] || translations.ru;

  const insertTextAtCursor = (text: string) => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    const selection = editor.getSelection();
    if (!selection) return;
    editor.executeEdits('mobile-accessory-bar', [
      {
        range: selection,
        text: text,
        forceMoveMarkers: true,
      },
    ]);
    editor.focus();
  };

  const handleMobileTab = () => {
    if (!editorRef.current) return;
    editorRef.current.trigger('mobile-accessory-bar', 'tab', null);
    editorRef.current.focus();
  };

  const getTabKey = (tab: OpenFile) =>
    tab.fullRelPath || (tab.root ? `${tab.root}:${tab.path}` : tab.path);

  const currentFile =
    tabs.find((t) => getTabKey(t) === activeFilePath || t.path === activeFilePath) ||
    null;

  const pillTabItems: PillTabItem[] = useMemo(() => {
    return tabs.map((tab) => {
      const tabKey = getTabKey(tab);
      const hasDuplicateName = tabs.some((t) => t !== tab && t.name === tab.name);
      let locationHint = '';
      if (hasDuplicateName) {
        if (tab.root && workspaces && workspaces.length > 1) {
          const ws = workspaces.find((w) => w.id === tab.root);
          locationHint = ws ? ws.name : tab.root;
        } else if (tab.path.includes('/')) {
          const parts = tab.path.split('/');
          locationHint = parts[parts.length - 2];
        }
      }

      return {
        id: tabKey,
        label: locationHint ? `${tab.name} • ${locationHint}` : tab.name,
        icon: <FileFormatIcon filename={tab.name} className="w-3.5 h-3.5 shrink-0" />,
        badge: tab.badge || (tab.readOnly ? 'RO' : undefined),
        badgeColor: tab.readOnly ? 'amber' : 'accent',
        isDirty: tab.isDirty,
        closable: true,
      };
    });
  }, [tabs, workspaces, activeFilePath]);

  const isLight =
    settings.themeMode === 'light' ||
    getLuminance(settings.baseColor || '#161b22') > 0.55;

  const defineCustomTheme = (monaco: any) => {
    monaco.editor.defineTheme('custom-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'type', foreground: '00d2b4' },
        { token: 'string', foreground: '4ade80' },
        { token: 'number', foreground: 'facc15' },
        { token: 'keyword', foreground: '38bdf8' },
        { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': settings.baseColor || '#161b22',
        'editorLineNumber.foreground': '#4b5563',
        'editorLineNumber.activeForeground': settings.accentColor || '#00d2b4',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#1f242c',
        'editorCursor.foreground': settings.accentColor || '#00d2b4',
      },
    });

    const lightBg =
      getLuminance(settings.baseColor || '') > 0.55
        ? settings.baseColor
        : '#ffffff';

    monaco.editor.defineTheme('custom-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'type', foreground: '0284c7' },
        { token: 'string', foreground: '15803d' },
        { token: 'number', foreground: 'b45309' },
        { token: 'keyword', foreground: '0369a1' },
        { token: 'comment', foreground: '9ca3af', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': lightBg,
        'editorLineNumber.foreground': '#9ca3af',
        'editorLineNumber.activeForeground': settings.accentColor || '#00d2b4',
        'editor.selectionBackground': '#bfdbfe',
        'editorCursor.foreground': settings.accentColor || '#00d2b4',
      },
    });
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoInstanceRef.current = monaco;
    pluginManager.setMonacoInstances(monaco, editor);

    defineCustomTheme(monaco);
    monaco.editor.setTheme(isLight ? 'custom-light' : 'custom-dark');

    // Add Ctrl+S command
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });

    // Listen to cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      if (onCursorChange) {
        onCursorChange(e.position.lineNumber, e.position.column);
      }
    });
  };

  useEffect(() => {
    if (monacoInstanceRef.current && editorRef.current) {
      defineCustomTheme(monacoInstanceRef.current);
      monacoInstanceRef.current.editor.setTheme(
        isLight ? 'custom-light' : 'custom-dark'
      );
    }
  }, [settings.baseColor, settings.accentColor, settings.themeMode, isLight]);

  // Reset selected revision when active file changes
  useEffect(() => {
    setSelectedRevIndex(0);
  }, [activeFilePath]);

  const revisions = currentFile?.revisions || [];
  const selectedRev = revisions[selectedRevIndex] || revisions[0] || null;

  const handleRollback = () => {
    if (!selectedRev || !onRestoreRevision) return;
    onRestoreRevision(selectedRev.content);
    setTimeMachineActive(false);
  };

  const handleDiffMount = (_diffEditor: any, monaco: any) => {
    monacoInstanceRef.current = monaco;
    defineCustomTheme(monaco);
    monaco.editor.setTheme(isLight ? 'custom-light' : 'custom-dark');
  };

  const formatRevOption = (
    rev: FileRevision,
    idx: number,
    total: number,
    lang: string
  ) => {
    const d = new Date(rev.timestamp);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    let relTime = '';
    if (diffSec < 45) {
      relTime = lang === 'ru' ? 'только что' : 'just now';
    } else if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      relTime = lang === 'ru' ? `${mins} мин назад` : `${mins}m ago`;
    } else if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      relTime = lang === 'ru' ? `${hours} ч назад` : `${hours}h ago`;
    } else {
      relTime = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    }

    const deltaStr =
      rev.linesDelta > 0
        ? `+${rev.linesDelta}`
        : rev.linesDelta < 0
        ? `${rev.linesDelta}`
        : '±0';
    const labelPrefix = idx === 0 ? (lang === 'ru' ? '● Последний: ' : '● Latest: ') : `#${total - idx}: `;
    return `${labelPrefix}${relTime} (${timeStr}) • ${deltaStr} стр.`;
  };

  // Extract all root sections for the full-width Quick Jump tag bar
  const rootTags = useMemo(() => {
    if (!outline || outline.length === 0) return [];

    let candidates = outline;
    if (
      candidates.length === 1 &&
      candidates[0].children &&
      candidates[0].children.length > 0
    ) {
      const rootLabel = candidates[0].label || (candidates[0] as any).name || '';
      if (rootLabel.startsWith('<html')) {
        const bodyChild = candidates[0].children.find((c) => {
          const cLabel = c.label || (c as any).name || '';
          return cLabel.startsWith('<body');
        });
        candidates =
          bodyChild && bodyChild.children && bodyChild.children.length > 0
            ? bodyChild.children
            : candidates[0].children;
      } else {
        candidates = candidates[0].children;
      }
    }

    return candidates.slice(0, 35).map((node) => ({
      id: node.id,
      label: node.label || (node as any).name || '',
      line: node.line,
      type: node.type || (node as any).kind || 'section',
    }));
  }, [outline]);

  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'json':
      case 'jsonc':
        return 'json';
      case 'toml':
      case 'ini':
      case 'conf':
      case 'cfg':
      case 'env':
        return 'ini';
      case 'html':
      case 'htm':
        return 'html';
      case 'php':
      case 'phtml':
        return 'php';
      case 'js':
      case 'javascript':
        return 'javascript';
      case 'ts':
      case 'typescript':
        return 'typescript';
      case 'css':
        return 'css';
      case 'sql':
        return 'sql';
      case 'sh':
      case 'bash':
        return 'shell';
      case 'md':
        return 'markdown';
      case 'xml':
        return 'xml';
      default:
        return 'yaml';
    }
  };

  if (tabs.length === 0 || !currentFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-base text-gray-500 select-none">
        <FileCode className="w-16 h-16 mb-3 opacity-30 text-accent" />
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {settings.language === 'ru' ? 'Нет открытых файлов' : 'No files opened'}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {settings.language === 'ru'
            ? 'Выберите файл из проводника слева или перетащите его для редактирования'
            : 'Select a file from the explorer on the left or upload one to edit'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-base">
      {/* Multi-Tab Bar & Action Toolbar (Option 2: PillTabs) */}
      <div className="min-h-11 bg-base-surface border-b border-base-border flex items-center justify-between px-2.5 py-1 select-none flex-shrink-0 gap-3">
        <PillTabs
          items={pillTabItems}
          activeId={activeFilePath || (tabs[0] ? getTabKey(tabs[0]) : '')}
          onChange={(key) => onSelectTab(key)}
          onClose={(key) => onCloseTab(key)}
          variant="files"
          size="sm"
          className="flex-1 min-w-0"
        />

        {/* Right Action Area: Guard Pill & 1-Click Action Toolbar & Mobile Tag Toggle */}
        <div className="flex items-center space-x-1.5 pl-2 shrink-0">
          {/* Mobile Quick Jump Tags Toggle Button */}
          {rootTags.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMobileTags((prev) => !prev)}
              className={`md:hidden flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                showMobileTags
                  ? 'bg-accent/20 text-accent border-accent/40 shadow-xs'
                  : 'text-gray-400 hover:text-white bg-black/10 dark:bg-white/5 border-base-border'
              }`}
              title={t.quickJump || 'Быстрый переход'}
            >
              <Hash className="w-3 h-3 text-accent" />
              <span>{rootTags.length}</span>
            </button>
          )}

          {/* Structure Guard Status Pill */}
          {currentFile && guardResult?.isGuarded && (
            !guardResult.valid && guardResult.issues.length > 0 ? (
              <button
                type="button"
                onClick={onOpenGuardModal}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 transition cursor-pointer"
                title="Обнаружена синтаксическая ошибка! Нажмите, чтобы открыть Pre-Save Guard"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                <span>Deep Guard ({guardResult.issues.length})</span>
              </button>
            ) : (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/30"
                title="Файл защищен: синтаксис проверяется перед сохранением"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
                <span>Deep Guard</span>
              </div>
            )
          )}

          {/* Time Machine Toggle Button (2-Click Law) */}
          {currentFile && (
            <button
              type="button"
              onClick={() => setTimeMachineActive((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors border shrink-0 ${
                isTimeMachineActive
                  ? 'bg-accent/20 text-accent border-accent/40 shadow-xs'
                  : revisions.length > 0
                  ? 'bg-black/10 dark:bg-white/5 border-base-border text-gray-300 hover:text-white hover:border-gray-500'
                  : 'text-gray-400 dark:text-gray-500 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={
                settings.language === 'ru'
                  ? 'Time Machine: История изменений и откат (Alt+H)'
                  : 'Time Machine: Revision History & Rollback (Alt+H)'
              }
            >
              <History className={`w-3.5 h-3.5 ${isTimeMachineActive ? 'text-accent' : 'text-gray-400'}`} />
              <span className="hidden sm:inline">{t.timeMachine || 'История'}</span>
              {revisions.length > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-accent/20 text-accent font-mono font-bold">
                  {revisions.length}
                </span>
              )}
            </button>
          )}

          {/* 1-Click Action Toolbar (Split Buttons & Direct Actions) */}
          <ActionToolbar
            buttons={pluginButtons}
            currentFile={currentFile}
            accentColor={settings.accentColor}
          />
        </div>
      </div>

      {/* Time Machine Control Bar (2-Click Law) */}
      {isTimeMachineActive && (
        <div className="min-h-[44px] bg-base-surface/95 backdrop-blur-md border-b border-accent/30 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs select-none shrink-0 z-10">
          {/* Left: Time Machine badge & revision stepper */}
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center space-x-1.5 text-accent font-semibold shrink-0">
              <History className="w-4 h-4" />
              <span className="hidden xs:inline">Time Machine</span>
            </div>

            {revisions.length > 0 ? (
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedRevIndex((idx) => Math.min(revisions.length - 1, idx + 1))}
                  disabled={selectedRevIndex >= revisions.length - 1}
                  className="p-1 rounded-lg border border-base-border bg-black/10 dark:bg-white/5 hover:bg-black/20 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 transition"
                  title={t.revisionOlder || 'Старее'}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <Dropdown
                  value={selectedRevIndex}
                  onChange={(val) => setSelectedRevIndex(Number(val))}
                  options={revisions.map((rev, idx) => ({
                    value: idx,
                    label: formatRevOption(rev, idx, revisions.length, settings.language),
                    badge: idx === 0 ? (settings.language === 'ru' ? 'Текущая' : 'Current') : undefined,
                    badgeColor: 'green',
                  }))}
                  size="sm"
                  className="w-48 sm:w-64 font-mono text-xs"
                />

                <button
                  type="button"
                  onClick={() => setSelectedRevIndex((idx) => Math.max(0, idx - 1))}
                  disabled={selectedRevIndex <= 0}
                  className="p-1 rounded-lg border border-base-border bg-black/10 dark:bg-white/5 hover:bg-black/20 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 transition"
                  title={t.revisionNewer || 'Новее'}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-gray-400 text-xs italic">
                {t.noRevisionsYet || 'Снимков истории пока нет'}
              </span>
            )}
          </div>

          {/* Right: Rollback action & Close */}
          <div className="flex items-center space-x-2 shrink-0">
            {revisions.length > 0 && selectedRev && (
              <button
                type="button"
                onClick={handleRollback}
                className="flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90 active:scale-95 transition shadow-xs cursor-pointer"
                title={t.rollbackToRevision || 'Откатить к этой версии'}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t.rollbackToRevision || 'Откатить к этой версии'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setTimeMachineActive(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/10 dark:hover:bg-white/10 transition"
              title="Закрыть Time Machine"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Editor Body: Either Monaco Diff Viewer or Standard Monaco Editor */}
      {isTimeMachineActive ? (
        revisions.length > 0 && selectedRev ? (
          <div className="flex-1 w-full min-h-0 overflow-hidden relative flex flex-col">
            {/* Diff header indicator */}
            <div className="h-6 bg-base-surface/80 border-b border-base-border text-[11px] font-mono flex items-center justify-between px-3 text-gray-400 select-none shrink-0">
              <span className="flex items-center space-x-1 text-rose-400">
                <span>◀ {settings.language === 'ru' ? 'Снимок из истории' : 'Historical Snapshot'} ({new Date(selectedRev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>
              </span>
              <span className="flex items-center space-x-1 text-emerald-400">
                <span>{settings.language === 'ru' ? 'Текущий файл в редакторе' : 'Current File in Editor'} ▶</span>
              </span>
            </div>
            <div className="flex-1 w-full min-h-0">
              <DiffEditor
                height="100%"
                language={getLanguage(currentFile.name)}
                original={selectedRev.content}
                modified={currentFile.content}
                theme={settings.themeMode === 'dark' ? 'custom-dark' : 'custom-light'}
                onMount={handleDiffMount}
                options={{
                  readOnly: true,
                  renderSideBySide: !isMobile,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  lineNumbersMinChars: isMobile ? 2 : 3,
                  renderWhitespace: 'selection',
                  smoothScrolling: true,
                  originalEditable: false,
                }}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<History className="w-12 h-12 text-accent/40" />}
            title={settings.language === 'ru' ? 'Нет сохраненных снимков истории' : 'No revisions recorded yet'}
            description={
              settings.language === 'ru'
                ? 'Time Machine автоматически создает снимки при каждом сохранении файла (Ctrl+S). Сохраните файл, чтобы начать вести историю.'
                : 'Time Machine automatically saves snapshots whenever you save this file (Ctrl+S). Save the file to start recording history.'
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTimeMachineActive(false)}
              >
                {settings.language === 'ru' ? 'Вернуться к редактору' : 'Return to Editor'}
              </Button>
            }
            bordered={false}
            className="flex-1 my-auto"
          />
        )
      ) : (
        <>
          {/* Quick Jump Root Tag Cloud placed under the tabs */}
          {rootTags.length > 0 && (
            <div
              className={`${
                showMobileTags ? 'flex' : 'hidden md:flex'
              } min-h-[42px] bg-base-surface/90 backdrop-blur-xs border-b border-base-border items-center px-3 space-x-2 select-none flex-shrink-0 transition-all`}
            >
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0 mr-1">
                <Hash className="w-3.5 h-3.5 text-accent" />
                <span className="hidden sm:inline">{t.quickJump}</span>
              </div>
              <ScrollArea
                ref={tagsScrollRef}
                orientation="horizontal"
                className="flex-1 min-w-0 py-1.5"
                contentClassName="flex items-center space-x-1.5 w-max"
              >
                {rootTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      if (onSelectLine) onSelectLine(tag.line, true);
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs font-mono whitespace-nowrap bg-white/90 dark:bg-white/5 border border-base-border hover:border-accent hover:text-accent text-gray-700 dark:text-gray-300 transition-all shadow-2xs active:scale-95 flex-shrink-0 flex items-center space-x-1.5"
                    title={`Строка ${tag.line}`}
                  >
                    <span>{tag.label}</span>
                    <span className="text-[10px] text-gray-400 font-sans">:{tag.line}</span>
                  </button>
                ))}
              </ScrollArea>
              {/* Mobile close button for tags panel */}
              <button
                onClick={() => setShowMobileTags(false)}
                className="md:hidden p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 shrink-0"
                title="Скрыть теги"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Monaco Code Editor */}
          <div className="flex-1 w-full min-h-0 overflow-hidden">
            <MonacoEditor
              height="100%"
              language={getLanguage(currentFile.name)}
              value={currentFile.content}
              theme={settings.themeMode === 'dark' ? 'custom-dark' : 'custom-light'}
              onMount={handleEditorMount}
              onChange={(value) => onChangeContent(value || '')}
              options={{
                readOnly: currentFile.readOnly || false,
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: !isMobile, scale: 1 },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                tabSize: 2,
                lineNumbersMinChars: isMobile ? 2 : 3,
                glyphMargin: !isMobile,
                folding: !isMobile,
                renderWhitespace: 'selection',
                smoothScrolling: true,
                cursorBlinking: 'smooth',
              }}
            />
          </div>

          {/* Mobile Developer Accessory Bar (touch keys for config editing) */}
          <div className="md:hidden flex items-center gap-1.5 px-2 py-1.5 min-h-[40px] bg-base-surface border-t border-base-border overflow-x-auto select-none shrink-0 z-20 custom-scrollbar">
            <button
              type="button"
              onClick={handleMobileTab}
              className="px-2.5 py-1 text-xs font-mono font-semibold bg-white/10 hover:bg-white/20 active:scale-95 rounded-lg text-gray-200 border border-base-border shadow-xs shrink-0"
              title="Табуляция (2 пробела)"
            >
              Tab
            </button>
            {[':', '"', "'", '{', '}', '[', ']', '=', '-', '/', '#'].map((char) => (
              <button
                key={char}
                type="button"
                onClick={() => insertTextAtCursor(char)}
                className="w-7 h-7 flex items-center justify-center text-xs font-mono font-bold bg-white/10 hover:bg-white/20 active:scale-95 rounded-lg text-gray-200 border border-base-border shadow-xs shrink-0"
              >
                {char}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
