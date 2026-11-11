import React, { useState, useRef, useMemo } from 'react';
import {
  Type,
  Globe,
  Sun,
  Moon,
  Image as ImageIcon,
  Upload,
  Check,
} from 'lucide-react';
import { Settings } from '../../../types';
import { LanguageMeta } from '../../../utils/i18n';
import { PRESET_BASE_COLORS, PRESET_ACCENT_COLORS } from '../types';
import { Input, Button, Card, Dropdown, DropdownOption } from '../../ui';

interface GeneralTabProps {
  settings: Settings;
  title: string;
  setTitle: (v: string) => void;
  baseColor: string;
  setBaseColor: (v: string) => void;
  accentColor: string;
  setAccentColor: (v: string) => void;
  themeMode: 'light' | 'dark';
  setThemeMode: (v: 'light' | 'dark') => void;
  language: string;
  setLanguage: (v: string) => void;
  bottomDockMode: 'auto' | 'always' | 'hidden';
  setBottomDockMode: (v: 'auto' | 'always' | 'hidden') => void;
  onUploadIcon: (file: File) => Promise<void>;
  availableLanguages: LanguageMeta[];
  t: any;
}

export const GeneralTab: React.FC<GeneralTabProps> = ({
  settings,
  title,
  setTitle,
  baseColor,
  setBaseColor,
  accentColor,
  setAccentColor,
  themeMode,
  setThemeMode,
  language,
  setLanguage,
  bottomDockMode,
  setBottomDockMode,
  onUploadIcon,
  availableLanguages,
  t,
}) => {
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const languageOptions: DropdownOption[] = useMemo(() => {
    return availableLanguages.map((l) => ({
      value: l.code,
      label: l.name,
      icon: <span className="text-base mr-1.5">{l.flag}</span>,
      badge: l.isPlugin ? 'Pack' : undefined,
      badgeColor: 'purple',
    }));
  }, [availableLanguages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (re) => {
        setIconPreview(re.target?.result as string);
      };
      reader.readAsDataURL(file);
      onUploadIcon(file);
    }
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
      {/* App Title */}
      <div>
        <Input
          label={
            <span className="flex items-center space-x-2">
              <Type className="w-4 h-4 text-accent" />
              <span>{t.appTitle}</span>
            </span>
          }
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Config Studio"
          description={t.appTitleHelp}
        />
      </div>

      {/* Language Selector Dropdown (Dropdown v2) */}
      {availableLanguages.length > 1 && (
        <Dropdown
          label={
            <span className="flex items-center space-x-2">
              <Globe className="w-4 h-4 text-accent" />
              <span>{t.language}</span>
            </span>
          }
          value={language}
          onChange={(val) => setLanguage(val)}
          options={languageOptions}
          size="md"
        />
      )}

      {/* Theme Mode Switch */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
          {t.theme}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant={themeMode === 'dark' ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setThemeMode('dark')}
            icon={<Moon className="w-3.5 h-3.5" />}
          >
            {t.themeDark}
          </Button>
          <Button
            type="button"
            variant={themeMode === 'light' ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setThemeMode('light')}
            icon={<Sun className="w-3.5 h-3.5" />}
          >
            {t.themeLight}
          </Button>
        </div>
      </div>

      {/* Custom Icon & Favicon Upload */}
      <Card className="p-4">
        <label className="flex items-center space-x-2 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
          <ImageIcon className="w-4 h-4 text-accent" />
          <span>{t.appIcon}</span>
        </label>
        <div className="flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl border border-base-border bg-gray-100 dark:bg-black/30 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-inner">
            {iconPreview ? (
              <img src={iconPreview} alt="Preview" className="w-full h-full object-contain p-1" />
            ) : settings.hasCustomIcon ? (
              <img src={`/api/branding/icon?t=${Date.now()}`} alt="Current Icon" className="w-full h-full object-contain p-1" />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-slate-900 shadow-sm"
                style={{ backgroundColor: accentColor }}
              >
                {title.substring(0, 2).toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex-1 space-y-1.5">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".png,.svg,.ico,.jpg,.webp"
              className="hidden"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              icon={<Upload className="w-3.5 h-3.5 text-accent" />}
            >
              {t.chooseImage}
            </Button>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {t.appIconHelp}
            </p>
          </div>
        </div>
      </Card>

      {/* Base Color */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
          {t.baseColor}
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {PRESET_BASE_COLORS.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              onClick={() => setBaseColor(preset.hex)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs border transition-all cursor-pointer ${
                baseColor.toLowerCase() === preset.hex.toLowerCase()
                  ? 'border-accent text-accent font-semibold shadow-xs'
                  : 'border-base-border text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full border border-gray-400/30"
                style={{ backgroundColor: preset.hex }}
              />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center space-x-2 mt-2">
          <input
            type="color"
            value={baseColor}
            onChange={(e) => setBaseColor(e.target.value)}
            className="w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={baseColor}
            onChange={(e) => setBaseColor(e.target.value)}
            className="w-28 px-2.5 py-1 bg-gray-100 dark:bg-black/30 border border-base-border rounded-xl text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Accent Color */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
          {t.accentColor}
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {PRESET_ACCENT_COLORS.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              onClick={() => setAccentColor(preset.hex)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs border transition-all cursor-pointer ${
                accentColor.toLowerCase() === preset.hex.toLowerCase()
                  ? 'border-accent text-accent font-semibold shadow-xs'
                  : 'border-base-border text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full border border-gray-400/30"
                style={{ backgroundColor: preset.hex }}
              />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center space-x-2 mt-2">
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-28 px-2.5 py-1 bg-gray-100 dark:bg-black/30 border border-base-border rounded-xl text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Bottom Dock Strip Mode */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
          {t.dockStripSetting}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setBottomDockMode('auto')}
            className={`py-2 px-3 rounded-xl border text-xs font-medium flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer ${
              bottomDockMode === 'auto'
                ? 'border-accent bg-accent/15 text-accent font-semibold shadow-xs'
                : 'border-base-border bg-gray-50 dark:bg-black/20 text-gray-600 dark:text-gray-400'
            }`}
          >
            <span className="font-semibold">{t.dockModeAuto}</span>
            <span className="text-[10px] opacity-75">{t.dockModeAutoDesc}</span>
          </button>
          <button
            type="button"
            onClick={() => setBottomDockMode('always')}
            className={`py-2 px-3 rounded-xl border text-xs font-medium flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer ${
              bottomDockMode === 'always'
                ? 'border-accent bg-accent/15 text-accent font-semibold shadow-xs'
                : 'border-base-border bg-gray-50 dark:bg-black/20 text-gray-600 dark:text-gray-400'
            }`}
          >
            <span className="font-semibold">{t.dockModeAlways}</span>
            <span className="text-[10px] opacity-75">{t.dockModeAlwaysDesc}</span>
          </button>
          <button
            type="button"
            onClick={() => setBottomDockMode('hidden')}
            className={`py-2 px-3 rounded-xl border text-xs font-medium flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer ${
              bottomDockMode === 'hidden'
                ? 'border-accent bg-accent/15 text-accent font-semibold shadow-xs'
                : 'border-base-border bg-gray-50 dark:bg-black/20 text-gray-600 dark:text-gray-400'
            }`}
          >
            <span className="font-semibold">{t.dockModeHidden}</span>
            <span className="text-[10px] opacity-75">{t.dockModeHiddenDesc}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
