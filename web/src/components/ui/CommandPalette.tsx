import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, FileCode, Folder, Hash } from 'lucide-react';
import { Modal } from './Modal';
import { ScrollArea } from './ScrollArea';

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  category?: string;
  data?: any;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  onSelect: (item: CommandPaletteItem) => void;
  placeholder?: string;
  emptyText?: string;
  maxResults?: number;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  items,
  onSelect,
  placeholder = 'Поиск файлов или команд (Ctrl+P)...',
  emptyText = 'Ничего не найдено',
  maxResults = 50,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items.slice(0, maxResults);
    const q = query.toLowerCase().trim();
    const matches: CommandPaletteItem[] = [];

    for (const item of items) {
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchSubtitle = item.subtitle ? item.subtitle.toLowerCase().includes(q) : false;
      if (matchTitle || matchSubtitle) {
        matches.push(item);
        if (matches.length >= maxResults) break;
      }
    }
    return matches;
  }, [items, query, maxResults]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, filteredItems.length - 1)));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          onSelect(filteredItems[selectedIndex]);
          onClose();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      allowMaximize={false}
      className="!p-0 !overflow-hidden !border-base-border shadow-2xl"
    >
      <div className="flex flex-col max-h-[70vh]">
        {/* Search Header */}
        <div className="p-3 border-b border-base-border bg-base-surface flex items-center space-x-3">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)] bg-black/10 dark:bg-white/10 rounded border border-base-border shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <ScrollArea className="flex-1 max-h-[380px] p-1.5">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)] select-none">
              {emptyText}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredItems.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelect(item);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition select-none ${
                      isSelected
                        ? 'bg-accent/15 text-accent border border-accent/20'
                        : 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 mr-3">
                      <div className="shrink-0 text-[var(--text-muted)]">
                        {item.icon || <FileCode size={14} />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{item.title}</div>
                        {item.subtitle && (
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>

                    {item.badge && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] border border-base-border shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </Modal>
  );
};
