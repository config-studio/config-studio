import React from 'react';
import { X, Plus } from 'lucide-react';

export interface PillTabItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  badgeColor?: 'accent' | 'red' | 'amber' | 'emerald' | 'gray';
  statusDot?: 'green' | 'amber' | 'red';
  isDirty?: boolean;
  closable?: boolean;
  disabled?: boolean;
}

export interface PillTabsProps {
  items: PillTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  onClose?: (id: string, e: React.MouseEvent) => void;
  onAdd?: () => void;
  addTooltip?: string;
  variant?: 'files' | 'filters' | 'dock';
  size?: 'sm' | 'md';
  className?: string;
  trackClassName?: string;
  rightSlot?: React.ReactNode;
}

export const PillTabs: React.FC<PillTabsProps> = ({
  items,
  activeId,
  onChange,
  onClose,
  onAdd,
  addTooltip = 'Создать',
  variant = 'files',
  size = 'md',
  className = '',
  trackClassName = '',
  rightSlot,
}) => {
  const isSm = size === 'sm';

  const getBadgeColorClass = (color?: PillTabItem['badgeColor']) => {
    switch (color) {
      case 'red':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'amber':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'emerald':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'accent':
        return 'bg-accent/20 text-accent border-accent/30';
      default:
        return 'bg-white/10 text-[var(--text-secondary)] border-base-border';
    }
  };

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      {/* Recessed Segmented Track */}
      <div
        className={`flex items-center select-none shrink-0 overflow-x-auto custom-scrollbar border border-base-border shadow-inner ${
          variant === 'dock'
            ? 'p-0.5 rounded-xl gap-0.5 bg-black/10 dark:bg-black/35'
            : 'p-1 rounded-2xl gap-1 bg-black/15 dark:bg-black/35'
        } ${trackClassName}`}
        role="tablist"
      >
        {items.map((tab) => {
          const isSelected = activeId === tab.id;
          const showClose = Boolean(
            onClose && (tab.closable === true || (tab.closable !== false && variant === 'files'))
          );

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={`group flex items-center space-x-1.5 font-medium transition cursor-pointer select-none shrink-0 ${
                variant === 'dock' ? 'rounded-lg' : 'rounded-xl'
              } ${
                isSm
                  ? variant === 'dock'
                    ? 'px-2 py-0.5 text-[11px]'
                    : 'px-2.5 py-1 text-xs'
                  : 'px-3 py-1.5 text-xs'
              } ${
                isSelected
                  ? 'bg-accent text-white font-semibold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/5'
              } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {tab.icon && (
                <span className={`shrink-0 ${isSelected ? 'text-white' : 'text-gray-400 group-hover:text-[var(--text-primary)]'}`}>
                  {tab.icon}
                </span>
              )}

              {/* Status Glowing Dot (Fixed 8px size, never jumps) */}
              {tab.statusDot && (
                <span
                  className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                    tab.statusDot === 'green'
                      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]'
                      : tab.statusDot === 'amber'
                      ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.85)] animate-pulse'
                      : 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.85)]'
                  }`}
                  title={
                    tab.statusDot === 'green'
                      ? 'Подключено'
                      : tab.statusDot === 'amber'
                      ? 'Подключение...'
                      : 'Отключено / Ошибка'
                  }
                />
              )}

              <span className="truncate max-w-[160px]">{tab.label}</span>

              {/* Unsaved dirty dot indicator */}
              {tab.isDirty && (
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isSelected ? 'bg-white/80' : 'bg-accent'
                  }`}
                  title="Несохраненные изменения"
                />
              )}

              {/* Badge */}
              {tab.badge !== undefined && tab.badge !== null && (
                <span
                  className={`text-[9px] font-mono px-1 py-0.2 rounded font-semibold shrink-0 ${getBadgeColorClass(
                    tab.badgeColor
                  )}`}
                >
                  {tab.badge}
                </span>
              )}

              {/* Close Button */}
              {showClose && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose?.(tab.id, e);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      onClose?.(tab.id, e as any);
                    }
                  }}
                  className={`ml-1 p-0.5 rounded-md transition hover:bg-black/20 dark:hover:bg-white/20 cursor-pointer ${
                    isSelected ? 'text-white/80 hover:text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Закрыть вкладку"
                  aria-label={`Close ${tab.label}`}
                >
                  <X size={11} />
                </span>
              )}
            </button>
          );
        })}

        {/* Optional Add Tab Button */}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="p-1.5 rounded-xl text-gray-400 hover:text-[var(--text-primary)] hover:bg-black/20 dark:hover:bg-white/10 transition cursor-pointer shrink-0"
            title={addTooltip}
            aria-label={addTooltip}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Optional Right Action Slot (PluginActionGroup) */}
      {rightSlot && (
        <div className="flex items-center shrink-0">
          {rightSlot}
        </div>
      )}
    </div>
  );
};

export interface PluginActionItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  title?: string;
  variant?: 'outline' | 'ghost' | 'accent';
}

export interface PluginActionGroupProps {
  badge?: string;
  badgeColor?: string;
  actions: PluginActionItem[];
  className?: string;
}

export const PluginActionGroup: React.FC<PluginActionGroupProps> = ({
  badge,
  badgeColor = 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
  actions,
  className = '',
}) => {
  if (!actions.length && !badge) return null;

  return (
    <div className={`flex items-center space-x-1.5 p-1 rounded-xl bg-black/15 dark:bg-black/30 border border-base-border select-none ${className}`}>
      {badge && (
        <div className={`flex items-center space-x-1 px-2 py-0.5 rounded-lg border text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 ${badgeColor}`}>
          <span>⚡</span>
          <span>{badge}</span>
        </div>
      )}

      {actions.map((act) => (
        <button
          key={act.id}
          type="button"
          onClick={act.onClick}
          title={act.title || act.label}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-base-border bg-base-surface hover:bg-accent/15 hover:border-accent text-[var(--text-primary)] transition cursor-pointer shadow-sm active:scale-95 shrink-0"
        >
          {act.icon && <span className="shrink-0">{act.icon}</span>}
          <span>{act.label}</span>
        </button>
      ))}
    </div>
  );
};
