import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  Check,
  Download,
  Settings as SettingsIcon,
  Search,
  Sun,
  Moon,
  FolderOpen,
  Info,
  LogOut,
  Menu,
  MoreVertical,
} from 'lucide-react';
import { Settings, OpenFile, HeaderItemDef } from '../types';
import { translations, Language } from '../utils/i18n';
import { TreeAsciiIcon, IconButton } from './ui';
import { FileQuickSearch } from './header/FileQuickSearch';

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
  onChangeLanguage?: (lang: Language) => void;
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
  onSave,
  onDownload,
  onOpenSettings,
  onOpenProperties,
  onToggleTheme,
  onChangeLanguage: _onChangeLanguage,
  onLogout,
  onOpenFile,
  onToggleMobileFiles,
  onToggleMobileOutline,
  isMobileOutlineOpen = false,
}) => {
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isMobileMoreMenuOpen, setIsMobileMoreMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640
  );

  const mobileMenuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close mobile more menu on outside click or touch
  useEffect(() => {
    if (!isMobileMoreMenuOpen) return;
    const handleOutside = (e: Event) => {
      const target = e.target as Node;
      if (mobileMenuContainerRef.current && !mobileMenuContainerRef.current.contains(target)) {
        setIsMobileMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isMobileMoreMenuOpen]);

  const t = translations[settings.language] || translations.ru;
  const displayPath = currentFile ? `/${currentFile.path}` : currentDir ? `/${currentDir}` : '/';

  return (
    <header className="relative h-14 bg-base-surface border-b border-base-border px-3 sm:px-4 flex md:grid md:grid-cols-[1fr_auto_1fr] items-center justify-between select-none z-40">
      {/* Left: Branding, path & Mobile Hamburger */}
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

        <div className="hidden sm:flex items-center space-x-2">
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
        <div className="hidden sm:flex items-center text-xs text-gray-500 dark:text-gray-400 font-mono overflow-hidden text-ellipsis whitespace-nowrap max-w-[140px] sm:max-w-[200px] lg:max-w-[320px]">
          <FolderOpen className="w-3.5 h-3.5 mr-1.5 text-accent flex-shrink-0" />
          <span className="text-gray-800 dark:text-gray-300 font-medium truncate">
            {displayPath}
          </span>
        </div>

        {/* Mobile Plugin Header Items */}
        {isMobile && (
          <div className="flex sm:hidden items-center space-x-1.5 min-w-0 cs-header-plugins-mobile">
            {pluginHeaderItems.map((item) => (
              <PluginHeaderItemMount key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Center: FileQuickSearch (Ctrl+P) */}
      <FileQuickSearch
        onOpenFile={onOpenFile}
        t={t}
        isMobileOpen={isMobileSearchOpen}
        onMobileClose={() => setIsMobileSearchOpen(false)}
      />

      {/* Right: Actions */}
      <div className="flex items-center space-x-1 sm:space-x-2 shrink-0 justify-self-end">
        {/* Mobile search trigger icon */}
        <button
          type="button"
          onClick={() => setIsMobileSearchOpen(true)}
          className="md:hidden p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title={t.searchFiles || 'Поиск файлов'}
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Mobile Outline trigger */}
        {onToggleMobileOutline && (
          <button
            onClick={onToggleMobileOutline}
            className={`lg:hidden p-2 rounded-xl transition-colors ${
              isMobileOutlineOpen
                ? 'bg-accent/20 text-accent border border-accent/40 shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title="Структура AST"
          >
            <TreeAsciiIcon size={18} />
          </button>
        )}

        {/* Desktop Plugin Header Items (e.g. Remote Agent Switcher) */}
        {!isMobile && (
          <div className="hidden sm:flex items-center space-x-2">
            {pluginHeaderItems.map((item) => (
              <PluginHeaderItemMount key={item.id} item={item} />
            ))}
          </div>
        )}

        {/* Save button */}
        {(() => {
          const isDirty = Boolean(currentFile?.isDirty);
          return (
            <button
              onClick={() => onSave()}
              disabled={!currentFile || isSaving}
              className={`btn-save-cta flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                isDirty ? 'is-dirty' : 'is-clean'
              }`}
              title={`${t.save} (Ctrl+S)`}
            >
              {isSaving ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : isDirty ? (
                <Save className="w-3.5 h-3.5" />
              ) : (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span className="hidden sm:inline">
                {isSaving ? t.saving : isDirty ? t.save : (t.saved || 'Сохранено')}
              </span>
              {isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping ml-0.5" />
              )}
            </button>
          );
        })()}

        {/* Desktop secondary buttons */}
        <div className="hidden md:flex items-center space-x-1">
          <button
            onClick={onDownload}
            disabled={!currentFile}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-base-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t.download}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.download}</span>
          </button>

          <IconButton
            variant="ghost"
            size="md"
            icon={<Info className="w-4 h-4" />}
            onClick={onOpenProperties}
            disabled={!currentFile}
            title={t.fileProperties || 'Свойства файла'}
          />

          <IconButton
            variant="ghost"
            size="md"
            icon={settings.themeMode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            onClick={onToggleTheme}
            title={`Switch to ${settings.themeMode === 'dark' ? t.themeLight : t.themeDark}`}
          />

          <button
            onClick={onOpenSettings}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-base-border transition-colors cursor-pointer"
            title={t.settings}
          >
            <SettingsIcon className="w-3.5 h-3.5 text-accent" />
            <span className="font-medium">{t.settings}</span>
          </button>

          {onLogout && (
            <IconButton
              variant="danger"
              size="md"
              icon={<LogOut className="w-4 h-4" />}
              onClick={onLogout}
              title={t.signOut || 'Выйти'}
            />
          )}
        </div>

        {/* Mobile More Options Dropdown [⋮] */}
        <div ref={mobileMenuContainerRef} className="relative md:hidden">
          <button
            onClick={() => setIsMobileMoreMenuOpen((prev) => !prev)}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Еще"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {isMobileMoreMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-base-surface border border-base-border rounded-2xl shadow-2xl p-1.5 space-y-0.5 z-50 text-xs animate-in zoom-in-95 duration-100">
              <button
                onClick={() => {
                  setIsMobileMoreMenuOpen(false);
                  onOpenProperties();
                }}
                disabled={!currentFile}
                className="w-full px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-left text-gray-800 dark:text-gray-200 flex items-center space-x-2.5 disabled:opacity-40"
              >
                <Info className="w-4 h-4 text-accent" />
                <span>{t.fileProperties || 'Свойства'}</span>
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
                  <span>{t.signOut || 'Выйти'}</span>
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
