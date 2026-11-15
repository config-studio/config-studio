import React, { useEffect, useRef } from 'react';
import { SplitPanel, IconButton } from '@config-studio/ui';
import { ChevronDown, RotateCw, ExternalLink } from 'lucide-react';
import { SplitPanelDef } from '../types';

interface PluginSplitPanelProps {
  panels: SplitPanelDef[];
  activePanelId: string | null;
  onSelectPanel: (panelId: string) => void;
  onClose: (panelId: string) => void;
}

const SinglePanelMount: React.FC<{ panel: SplitPanelDef; isActive: boolean }> = ({ panel, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (containerRef.current && (!renderedRef.current || panel.render)) {
      try {
        panel.render(containerRef.current);
        renderedRef.current = true;
      } catch (err) {
        console.error('[PluginSplitPanel] Error rendering split panel:', panel.id, err);
      }
    }
  }, [panel]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full overflow-hidden relative text-[var(--text-primary)] ${
        isActive ? 'flex flex-col flex-1' : 'hidden'
      }`}
    />
  );
};

export const PluginSplitPanel: React.FC<PluginSplitPanelProps> = ({
  panels,
  activePanelId,
  onSelectPanel,
  onClose,
}) => {
  if (!panels || panels.length === 0) return null;

  const activePanel =
    panels.find((p) => p.id === activePanelId) || panels[0];

  // Header Title component (Variant C Dropdown if > 1 panel, otherwise clean title)
  const renderTitle = () => {
    if (panels.length > 1) {
      return (
        <div className="relative inline-flex items-center min-w-0">
          <select
            value={activePanel.id}
            onChange={(e) => onSelectPanel(e.target.value)}
            className="bg-black/30 hover:bg-black/50 text-xs font-semibold text-[var(--text-primary)] border border-base-border rounded px-2.5 py-1 pr-6 cursor-pointer outline-none transition-colors appearance-none max-w-[240px] truncate"
            title="Переключить активную сплит-панель"
          >
            {panels.map((p) => (
              <option key={p.id} value={p.id} className="bg-base text-[var(--text-primary)]">
                {p.title} {p.port ? `(:${p.port})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-1.5 text-[var(--text-muted)]"
          />
        </div>
      );
    }

    return (
      <div className="flex items-center space-x-2 min-w-0">
        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
          {activePanel.title}
        </span>
        {activePanel.port && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-[var(--text-secondary)] border border-base-border shrink-0">
            :{activePanel.port}
          </span>
        )}
      </div>
    );
  };

  const headerActions = (
    <>
      {activePanel.onReload && (
        <IconButton
          variant="ghost"
          size="xs"
          onClick={() => activePanel.onReload?.()}
          icon={<RotateCw size={13} />}
          title="Обновить предпросмотр"
        />
      )}
      {activePanel.url && (
        <IconButton
          variant="ghost"
          size="xs"
          onClick={() => window.open(activePanel.url, '_blank')}
          icon={<ExternalLink size={13} />}
          title="Открыть в новой вкладке браузера"
        />
      )}
    </>
  );

  return (
    <SplitPanel
      title={renderTitle()}
      statusDot="online"
      onClose={() => onClose(activePanel.id)}
      allowMaximize
      headerActions={headerActions}
    >
      {/* Mounted Panels Area (preserves DOM state across switches) */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {panels.map((p) => (
          <SinglePanelMount
            key={p.id}
            panel={p}
            isActive={p.id === activePanel.id}
          />
        ))}
      </div>
    </SplitPanel>
  );
};
