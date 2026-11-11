import React, { useState, useEffect, useRef } from 'react';
import {
  Palette,
  Shield,
  Key,
  Server,
  Package,
  Sliders,
  Share2,
  ScrollText,
  RotateCcw,
  Check,
} from 'lucide-react';
import { translations, getAvailableLanguages, subscribeLanguages, LanguageMeta } from '../../utils/i18n';
import { SettingsModalProps, SettingsTab } from './types';
import { Modal, PillTabs, PillTabItem, Button, Badge, ConfirmModal } from '../ui';
import { GeneralTab } from './tabs/GeneralTab';
import { SecurityTab } from './tabs/SecurityTab';
import { SecretsTab } from './tabs/SecretsTab';
import { SSHHostsTab } from './SSHHostsTab';
import { PluginsTab } from './tabs/PluginsTab';
import { PluginSettingsTab } from './tabs/PluginSettingsTab';
import { ProfileTab } from './tabs/ProfileTab';
import { AuditTab } from './tabs/AuditTab';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onReloadSettings,
  onReloadPlugins,
  onUploadIcon,
  initialTab = 'general',
  onOpenTerminal,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [selectedPluginIdForSettings, setSelectedPluginIdForSettings] = useState<string | null>(null);

  // App settings state
  const [title, setTitle] = useState(settings.appTitle || 'Config Studio');
  const [baseColor, setBaseColor] = useState(settings.baseColor || '#161b22');
  const [accentColor, setAccentColor] = useState(settings.accentColor || '#00d2b4');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(settings.themeMode || 'dark');
  const [language, setLanguage] = useState(settings.language || 'ru');
  const [bottomDockMode, setBottomDockMode] = useState<'auto' | 'always' | 'hidden'>(
    settings.bottomDockMode || 'auto'
  );

  // Security state
  const [authEnabled, setAuthEnabled] = useState(settings.authEnabled || false);
  const [authUser, setAuthUser] = useState(settings.authUser || '');
  const [authPass, setAuthPass] = useState('');
  const [apiEnabled, setApiEnabled] = useState(settings.apiEnabled !== false);
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [structureGuardEnabled, setStructureGuardEnabled] = useState(
    settings.structureGuardEnabled !== false
  );
  const [criticalPatterns, setCriticalPatterns] = useState(
    (settings.criticalPatterns || []).join('\n')
  );

  // Plugins unrestricted mode
  const [pluginExecUnrestricted, setPluginExecUnrestricted] = useState(
    settings.pluginExecUnrestricted || false
  );
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<LanguageMeta[]>(getAvailableLanguages());

  useEffect(() => {
    return subscribeLanguages(() => {
      setAvailableLanguages(getAvailableLanguages());
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTitle(settings.appTitle || 'Config Studio');
      setBaseColor(settings.baseColor || '#161b22');
      setAccentColor(settings.accentColor || '#00d2b4');
      setThemeMode(settings.themeMode || 'dark');
      setLanguage(settings.language || 'ru');
      setBottomDockMode(settings.bottomDockMode || 'auto');
      setAuthEnabled(settings.authEnabled || false);
      setAuthUser(settings.authUser || '');
      setAuthPass('');
      setApiEnabled(settings.apiEnabled !== false);
      setApiKey(settings.apiKey || '');
      setStructureGuardEnabled(settings.structureGuardEnabled !== false);
      setCriticalPatterns((settings.criticalPatterns || []).join('\n'));
      setPluginExecUnrestricted(settings.pluginExecUnrestricted || false);
      if (initialTab) setActiveTab(initialTab);
    }
  }, [isOpen, settings, initialTab]);

  const tabsStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const el = tabsStripRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0 && e.deltaX === 0) {
        const maxScrollLeft = el.scrollWidth - el.clientWidth;
        if (maxScrollLeft > 0) {
          const canScrollLeft = e.deltaY < 0 && el.scrollLeft > 0;
          const canScrollRight = e.deltaY > 0 && el.scrollLeft < maxScrollLeft;

          if (canScrollLeft || canScrollRight) {
            e.preventDefault();
            el.scrollLeft += e.deltaY;
          }
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const activeBtn = tabsStripRef.current?.querySelector('[aria-selected="true"]');
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const t = translations[language] || translations.ru;

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      const parsedPatterns = criticalPatterns
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean);

      await onSaveSettings({
        appTitle: title.trim() || 'Config Studio',
        baseColor,
        accentColor,
        themeMode,
        language,
        bottomDockMode,
        authEnabled,
        authUser: authUser.trim(),
        authPass: authPass || undefined,
        apiEnabled,
        apiKey,
        structureGuardEnabled,
        criticalPatterns: parsedPatterns,
        pluginExecUnrestricted,
      });
      onClose();
    } catch (err: any) {
      alert(`Ошибка сохранения настроек: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDefaults = () => {
    setIsResetConfirmOpen(true);
  };

  const handleConfirmReset = () => {
    setTitle('Config Studio');
    setBaseColor('#161b22');
    setAccentColor('#00d2b4');
    setThemeMode('dark');
    setLanguage('ru');
    setBottomDockMode('auto');
    setStructureGuardEnabled(true);
    setCriticalPatterns('');
    setPluginExecUnrestricted(false);
    setIsResetConfirmOpen(false);
  };

  const tabItems: PillTabItem[] = [
    { id: 'general', label: t.tabGeneral, icon: <Palette size={13} />, closable: false },
    { id: 'security', label: t.tabSecurity, icon: <Shield size={13} />, closable: false },
    { id: 'secrets', label: t.tabSecrets, icon: <Key size={13} />, closable: false },
    { id: 'ssh', label: 'SSH & Хосты', icon: <Server size={13} />, closable: false },
    { id: 'plugins', label: t.tabPlugins, icon: <Package size={13} />, closable: false },
    { id: 'plugin-settings', label: t.tabPluginSettings, icon: <Sliders size={13} />, closable: false },
    { id: 'profile', label: t.tabProfile, icon: <Share2 size={13} />, closable: false },
    { id: 'audit', label: t.tabAudit, icon: <ScrollText size={13} />, closable: false },
  ];

  return (
    <>
      <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xxl"
      height="fixed"
      allowMaximize={true}
      className="select-none"
    >
      <Modal.Header
        title={t.settings}
        badge={
          <Badge variant="accent" size="sm">
            v2.0.0
          </Badge>
        }
      />

      {/* Unified PillTabs Navigation Strip with Wheel Scroll */}
      <div
        ref={tabsStripRef}
        className="px-5 py-2.5 border-b border-base-border bg-base-surface shrink-0 overflow-x-auto no-scrollbar"
      >
        <PillTabs
          items={tabItems}
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as SettingsTab)}
          variant="filters"
          size="sm"
        />
      </div>

      {/* Active Tab Content Area - Zero Layout Shift */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {activeTab === 'general' && (
            <GeneralTab
              settings={settings}
              title={title}
              setTitle={setTitle}
              baseColor={baseColor}
              setBaseColor={setBaseColor}
              accentColor={accentColor}
              setAccentColor={setAccentColor}
              themeMode={themeMode}
              setThemeMode={setThemeMode}
              language={language}
              setLanguage={setLanguage}
              bottomDockMode={bottomDockMode}
              setBottomDockMode={setBottomDockMode}
              onUploadIcon={onUploadIcon}
              availableLanguages={availableLanguages}
              t={t}
            />
          )}

          {activeTab === 'security' && (
            <SecurityTab
              authEnabled={authEnabled}
              setAuthEnabled={setAuthEnabled}
              authUser={authUser}
              setAuthUser={setAuthUser}
              authPass={authPass}
              setAuthPass={setAuthPass}
              apiEnabled={apiEnabled}
              setApiEnabled={setApiEnabled}
              apiKey={apiKey}
              setApiKey={setApiKey}
              structureGuardEnabled={structureGuardEnabled}
              setStructureGuardEnabled={setStructureGuardEnabled}
              criticalPatterns={criticalPatterns}
              setCriticalPatterns={setCriticalPatterns}
              t={t}
            />
          )}

          {activeTab === 'secrets' && (
            <SecretsTab
              authEnabled={authEnabled}
              onNavigateToSecurity={() => setActiveTab('security')}
              language={language}
              t={t}
            />
          )}

          {activeTab === 'ssh' && (
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              <SSHHostsTab
                accentColor={accentColor}
                onOpenTerminal={(host) => {
                  onClose();
                  onOpenTerminal?.(host);
                }}
              />
            </div>
          )}

          {activeTab === 'plugins' && (
            <PluginsTab
              pluginExecUnrestricted={pluginExecUnrestricted}
              setPluginExecUnrestricted={setPluginExecUnrestricted}
              accentColor={accentColor}
              onReloadPlugins={onReloadPlugins}
              onNavigateToPluginSettings={(pluginId) => {
                setSelectedPluginIdForSettings(pluginId);
                setActiveTab('plugin-settings');
              }}
              language={language}
              t={t}
            />
          )}

          {activeTab === 'plugin-settings' && (
            <PluginSettingsTab
              initialPluginId={selectedPluginIdForSettings}
              accentColor={accentColor}
              language={language}
              t={t}
            />
          )}

          {activeTab === 'profile' && (
            <ProfileTab
              onReloadSettings={onReloadSettings}
              onReloadPlugins={onReloadPlugins}
              language={language}
              t={t}
            />
          )}

          {activeTab === 'audit' && <AuditTab t={t} />}
        </div>

        {/* Footer */}
        <Modal.Footer justify="between">
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={handleResetDefaults}
            className="text-gray-500 hover:text-gray-900 dark:hover:text-white"
          >
            {t.resetDefaults}
          </Button>

          <div className="flex items-center space-x-2.5">
            <Button variant="secondary" size="md" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={isSubmitting}
              icon={<Check size={14} />}
              onClick={handleSave}
              style={{ backgroundColor: accentColor }}
            >
              {isSubmitting ? '...' : t.applyChanges}
            </Button>
          </div>
        </Modal.Footer>
      </Modal>

      <ConfirmModal
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        onConfirm={handleConfirmReset}
        title={t.resetDefaults || 'Сброс настроек'}
        message={t.confirmResetSettings || 'Вы уверены, что хотите восстановить параметры по умолчанию?'}
        confirmText={t.resetDefaults || 'Сбросить'}
        variant="warning"
      />
    </>
  );
};
