import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  Download,
  Settings as SettingsIcon,
  Search,
  Sun,
  Moon,
  FolderOpen,
  Info,
  LogOut,
  Globe,
  FileCode,
  Folder,
  X,
  CornerDownLeft,
  Loader2,
  Package,
  Menu,
  MoreVertical,
} from 'lucide-react';
import { Settings, OpenFile, FileItem, HeaderItemDef } from '../types';
import { translations, Language, getAvailableLanguages, subscribeLanguages, LanguageMeta } from '../utils/i18n';
import { api } from '../services/api';
import { formatBytes } from '../utils/color';
import { TreeAsciiIcon } from './ui';
import { FileFormatIcon } from './icons/FileFormatIcon';

interface HeaderProps {
  settings: Settings;
  currentFile: OpenFile | null;
  currentDir: string;
  isSaving: boolean;
  pluginHeaderItems?: HeaderItemDef[];
  activePluginsCount?: number;
  onSave: () => void;
  onDownload: () => void;
  onOpenSettings: () => void;
  onOpenPlugins?: () => void;
  onOpenProperties: () => void;
  onToggleTheme: () => void;
  onChangeLanguage: (lang: Language) => void;
  onLogout?: () => void;
  onOpenFile: (path: string) => void;
  onNavigateDir: (path: string) => void;
  onToggleMobileFiles?: () => void;
  onToggleMobileOutline?: () => void;
  isMobileOutlineOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  currentFile,
  currentDir,
  isSaving,
  pluginHeaderItems = [],
  activePluginsCount = 0,
  onSave,
  onDownload,
  onOpenSettings,
  onOpenPlugins,
  onOpenProperties,
  onToggleTheme,
  onChangeLanguage,
  onLogout,
  onOpenFile,
  onNavigateDir,
  onToggleMobileFiles,
  onToggleMobileOutline,
  isMobileOutlineOpen = false,
}) => {
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isMobileMoreMenuOpen, setIsMobileMoreMenuOpen] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<LanguageMeta[]>(getAvailableLanguages());

  useEffect(() => {
    return subscribeLanguages(() => {
      setAvailableLanguages(getAvailableLanguages());
    });
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const mobileSearchContainerRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  // Close mobile more menu on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setIsMobileMoreMenuOpen(false);
      }
    };
    if (isMobileMoreMenuOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isMobileMoreMenuOpen]);

  const t = translations[settings.language] || translations.ru;

  const displayPath = currentFile
    ? `/${currentFile.path}`
    : currentDir
    ? `/${currentDir}`
    : '/';

  // Global Ctrl+P / Cmd+P shortcut to focus file search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (window.innerWidth < 768) {
          setIsMobileSearchOpen(true);
          setIsSearchOpen(true);
          setTimeout(() => {
            mobileInputRef.current?.focus();
            mobileInputRef.current?.select();
          }, 50);
        } else {
          inputRef.current?.focus();
          inputRef.current?.select();
          setIsSearchOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isSearchTrigger = (target as Element)?.closest?.('[data-mobile-search-trigger]');
      if (isSearchTrigger) return;

      const clickedInsideDesktop = searchContainerRef.current?.contains(target);
      const clickedInsideMobile = mobileSearchContainerRef.current?.contains(target);
      if (!clickedInsideDesktop && !clickedInsideMobile) {
        setIsSearchOpen(false);
        setIsMobileSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch search results when opened or query changes
  useEffect(() => {
    if (!isSearchOpen) return;

    let active = true;
    setIsLoading(true);

    const timer = setTimeout(() => {
      api
        .searchFiles(fileSearchQuery)
        .then((items) => {
          if (active) {
            setSearchResults(items);
            setSelectedIndex(0);
          }
        })
        .catch(() => {
          if (active) setSearchResults([]);
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fileSearchQuery, isSearchOpen]);

  const handleSelectFile = (item: FileItem) => {
    if (item.isDir) {
      onNavigateDir(item.path);
    } else {
      onOpenFile(item.path);
    }
    setIsSearchOpen(false);
    setIsMobileSearchOpen(false);
    setFileSearchQuery('');
    inputRef.current?.blur();
    mobileInputRef.current?.blur();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % searchResults.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedIndex(
          (prev) => (prev - 1 + searchResults.length) % searchResults.length
        );
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults.length > 0 && searchResults[selectedIndex]) {
        handleSelectFile(searchResults[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsSearchOpen(false);
      setIsMobileSearchOpen(false);
      inputRef.current?.blur();
      mobileInputRef.current?.blur();
    }
  };

  const getFileBadge = (item: FileItem) => {
    if (item.isDir) {
      return (
        <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          DIR
        </span>
      );
    }
    const ext = item.extension.replace('.', '').toUpperCase();
    switch (ext) {
      case 'YAML':
      case 'YML':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
            YAML
          </span>
        );
      case 'JSON':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            JSON
          </span>
        );
      case 'TOML':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30">
            TOML
          </span>
        );
      case 'INI':
      case 'CONF':
      case 'ENV':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            INI
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-gray-500/15 text-gray-600 dark:text-gray-400 border border-gray-500/30">
            {ext || 'FILE'}
          </span>
        );
    }
  };

  const renderSearchResults = (isMobile: boolean) => (
    <div
      className={`absolute ${
        isMobile ? 'top-full left-2 right-2 mt-1.5' : 'top-full left-0 right-0 mt-2'
      } bg-base-surface border border-base-border rounded-2xl shadow-2xl overflow-hidden z-50 animate-fade-in text-gray-800 dark:text-gray-200`}
    >
      {/* Header info */}
      <div className="px-3 py-2 border-b border-base-border bg-gray-50/50 dark:bg-black/20 flex items-center justify-between text-[11px] text-gray-400">
        <span className="font-semibold uppercase tracking-wider text-[10px]">
          {isLoading ? (
            <span className="flex items-center space-x-1 text-accent">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Поиск файлов...</span>
            </span>
          ) : (
            <span>
              {searchResults.length} {searchResults.length === 1 ? 'файл' : 'файлов'}
            </span>
          )}
        </span>
        {!isMobile && (
          <div className="flex items-center space-x-2 text-[10px]">
            <span>↑↓ навигация</span>
            <span>↵ открыть</span>
            <span>Esc закрыть</span>
          </div>
        )}
      </div>

      {/* Results List */}
      <div className={`${isMobile ? 'max-h-[60vh]' : 'max-h-80'} overflow-y-auto p-1.5 space-y-0.5`}>
        {isLoading && searchResults.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400 flex items-center justify-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            <span>Поиск файлов...</span>
          </div>
        ) : searchResults.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">
            <FileCode className="w-8 h-8 mx-auto mb-1.5 opacity-30 text-accent" />
            {t.noFilesFound}
          </div>
        ) : (
          searchResults.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={item.path}
                onClick={() => handleSelectFile(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-accent/15 text-gray-900 dark:text-white font-medium border border-accent ring-1 ring-accent/30'
                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2.5 truncate min-w-0 pr-2">
                  <FileFormatIcon filename={item.name} isDir={item.isDir} className="w-4 h-4 shrink-0" />

                  <div className="truncate">
                    <span className="font-semibold text-gray-900 dark:text-white block truncate">
                      {item.name}
                    </span>
                    <span className="text-[11px] text-gray-400 font-mono block truncate">
                      /{item.path}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                  {!item.isDir && (
                    <span className="text-[10px] text-gray-400 font-mono hidden sm:inline">
                      {formatBytes(item.size)}
                    </span>
                  )}
                  {getFileBadge(item)}
                  <CornerDownLeft
                    className={`w-3.5 h-3.5 text-accent transition-opacity ${
                      isSelected ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <header className="relative h-14 bg-base-surface border-b border-base-border px-3 sm:px-4 flex md:grid md:grid-cols-[1fr_auto_1fr] items-center justify-between select-none z-30">
      {/* Mobile Search Overlay Bar */}
      {isMobileSearchOpen && (
        <div
          ref={mobileSearchContainerRef}
          className="md:hidden absolute inset-0 z-50 bg-base-surface flex items-center px-3 space-x-2 border-b border-base-border shadow-lg"
        >
          <Search className="w-4 h-4 text-accent shrink-0" />
          <input
            ref={mobileInputRef}
            type="text"
            placeholder={t.searchFiles}
            value={fileSearchQuery}
            autoFocus
            onChange={(e) => {
              setFileSearchQuery(e.target.value);
              setIsSearchOpen(true);
            }}
            onKeyDown={handleInputKeyDown}
            className="flex-1 min-w-0 bg-gray-100 dark:bg-black/25 text-gray-900 dark:text-gray-200 text-xs sm:text-sm rounded-xl px-3 py-1.5 border border-base-border focus:outline-none focus:border-accent transition-colors"
          />

          {fileSearchQuery && (
            <button
              type="button"
              onClick={() => {
                setFileSearchQuery('');
                mobileInputRef.current?.focus();
              }}
              className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white shrink-0"
              title="Очистить"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsMobileSearchOpen(false);
              setIsSearchOpen(false);
              setFileSearchQuery('');
            }}
            className="p-1.5 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
            title="Закрыть поиск"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Floating File Search Results Dropdown for Mobile */}
          {isSearchOpen && renderSearchResults(true)}
        </div>
      )}
      {/* Left: Mobile Hamburger, Branding & Path */}
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 justify-self-start">
        {onToggleMobileFiles && (
          <button
            type="button"
            onClick={onToggleMobileFiles}
            className="md:hidden p-1.5 -ml-1 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Проводник файлов"
          >
            <Menu className="w-5 h-5 text-accent" />
          </button>
        )}

        <div className="flex items-center space-x-2">
          {settings.hasCustomIcon ? (
            <img
              src={`/api/branding/icon?t=${Date.now()}`}
              alt="Logo"
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-contain bg-black/10 dark:bg-black/30 p-1 border border-base-border"
            />
          ) : (
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center font-bold text-xs sm:text-sm shadow-md text-slate-900 shrink-0"
              style={{ backgroundColor: settings.accentColor }}
            >
              {(settings.appTitle || 'CS').substring(0, 2).toUpperCase()}
            </div>
          )}
          <span className="font-semibold text-sm sm:text-base tracking-tight text-gray-900 dark:text-white whitespace-nowrap hidden sm:inline">
            {settings.appTitle}
          </span>
        </div>

        <div className="h-4 w-px bg-gray-300 dark:bg-white/20 mx-1 hidden sm:block" />

        {/* Breadcrumb Path */}
        <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 font-mono overflow-hidden text-ellipsis whitespace-nowrap max-w-[140px] sm:max-w-[200px] lg:max-w-[320px]">
          <FolderOpen className="w-3.5 h-3.5 mr-1.5 text-accent flex-shrink-0" />
          <span className="text-gray-800 dark:text-gray-300 font-medium truncate">
            {displayPath}
          </span>
        </div>
      </div>

      {/* Center: Quick File Search with Autocomplete Dropdown - STRICTLY CENTERED (UI-001) */}
      <div
        ref={searchContainerRef}
        className="hidden md:flex items-center justify-self-center relative w-72 lg:w-96 mx-4"
      >
        <Search className="w-4 h-4 absolute left-3 text-gray-400 pointer-events-none z-10" />
        <input
          ref={inputRef}
          type="text"
          placeholder={t.searchFiles}
          value={fileSearchQuery}
          onFocus={() => setIsSearchOpen(true)}
          onChange={(e) => {
            setFileSearchQuery(e.target.value);
            setIsSearchOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          className="w-full bg-gray-100 dark:bg-black/25 text-gray-900 dark:text-gray-200 text-xs rounded-xl pl-9 pr-16 py-1.5 border border-base-border focus:outline-none focus:border-accent transition-colors"
        />

        {/* Right shortcut tag */}
        <div className="absolute right-2.5 flex items-center space-x-1.5">
          {fileSearchQuery ? (
            <button
              onClick={() => {
                setFileSearchQuery('');
                inputRef.current?.focus();
              }}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[9px] font-mono text-gray-400 bg-black/5 dark:bg-white/10 rounded border border-base-border pointer-events-none">
              Ctrl+P
            </kbd>
          )}
        </div>

        {/* Floating File Search Results Dropdown */}
        {isSearchOpen && renderSearchResults(false)}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center space-x-1 sm:space-x-2 shrink-0 justify-self-end">
        {/* Mobile search trigger icon */}
        <button
          type="button"
          data-mobile-search-trigger
          onClick={() => {
            setIsMobileSearchOpen(true);
            setIsSearchOpen(true);
            setTimeout(() => {
              mobileInputRef.current?.focus();
              mobileInputRef.current?.select();
            }, 50);
          }}
          className="md:hidden p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title={t.searchFiles}
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Mobile / Tablet Structure Outline Drawer Trigger with TreeAsciiIcon */}
        {onToggleMobileOutline && (
          <button
            onClick={onToggleMobileOutline}
            className={`lg:hidden p-2 rounded-xl transition-colors ${
              isMobileOutlineOpen
                ? 'bg-accent/20 text-accent border border-accent/40 shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title="Структура AST (Дерево тегов)"
          >
            <TreeAsciiIcon size={18} />
          </button>
        )}

        {/* Plugin Header Items (e.g. Remote Agent Switcher) */}
        <div className="hidden sm:flex items-center space-x-2">
          {pluginHeaderItems.map((item) => (
            <PluginHeaderItemMount key={item.id} item={item} />
          ))}
        </div>

        {/* Save button (always visible) */}
        <button
          onClick={() => onSave()}
          disabled={!currentFile || isSaving}
          className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-900 transition-all duration-150 shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: settings.accentColor }}
          title={`${t.save} (Ctrl+S)`}
        >
          {isSaving ? (
            <div className="w-3.5 h-3.5 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">{isSaving ? t.saving : t.save}</span>
          {currentFile?.isDirty && (
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse ml-0.5" />
          )}
        </button>

        {/* Desktop-only secondary buttons */}
        <div className="hidden md:flex items-center space-x-1">
          {/* Download button */}
          <button
            onClick={onDownload}
            disabled={!currentFile}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-base-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t.download}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.download}</span>
          </button>

          {/* File info / hash / history button */}
          <button
            onClick={onOpenProperties}
            disabled={!currentFile}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-30"
            title={t.fileProperties}
          >
            <Info className="w-4 h-4" />
          </button>

          {/* Language switch */}
          {availableLanguages.length > 1 && (
            <button
              onClick={() => {
                const currentIdx = availableLanguages.findIndex((l) => l.code === settings.language);
                const nextLang = availableLanguages[(currentIdx + 1) % availableLanguages.length];
                onChangeLanguage(nextLang.code);
              }}
              className="px-2 py-1 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors flex items-center space-x-1"
              title={t.language}
            >
              <Globe className="w-3.5 h-3.5 text-accent" />
              <span>{(settings.language || 'RU').toUpperCase()}</span>
            </button>
          )}

          {/* Theme mode toggle */}
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title={`Switch to ${settings.themeMode === 'dark' ? t.themeLight : t.themeDark}`}
          >
            {settings.themeMode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Plugins quick toggle button */}
          {onOpenPlugins && (
            <button
              onClick={onOpenPlugins}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-base-border transition-colors cursor-pointer"
              title={`${t.tabPlugins} (${activePluginsCount} ${t.headerPluginsActive || 'active'})`}
            >
              <Package className="w-3.5 h-3.5 text-accent" />
              <span className="hidden lg:inline font-medium">{t.tabPlugins}</span>
              {activePluginsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
                  {activePluginsCount}
                </span>
              )}
            </button>
          )}

          {/* Settings button */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title={t.settings}
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          {/* Logout button if auth enabled */}
          {onLogout && (
            <button
              onClick={onLogout}
              className="p-2 rounded-xl text-gray-500 hover:text-rose-500 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title={t.signOut}
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Mobile More Options Dropdown [⋮] */}
        <div className="relative md:hidden">
          <button
            onClick={() => setIsMobileMoreMenuOpen((prev) => !prev)}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Еще"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {isMobileMoreMenuOpen && (
            <div
              ref={mobileMenuRef}
              className="absolute right-0 top-full mt-2 w-52 bg-base-surface border border-base-border rounded-2xl shadow-2xl p-1.5 space-y-0.5 z-50 text-xs animate-in zoom-in-95 duration-100"
            >
              <button
                onClick={() => {
                  setIsMobileMoreMenuOpen(false);
                  onOpenProperties();
                }}
                disabled={!currentFile}
                className="w-full px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-left text-gray-800 dark:text-gray-200 flex items-center space-x-2.5 disabled:opacity-40"
              >
                <Info className="w-4 h-4 text-accent" />
                <span>{t.fileProperties}</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMoreMenuOpen(false);
                  onToggleTheme();
                }}
                className="w-full px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-left text-gray-800 dark:text-gray-200 flex items-center space-x-2.5"
              >
                {settings.themeMode === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-purple-400" />
                )}
                <span>{settings.themeMode === 'dark' ? t.themeLight : t.themeDark}</span>
              </button>

              {availableLanguages.length > 1 && (
                <button
                  onClick={() => {
                    const currentIdx = availableLanguages.findIndex((l) => l.code === settings.language);
                    const nextLang = availableLanguages[(currentIdx + 1) % availableLanguages.length];
                    onChangeLanguage(nextLang.code);
                    setIsMobileMoreMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-left text-gray-800 dark:text-gray-200 flex items-center space-x-2.5"
                >
                  <Globe className="w-3.5 h-3.5 text-accent" />
                  <span>{t.language}: {(settings.language || 'RU').toUpperCase()}</span>
                </button>
              )}

              {onOpenPlugins && (
                <button
                  onClick={() => {
                    setIsMobileMoreMenuOpen(false);
                    onOpenPlugins();
                  }}
                  className="w-full px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-left text-gray-800 dark:text-gray-200 flex items-center space-x-2.5"
                >
                  <Package className="w-3.5 h-3.5 text-accent" />
                  <span>{t.tabPlugins} ({activePluginsCount})</span>
                </button>
              )}

              <div className="h-px bg-base-border my-1" />

              <button
                onClick={() => {
                  setIsMobileMoreMenuOpen(false);
                  onOpenSettings();
                }}
                className="w-full px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-left text-gray-800 dark:text-gray-200 flex items-center space-x-2.5"
              >
                <SettingsIcon className="w-4 h-4 text-accent" />
                <span>{t.settings}</span>
              </button>

              {onLogout && (
                <button
                  onClick={() => {
                    setIsMobileMoreMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full px-3 py-2 rounded-xl hover:bg-rose-500/10 text-left text-rose-500 flex items-center space-x-2.5"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t.signOut}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

const PluginHeaderItemMount: React.FC<{ item: HeaderItemDef }> = ({ item }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mountRef.current) {
      try {
        item.render(mountRef.current);
      } catch (err) {
        console.error('[PluginHeader] Error rendering header item:', item.id, err);
      }
    }
  }, [item]);

  return <div id={`cs-header-item-${item.id}`} data-plugin-id={item.pluginId} ref={mountRef} className="flex items-center" />;
};

