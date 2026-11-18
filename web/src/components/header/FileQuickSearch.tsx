import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, FileCode, Folder } from 'lucide-react';
import { FileItem, WorkspaceRoot } from '../../types';
import { api } from '../../services/api';
import { formatBytes } from '../../services/sysinfo';
import { FileFormatIcon } from '../icons/FileFormatIcon';

export interface FileQuickSearchProps {
  onOpenFile: (path: string, rootId?: string) => void;
  workspaces?: WorkspaceRoot[];
  t: Record<string, string>;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export const FileQuickSearch: React.FC<FileQuickSearchProps> = ({
  onOpenFile,
  workspaces = [],
  t,
  isMobileOpen = false,
  onMobileClose,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<FileItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl+P / Cmd+P shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 50);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search debouncing
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const items = await api.searchFiles(query.trim());
        setResults(items || []);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Failed to search files:', err);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelectFile = (item: FileItem) => {
    if (item.isDir) return;
    onOpenFile(item.path, (item as any).root);
    setIsOpen(false);
    onMobileClose?.();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelectFile(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      onMobileClose?.();
    }
  };

  const renderDropdown = (isMobile: boolean) => (
    <div
      className={`absolute ${
        isMobile ? 'top-full left-2 right-2 mt-1.5' : 'top-full left-0 right-0 mt-2'
      } bg-base-surface border border-base-border rounded-2xl shadow-2xl overflow-hidden z-50 text-gray-800 dark:text-gray-200 animate-in fade-in zoom-in-95 duration-75`}
    >
      <div className="px-3 py-2 border-b border-base-border bg-gray-50/50 dark:bg-black/20 flex items-center justify-between text-[11px] text-gray-400">
        <span className="font-semibold uppercase tracking-wider text-[10px]">
          {isLoading ? (
            <span className="flex items-center space-x-1 text-accent">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Поиск файлов...</span>
            </span>
          ) : (
            <span>
              {results.length} {results.length === 1 ? 'файл' : 'файлов'}
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

      <div className={`${isMobile ? 'max-h-[60vh]' : 'max-h-80'} overflow-y-auto p-1.5 space-y-0.5`}>
        {isLoading && results.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400 flex items-center justify-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            <span>Поиск файлов...</span>
          </div>
        ) : results.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">
            <FileCode className="w-8 h-8 mx-auto mb-1.5 opacity-30 text-accent" />
            {t.noFilesFound || 'Файлы не найдены'}
          </div>
        ) : (
          results.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={`${(item as any).root || ''}:${item.path}`}
                onClick={() => handleSelectFile(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition select-none ${
                  isSelected
                    ? 'bg-accent/15 text-gray-900 dark:text-white font-medium border border-accent ring-1 ring-accent/30'
                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 border border-transparent'
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

                {!item.isDir && (
                  <span className="text-[10px] text-gray-400 font-mono hidden sm:inline shrink-0">
                    {formatBytes(item.size)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Search Bar */}
      <div
        ref={containerRef}
        className="hidden md:flex items-center justify-self-center relative w-72 lg:w-96 mx-4"
      >
        <Search className="w-4 h-4 absolute left-3 text-gray-400 pointer-events-none z-10" />
        <input
          ref={inputRef}
          type="text"
          placeholder={t.searchFiles || 'Поиск по файлам (Ctrl+P)...'}
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          className="w-full bg-gray-100 dark:bg-black/25 text-gray-900 dark:text-gray-200 text-xs rounded-xl pl-9 pr-16 py-1.5 border border-base-border focus:outline-none focus:border-accent transition-colors"
        />

        <div className="absolute right-2.5 flex items-center space-x-1.5">
          {query ? (
            <button
              onClick={() => {
                setQuery('');
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

        {isOpen && results.length > 0 && renderDropdown(false)}
      </div>

      {/* Mobile Search Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm p-3 flex flex-col md:hidden">
          <div className="relative flex items-center bg-base-surface border border-base-border rounded-2xl p-2 mb-2">
            <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
            <input
              ref={mobileInputRef}
              type="text"
              placeholder={t.searchFiles || 'Поиск...'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              autoFocus
              className="w-full bg-transparent text-xs text-gray-900 dark:text-white focus:outline-none"
            />
            <button
              onClick={onMobileClose}
              className="p-1 text-gray-400 hover:text-white rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {renderDropdown(true)}
        </div>
      )}
    </>
  );
};
