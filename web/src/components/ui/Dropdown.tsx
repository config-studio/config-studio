import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';

export type DropdownBadgeColor = 'default' | 'green' | 'blue' | 'purple' | 'amber' | 'rose';

export interface DropdownOption {
  value: string | number;
  label: string;
  subtitle?: string;
  group?: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeColor?: DropdownBadgeColor;
  disabled?: boolean;
  statusDot?: 'online' | 'offline' | 'warning';
  meta?: any;
}

export interface DropdownProps {
  options: DropdownOption[];
  value: string | number | null | undefined;
  onChange: (value: any, option?: DropdownOption) => void;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  menuClassName?: string;
  clearable?: boolean;
  onClear?: () => void;
  accentColor?: string;
  renderOption?: (option: DropdownOption, isSelected: boolean) => React.ReactNode;
  renderSelected?: (option: DropdownOption) => React.ReactNode;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Выберите значение...',
  searchable,
  searchPlaceholder = 'Поиск...',
  label,
  description,
  error,
  disabled = false,
  size = 'md',
  className = '',
  menuClassName = '',
  clearable = false,
  onClear,
  accentColor = '#00d2b4',
  renderOption,
  renderSelected,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto flip if not enough room below
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 220 && rect.top > spaceBelow) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  }, [isOpen]);

  // Auto-enable search if more than 6 options
  const isSearchable = searchable !== undefined ? searchable : options.length > 6;

  // Selected option
  const selectedOption = useMemo(() => {
    return options.find((opt) => String(opt.value) === String(value));
  }, [options, value]);

  // Filtered options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase().trim();
    return options.filter((opt) => {
      const matchLabel = opt.label.toLowerCase().includes(q);
      const matchSub = opt.subtitle ? opt.subtitle.toLowerCase().includes(q) : false;
      const matchBadge = opt.badge ? opt.badge.toLowerCase().includes(q) : false;
      const matchVal = String(opt.value).toLowerCase().includes(q);
      const matchGroup = opt.group ? opt.group.toLowerCase().includes(q) : false;
      return matchLabel || matchSub || matchBadge || matchVal || matchGroup;
    });
  }, [options, searchQuery]);

  // Grouped options if groups are present
  const groups = useMemo(() => {
    const map = new Map<string, DropdownOption[]>();
    let hasGroups = false;

    filteredOptions.forEach((opt) => {
      const g = opt.group || '';
      if (g) hasGroups = true;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(opt);
    });

    return hasGroups ? map : null;
  }, [filteredOptions]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(0);
      if (isSearchable) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    } else {
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  }, [isOpen, isSearchable]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlightedIndex] && !filteredOptions[highlightedIndex].disabled) {
          selectOption(filteredOptions[highlightedIndex]);
        }
        break;
    }
  };

  const selectOption = (opt: DropdownOption) => {
    if (opt.disabled) return;
    onChange(opt.value, opt);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClear) onClear();
    else onChange(null);
  };

  const getBadgeClass = (color?: DropdownBadgeColor) => {
    switch (color) {
      case 'green':
        return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      case 'blue':
        return 'bg-blue-500/15 text-blue-400 border border-blue-500/30';
      case 'purple':
        return 'bg-purple-500/15 text-purple-400 border border-purple-500/30';
      case 'amber':
        return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
      case 'rose':
        return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
      default:
        return 'bg-[#21262d] text-[#8b949e] border border-[#30363d]';
    }
  };

  const renderOptionContent = (opt: DropdownOption, isSelected: boolean) => {
    if (renderOption) {
      return renderOption(opt, isSelected);
    }

    return (
      <div className="flex items-center justify-between w-full min-w-0">
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          {/* Status Dot */}
          {opt.statusDot && (
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                opt.statusDot === 'online'
                  ? 'bg-emerald-400'
                  : opt.statusDot === 'warning'
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
              }`}
            />
          )}

          {/* Option Icon */}
          {opt.icon && <span className="shrink-0 text-gray-400">{opt.icon}</span>}

          {/* Label & Subtitle */}
          <div className="truncate flex flex-col">
            <span className={`truncate text-xs ${isSelected ? 'text-white font-semibold' : 'text-[#c9d1d9]'}`}>
              {opt.label}
            </span>
            {opt.subtitle && (
              <span className="text-[10px] text-[#8b949e] font-mono truncate">
                {opt.subtitle}
              </span>
            )}
          </div>
        </div>

        {/* Right side: Badge & Check */}
        <div className="flex items-center space-x-2 shrink-0 ml-2">
          {opt.badge && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${getBadgeClass(opt.badgeColor)}`}>
              {opt.badge}
            </span>
          )}
          {isSelected && (
            <Check size={14} className="text-emerald-400 shrink-0" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`space-y-1.5 w-full relative ${className}`} onKeyDown={handleKeyDown}>
      {label && (
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider select-none">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <div
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full ${
          size === 'sm' ? 'min-h-[30px] px-2.5 py-1 text-xs' : 'min-h-[36px] px-3 py-1.5 text-xs'
        } bg-[#0d1117] border rounded-lg flex items-center justify-between cursor-pointer transition select-none ${
          error
            ? 'border-red-500 ring-1 ring-red-500'
            : isOpen
            ? 'border-emerald-500 ring-1 ring-emerald-500/30'
            : 'border-[#30363d] hover:border-gray-500 hover:bg-[#161b22]'
        } ${disabled ? 'opacity-50 cursor-not-allowed bg-black/20' : ''}`}
      >
        <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
          {selectedOption ? (
            renderSelected ? (
              renderSelected(selectedOption)
            ) : (
              <>
                {selectedOption.statusDot && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      selectedOption.statusDot === 'online'
                        ? 'bg-emerald-400'
                        : selectedOption.statusDot === 'warning'
                        ? 'bg-amber-400'
                        : 'bg-rose-500'
                    }`}
                  />
                )}
                {selectedOption.icon && <span className="shrink-0 text-gray-400">{selectedOption.icon}</span>}
                <div className="truncate flex items-center space-x-1.5 min-w-0 flex-1">
                  <span className="truncate text-white font-medium">{selectedOption.label}</span>
                  {selectedOption.badge && (
                    <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded shrink-0 ${getBadgeClass(selectedOption.badgeColor)}`}>
                      {selectedOption.badge}
                    </span>
                  )}
                </div>
              </>
            )
          ) : (
            <span className="text-gray-500 truncate">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center space-x-1.5 shrink-0 text-gray-400">
          {clearable && selectedOption && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 hover:text-white rounded transition"
            >
              <X size={13} />
            </button>
          )}
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-white' : ''}`}
          />
        </div>
      </div>

      {/* Floating Dropdown Menu */}
      {isOpen && (
        <div
          className={`absolute left-0 min-w-full z-50 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden text-xs animate-in fade-in zoom-in-95 duration-100 flex flex-col ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${menuClassName}`}
          style={{ maxHeight: '280px' }}
        >
          {/* Search Box */}
          {isSearchable && (
            <div className="p-2 border-b border-[#30363d] bg-[#0d1117] sticky top-0 z-10 flex items-center space-x-2">
              <Search size={13} className="text-[#8b949e] shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-gray-500 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {/* Options List */}
          <div ref={listRef} className="overflow-y-auto custom-scrollbar p-1 space-y-0.5 flex-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-500">
                Ничего не найдено
              </div>
            ) : groups ? (
              Array.from(groups.entries()).map(([groupName, groupOpts]) => (
                <div key={groupName || 'ungrouped'} className="space-y-0.5">
                  {groupName && (
                    <div className="px-2.5 py-1 text-[10px] font-semibold font-mono uppercase tracking-wider text-[#8b949e] bg-[#0d1117]/60 rounded">
                      {groupName}
                    </div>
                  )}
                  {groupOpts.map((opt) => {
                    const isSelected = String(opt.value) === String(value);
                    const globalIdx = filteredOptions.indexOf(opt);
                    const isHighlighted = globalIdx === highlightedIndex;

                    return (
                      <div
                        key={String(opt.value)}
                        onClick={() => selectOption(opt)}
                        onMouseEnter={() => setHighlightedIndex(globalIdx)}
                        className={`px-2.5 py-2 rounded-lg cursor-pointer transition select-none flex items-center ${
                          isSelected
                            ? 'bg-emerald-500/15 border border-emerald-500/30'
                            : isHighlighted
                            ? 'bg-white/10'
                            : 'hover:bg-white/5'
                        } ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        {renderOptionContent(opt, isSelected)}
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = String(opt.value) === String(value);
                const isHighlighted = idx === highlightedIndex;

                return (
                  <div
                    key={String(opt.value)}
                    onClick={() => selectOption(opt)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`px-2.5 py-2 rounded-lg cursor-pointer transition select-none flex items-center ${
                      isSelected
                        ? 'bg-emerald-500/15 border border-emerald-500/30'
                        : isHighlighted
                        ? 'bg-white/10'
                        : 'hover:bg-white/5'
                    } ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {renderOptionContent(opt, isSelected)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
      {description && !error && (
        <p className="text-[11px] text-gray-500 leading-relaxed">{description}</p>
      )}
    </div>
  );
};
