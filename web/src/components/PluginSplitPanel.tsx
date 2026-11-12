import React, { useEffect, useRef } from 'react';
import { SplitPanel } from '@config-studio/ui';
import { SplitPanelDef } from '../types';

interface PluginSplitPanelProps {
  panel: SplitPanelDef;
  onClose: () => void;
}

export const PluginSplitPanel: React.FC<PluginSplitPanelProps> = ({ panel, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      try {
        panel.render(containerRef.current);
      } catch (err) {
        console.error('[PluginSplitPanel] Error rendering split panel:', panel.id, err);
      }
    }
  }, [panel]);

  return (
    <SplitPanel
      title={panel.title}
      statusDot="online"
      onClose={onClose}
      allowMaximize
    >
      {/* Plugin Mount Target */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative text-[var(--text-primary)]" />
    </SplitPanel>
  );
};
