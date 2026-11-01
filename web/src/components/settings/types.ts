import { Settings, SSHHost } from '../../types';

export type SettingsTab =
  | 'general'
  | 'security'
  | 'secrets'
  | 'ssh'
  | 'plugins'
  | 'plugin-settings'
  | 'profile'
  | 'audit';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSaveSettings: (newSettings: Partial<Settings>) => Promise<void>;
  onReloadSettings?: () => Promise<void>;
  onReloadPlugins?: () => Promise<void>;
  onUploadIcon: (file: File) => Promise<void>;
  initialTab?: SettingsTab;
  onOpenTerminal?: (host: SSHHost) => void;
}

export const PRESET_BASE_COLORS = [
  { name: 'Dark Slate', hex: '#161b22' },
  { name: 'Deep Charcoal', hex: '#121212' },
  { name: 'Navy Midnight', hex: '#0f172a' },
  { name: 'Material Dark', hex: '#1e1e2e' },
  { name: 'Pure Black', hex: '#000000' },
  { name: 'Light Surface', hex: '#f8fafc' },
];

export const PRESET_ACCENT_COLORS = [
  { name: 'Teal (Default)', hex: '#00d2b4' },
  { name: 'Cyan Neon', hex: '#06b6d4' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Indigo Dream', hex: '#6366f1' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber Gold', hex: '#f59e0b' },
  { name: 'Orange Fire', hex: '#f97316' },
];
