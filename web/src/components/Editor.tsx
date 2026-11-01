import React, { useRef, useEffect, useMemo } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import { OpenFile, Settings, OutlineNode, ToolbarButtonDef, GuardValidationResult, WorkspaceRoot } from '../types';
import { X, FileCode, Hash, ShieldAlert, ShieldCheck } from 'lucide-react';
import { translations } from '../utils/i18n';
import { getLuminance } from '../utils/color';
import { pluginManager } from '../services/pluginLoader';
import { ActionToolbar } from './ActionToolbar';

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

  const handleTagsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (tagsScrollRef.current && e.deltaY !== 0) {
      tagsScrollRef.current.scrollLeft += e.deltaY;
    }
  };

  const getTabKey = (tab: OpenFile) =>
    tab.fullRelPath || (tab.root ? `${tab.root}:${tab.path}` : tab.path);

  const currentFile =
    tabs.find((t) => getTabKey(t) === activeFilePath || t.path === activeFilePath) ||
    null;

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
      {/* Multi-Tab Bar & Action Toolbar */}
      <div className="h-10 bg-base-surface border-b border-base-border flex items-center justify-between px-2 select-none flex-shrink-0">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {tabs.map((tab) => {
            const tabKey = getTabKey(tab);
            const isActive = tabKey === activeFilePath || tab.path === activeFilePath;

            // If another open tab has the same filename, show location hint
            const hasDuplicateName = tabs.some(
              (t) => t !== tab && t.name === tab.name
            );
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

            return (
              <div
                key={tabKey}
                onClick={() => onSelectTab(tabKey)}
                className={`group flex items-center space-x-2 px-3 py-1.5 rounded-t-lg text-xs font-medium cursor-pointer transition-all border-b-2 max-w-[220px] ${
                  isActive
                    ? 'bg-base text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 border-transparent'
                }`}
                style={{
                  borderBottomColor: isActive ? settings.accentColor : 'transparent',
                }}
              >
                <span className="truncate">{tab.name}</span>
                {locationHint && (
                  <span
                    className="text-[10px] opacity-60 font-mono truncate max-w-[80px] shrink-0"
                    title={`Расположение: ${tab.root ? tab.root + '/' : ''}${tab.path}`}
                  >
                    • {locationHint}
                  </span>
                )}
                {tab.badge && (
                  <span
                    className="px-1 text-[9px] font-mono uppercase bg-accent/15 text-accent border border-accent/30 rounded shrink-0"
                    title={tab.badge}
                  >
                    {tab.badge}
                  </span>
                )}
                {tab.readOnly && (
                  <span
                    className="px-1 text-[9px] font-mono uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded shrink-0"
                    title="Только для чтения (Read-Only)"
                  >
                    RO
                  </span>
                )}
                {tab.isDirty && (
                  <span
                    className="w-2 h-2 rounded-full inline-block animate-pulse flex-shrink-0"
                    style={{ backgroundColor: settings.accentColor }}
                    title="Несохраненные изменения"
                  />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tabKey);
                  }}
                  className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/20 text-gray-400 hover:text-gray-900 dark:hover:text-white flex-shrink-0"
                  title="Закрыть вкладку"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

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

          {/* 1-Click Action Toolbar (Split Buttons & Direct Actions) */}
          <ActionToolbar
            buttons={pluginButtons}
            currentFile={currentFile}
            accentColor={settings.accentColor}
          />
        </div>
      </div>

      {/* Quick Jump Root Tag Cloud placed under the tabs */}
      {rootTags.length > 0 && (
        <div
          onWheel={handleTagsWheel}
          className={`${
            showMobileTags ? 'flex' : 'hidden md:flex'
          } min-h-[42px] bg-base-surface/90 backdrop-blur-xs border-b border-base-border items-center px-3 space-x-2 select-none flex-shrink-0 transition-all`}
        >
          <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0 mr-1">
            <Hash className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">{t.quickJump}</span>
          </div>
          <div
            ref={tagsScrollRef}
            className="flex-1 flex items-center space-x-1.5 overflow-x-auto py-1.5 custom-scrollbar"
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
          </div>
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
    </div>
  );
};
