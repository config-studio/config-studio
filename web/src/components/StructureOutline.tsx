import React, { useState, useMemo, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  AlertTriangle,
  FolderTree,
  Code2,
  Search,
  X,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import { OutlineNode, OutlineNodeType, Settings } from '../types';
import { translations } from '../utils/i18n';

interface StructureOutlineProps {
  outline: OutlineNode[];
  error?: string;
  settings: Settings;
  onSelectLine: (line: number, shouldFocus?: boolean) => void;
  isMobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
}

export const StructureOutline: React.FC<StructureOutlineProps> = ({
  outline,
  error,
  settings,
  onSelectLine,
  isMobileDrawerOpen = false,
  onCloseMobileDrawer,
}) => {
  const [localSearch, setLocalSearch] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const [hasJumped, setHasJumped] = useState(false);

  // Saved width with localStorage persistence
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cs_ast_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 200 && parsed <= 1200) {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
    return 320;
  });

  const [isResizing, setIsResizing] = useState(false);

  // Drag-to-resize listener
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const minW = 200;
      const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.65));
      const clamped = Math.min(Math.max(newWidth, minW), maxW);
      setWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Persist width when resized
  useEffect(() => {
    if (!isResizing) {
      try {
        localStorage.setItem('cs_ast_width', String(width));
      } catch {
        // ignore
      }
    }
  }, [width, isResizing]);

  const handleResetWidth = () => {
    setWidth(320);
    try {
      localStorage.setItem('cs_ast_width', '320');
    } catch {
      // ignore
    }
  };

  const t = translations[settings.language] || translations.ru;
  const searchQuery = localSearch;

  // Flatten and find all matching nodes
  const matchingNodes = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const matches: OutlineNode[] = [];
    const q = searchQuery.toLowerCase();

    function searchTraverse(node: OutlineNode) {
      const nodeText = (node.label || (node as any).name || '').toLowerCase();
      const matchLabel = nodeText.includes(q);
      const matchVal = node.value ? node.value.toLowerCase().includes(q) : false;

      if (matchLabel || matchVal) {
        matches.push(node);
      }
      if (node.children) {
        node.children.forEach(searchTraverse);
      }
    }

    outline.forEach(searchTraverse);
    return matches;
  }, [outline, searchQuery]);

  // Reset match index when query changes without stealing focus or jumping prematurely
  useEffect(() => {
    setCurrentMatchIndex(0);
    setHasJumped(false);
  }, [searchQuery]);

  const jumpToMatch = (idx: number) => {
    if (matchingNodes.length === 0) return;
    setCurrentMatchIndex(idx);
    setHasJumped(true);
    onSelectLine(matchingNodes[idx].line, false);
  };

  const handleNextMatch = () => {
    if (matchingNodes.length === 0) return;
    const nextIdx = hasJumped ? (currentMatchIndex + 1) % matchingNodes.length : 0;
    jumpToMatch(nextIdx);
  };

  const handlePrevMatch = () => {
    if (matchingNodes.length === 0) return;
    const prevIdx = hasJumped
      ? (currentMatchIndex - 1 + matchingNodes.length) % matchingNodes.length
      : matchingNodes.length - 1;
    jumpToMatch(prevIdx);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevMatch();
      } else {
        handleNextMatch();
      }
    }
  };

  const toggleCollapse = (id: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCollapseAll = () => {
    const parentIds = new Set<string>();
    const collect = (nodes: OutlineNode[]) => {
      for (const n of nodes) {
        if (n.children && n.children.length > 0) {
          parentIds.add(n.id);
          collect(n.children);
        }
      }
    };
    collect(outline);
    setCollapsedSet(parentIds);
  };

  const handleExpandAll = () => {
    setCollapsedSet(new Set());
  };

  const activeMatchedId = matchingNodes[currentMatchIndex]?.id;

  const handleSelect = (line: number, shouldFocus?: boolean) => {
    onSelectLine(line, shouldFocus);
    onCloseMobileDrawer?.();
  };

  const outlineContent = (
    <aside className="w-[285px] sm:w-80 lg:w-full bg-base-surface border-l border-base-border flex flex-col h-full select-none flex-shrink-0 text-gray-800 dark:text-gray-200">
      {/* Header */}
      <div className="p-3 border-b border-base-border flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <FolderTree className="w-4 h-4 text-accent" />
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t.structureOutline}
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={handleCollapseAll}
            className="p-1 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title={t.collapseAll}
          >
            <ChevronsDownUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleExpandAll}
            className="p-1 rounded-lg text-gray-400 hover:text-accent hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title={t.expandAll}
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
          </button>
          {onCloseMobileDrawer && (
            <button
              onClick={onCloseMobileDrawer}
              className="lg:hidden p-1 rounded-lg text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors ml-1"
              title="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search Bar with match counter and navigation buttons */}
      <div className="p-2 border-b border-base-border space-y-1.5">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder={t.searchOutline}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-gray-100 dark:bg-black/30 text-gray-800 dark:text-gray-200 text-xs rounded-xl pl-8 pr-16 py-1.5 border border-base-border focus:outline-none focus:border-accent transition-colors"
          />
          {localSearch && (
            <button
              onClick={() => setLocalSearch('')}
              className="absolute right-12 text-gray-400 hover:text-gray-700 dark:hover:text-white p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          {/* Up & Down arrow buttons */}
          <div className="absolute right-1.5 flex items-center space-x-0.5">
            <button
              onClick={handlePrevMatch}
              disabled={matchingNodes.length === 0}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-accent disabled:opacity-30"
              title={t.prevMatch}
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              onClick={handleNextMatch}
              disabled={matchingNodes.length === 0}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-accent disabled:opacity-30"
              title={t.nextMatch}
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Match counter badge */}
        {searchQuery && (
          <div className="flex items-center justify-between text-[11px] px-1">
            <span className="text-gray-500">
              {matchingNodes.length > 0
                ? t.matchesFound
                    .replace('{current}', String(currentMatchIndex + 1))
                    .replace('{total}', String(matchingNodes.length))
                : t.noMatches}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
        {error ? (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs text-red-600 dark:text-red-300 flex items-start space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{t.validationError}</p>
              <p className="mt-1 text-[11px] leading-relaxed opacity-90">{error}</p>
            </div>
          </div>
        ) : outline.length === 0 ? (
          <div className="text-center text-xs text-gray-400 dark:text-gray-500 py-12">
            <Code2 className="w-8 h-8 mx-auto mb-2 opacity-30 text-accent" />
            {t.noStructure}
          </div>
        ) : (
          <div className="space-y-0.5">
            {outline.map((node) => (
              <OutlineItem
                key={node.id}
                node={node}
                level={0}
                onSelectLine={handleSelect}
                searchFilter={searchQuery}
                activeMatchedId={activeMatchedId}
                collapsedSet={collapsedSet}
                onToggleCollapse={toggleCollapse}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom Footer: Expand All / Collapse All buttons */}
      <div className="p-2 border-t border-base-border bg-base-surface flex items-center space-x-2 text-xs flex-shrink-0">
        <button
          onClick={handleCollapseAll}
          className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 hover:text-accent border border-base-border transition-all active:scale-95 shadow-2xs"
          title={t.collapseAll}
        >
          <ChevronsDownUp className="w-3.5 h-3.5 text-accent" />
          <span className="font-medium text-[11px]">{t.collapseAll}</span>
        </button>
        <button
          onClick={handleExpandAll}
          className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 hover:text-accent border border-base-border transition-all active:scale-95 shadow-2xs"
          title={t.expandAll}
        >
          <ChevronsUpDown className="w-3.5 h-3.5 text-accent" />
          <span className="font-medium text-[11px]">{t.expandAll}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop view (always visible on lg+) */}
      <div
        style={{ width: `${width}px` }}
        className="hidden lg:flex relative h-full flex-shrink-0"
      >
        {/* Resizer Handle */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
          onDoubleClick={handleResetWidth}
          title={t.resizeWidthHelp}
          className="absolute top-0 bottom-0 -left-1.5 w-3 cursor-col-resize z-30 group flex items-center justify-center select-none"
        >
          <div
            className={`absolute inset-y-0 w-0.5 transition-opacity ${
              isResizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-75'
            }`}
            style={{ backgroundColor: settings.accentColor }}
          />
          <div
            className={`w-1 h-8 rounded-full z-10 transition-all ${
              isResizing
                ? 'opacity-100 scale-110 shadow-sm'
                : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{ backgroundColor: settings.accentColor }}
          />
        </div>

        {/* Fullscreen overlay to capture events cleanly during drag */}
        {isResizing && (
          <div className="fixed inset-0 z-50 cursor-col-resize select-none" />
        )}

        {outlineContent}
      </div>

      {/* Mobile Drawer (visible on < lg when open) */}
      {isMobileDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex animate-in fade-in duration-200">
          <div
            className="flex-1 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobileDrawer}
            aria-hidden="true"
          />
          <div className="h-full shadow-2xl animate-in slide-in-from-right duration-200 flex flex-shrink-0">
            {outlineContent}
          </div>
        </div>
      )}
    </>
  );
};

interface OutlineItemProps {
  node: OutlineNode;
  level: number;
  onSelectLine: (line: number, shouldFocus?: boolean) => void;
  searchFilter: string;
  activeMatchedId?: string;
  collapsedSet: Set<string>;
  onToggleCollapse: (id: string) => void;
}

const OutlineItem: React.FC<OutlineItemProps> = ({
  node,
  level,
  onSelectLine,
  searchFilter,
  activeMatchedId,
  collapsedSet,
  onToggleCollapse,
}) => {
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapsedSet.has(node.id);

  // Filter check
  const nodeText = (node.label || (node as any).name || '').toLowerCase();
  const isDirectMatch =
    Boolean(searchFilter) &&
    (nodeText.includes(searchFilter.toLowerCase()) ||
      (node.value ? node.value.toLowerCase().includes(searchFilter.toLowerCase()) : false));

  const hasMatchingDescendant = useMemo(() => {
    if (!searchFilter.trim() || !hasChildren) return false;
    const q = searchFilter.toLowerCase();
    function check(n: OutlineNode): boolean {
      const nText = (n.label || (n as any).name || '').toLowerCase();
      if (
        nText.includes(q) ||
        (n.value && n.value.toLowerCase().includes(q))
      ) {
        return true;
      }
      return Boolean(n.children && n.children.some(check));
    }
    return node.children!.some(check);
  }, [node.children, searchFilter, hasChildren]);

  // Auto-expand if child matches search
  useEffect(() => {
    if (hasMatchingDescendant && isCollapsed) {
      onToggleCollapse(node.id);
    }
  }, [hasMatchingDescendant]);

  const isActiveMatch = activeMatchedId === node.id;

  const getTypeBadge = (type: OutlineNodeType) => {
    switch (type) {
      case 'object':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
            Object
          </span>
        );
      case 'list':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30">
            List
          </span>
        );
      case 'string':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            String
          </span>
        );
      case 'number':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            Number
          </span>
        );
      case 'boolean':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-pink-500/15 text-pink-600 dark:text-pink-400 border border-pink-500/30">
            Boolean
          </span>
        );
      case 'section':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
            Section
          </span>
        );
      case 'router':
      case 'function':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
            Router
          </span>
        );
      case 'service':
      case 'class':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            Service
          </span>
        );
      case 'middleware':
        return (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            Middleware
          </span>
        );
    }
  };

  const isVisible = !searchFilter || isDirectMatch || hasMatchingDescendant;
  if (!isVisible) return null;

  return (
    <div className="select-none">
      <div
        onClick={() => onSelectLine(node.line, true)}
        style={{ paddingLeft: `${level * 14 + 6}px` }}
        className={`group flex items-center justify-between py-1 px-1.5 rounded-xl text-xs cursor-pointer transition-all ${
          isActiveMatch
            ? 'bg-accent/25 text-gray-900 dark:text-white font-semibold border border-accent ring-1 ring-accent'
            : isDirectMatch
            ? 'bg-amber-400/20 text-gray-900 dark:text-white font-medium border border-amber-400/50'
            : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300'
        }`}
      >
        <div className="flex items-center space-x-1.5 truncate min-w-0 pr-1">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(node.id);
              }}
              className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="w-3.5 inline-block" />
          )}

          <span
            className={`font-mono truncate ${
              isDirectMatch ? 'text-accent font-bold underline' : ''
            }`}
          >
            {node.label || (node as any).name || 'Unnamed'}
          </span>

          {node.value && (
            <span className="text-gray-500 text-[11px] truncate font-mono">
              : {node.value}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          <span className="text-[10px] text-gray-400 font-mono hidden group-hover:inline">
            L{node.line}
          </span>
          {getTypeBadge(node.type)}
        </div>
      </div>

      {hasChildren && !isCollapsed && (
        <div className="tree-line ml-3">
          {node.children!.map((child) => (
            <OutlineItem
              key={child.id}
              node={child}
              level={level + 1}
              onSelectLine={onSelectLine}
              searchFilter={searchFilter}
              activeMatchedId={activeMatchedId}
              collapsedSet={collapsedSet}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </div>
      )}
    </div>
  );
};
