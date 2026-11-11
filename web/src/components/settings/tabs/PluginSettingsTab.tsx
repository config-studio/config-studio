import React, { useState, useEffect, useRef } from 'react';
import {
  Package,
  Search,
  Check,
  Layers,
  Info,
  RefreshCw,
  FolderOpen,
  Sliders,
} from 'lucide-react';
import { PluginItem, PluginSettingField } from '../../../types';
import { api } from '../../../services/api';
import { getPluginName, getPluginDescription } from '../../../utils/i18n';
import { pluginManager } from '../../../services/pluginLoader';
import {
  Card,
  Input,
  Dropdown,
  DropdownOption,
  Toggle,
  Badge,
  SearchInput,
  EmptyState,
  SectionHeader,
} from '../../ui';

interface PluginSettingsTabProps {
  initialPluginId?: string | null;
  accentColor: string;
  language: string;
  t: any;
}

export const PluginSettingsTab: React.FC<PluginSettingsTabProps> = ({
  initialPluginId,
  accentColor,
  language,
  t,
}) => {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(initialPluginId || null);

  // Settings values for the selected plugin (loaded from data/plugin-settings/<id>.json)
  const [settingsValues, setSettingsValues] = useState<Record<string, any>>({});
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Custom DOM container ref for plugins registering custom renderers
  const customContainerRef = useRef<HTMLDivElement>(null);

  const loadPlugins = async () => {
    setIsLoading(true);
    try {
      const items = await api.getPlugins();
      setPlugins(items);
      if (!selectedPluginId && items.length > 0) {
        setSelectedPluginId(items[0].id);
      }
    } catch (err) {
      console.error('Failed to load plugins:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const selectedPlugin = plugins.find((p) => p.id === selectedPluginId) || null;

  // Load saved settings for selected plugin
  useEffect(() => {
    if (!selectedPluginId) return;

    let isMounted = true;
    setIsLoadingSettings(true);
    setSaveSuccess(false);

    api
      .getPluginSettings(selectedPluginId)
      .then((data) => {
        if (!isMounted) return;
        setSettingsValues(data || {});
      })
      .catch((err) => {
        console.error('Failed to get plugin settings:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingSettings(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedPluginId]);

  // Mount custom settings renderer if the plugin registered one
  useEffect(() => {
    if (!selectedPluginId || !customContainerRef.current) return;
    const renderer = pluginManager.getPluginSettingsRenderer(selectedPluginId);
    if (renderer) {
      customContainerRef.current.innerHTML = '';
      try {
        renderer(customContainerRef.current);
      } catch (err) {
        console.error(`[PluginSettingsTab] Custom renderer error for ${selectedPluginId}:`, err);
      }
    }
  }, [selectedPluginId, isLoadingSettings]);

  const handleUpdateSetting = async (fieldId: string, value: any) => {
    if (!selectedPluginId) return;
    const next = { ...settingsValues, [fieldId]: value };
    setSettingsValues(next);

    setIsSaving(true);
    try {
      await api.savePluginSettings(selectedPluginId, next);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save plugin settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const filteredPlugins = plugins.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const name = getPluginName(p, language).toLowerCase();
    const id = p.id.toLowerCase();
    const desc = getPluginDescription(p, language).toLowerCase();
    return name.includes(q) || id.includes(q) || desc.includes(q);
  });

  const customRenderer = selectedPluginId ? pluginManager.getPluginSettingsRenderer(selectedPluginId) : undefined;
  const manifestSettings: PluginSettingField[] = selectedPlugin?.settings || [];

  return (
    <div className="flex flex-1 h-full overflow-hidden min-h-0">
      {/* Left Column: Plugin Names List with Scrolling (~250px) */}
      <div className="w-64 border-r border-base-border flex flex-col bg-gray-50/70 dark:bg-black/25 shrink-0">
        {/* Search header */}
        <div className="p-3 border-b border-base-border">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t.pluginSettingsSearch || 'Поиск плагина...'}
            className="w-full min-w-0"
          />
        </div>

        {/* Plugin Stack with smooth scroll */}
        <div className="p-2 space-y-1 overflow-y-auto flex-1 custom-scrollbar">
          {isLoading && plugins.length === 0 ? (
            <EmptyState loading={true} loadingText="Загрузка..." bordered={false} className="py-8" />
          ) : filteredPlugins.length === 0 ? (
            <EmptyState
              description={searchQuery ? 'Плагины не найдены' : t.pluginSettingsNoPlugins}
              bordered={false}
              className="py-8"
            />
          ) : (
            filteredPlugins.map((p) => {
              const isSelected = selectedPluginId === p.id;
              const hasConfig = p.settings && p.settings.length > 0;
              const hasCustom = !!pluginManager.getPluginSettingsRenderer(p.id);

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPluginId(p.id)}
                  style={{
                    backgroundColor: isSelected ? `${accentColor}20` : undefined,
                    borderColor: isSelected ? `${accentColor}60` : 'transparent',
                  }}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center space-x-2.5 group cursor-pointer ${
                    isSelected
                      ? 'shadow-xs font-medium'
                      : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {/* Status dot */}
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      p.enabled ? 'bg-emerald-400 shadow-xs' : 'bg-gray-400 dark:bg-gray-600'
                    }`}
                    title={p.enabled ? 'Включен' : 'Отключен'}
                  />

                  {/* Icon */}
                  <div
                    className="p-1 rounded-lg shrink-0 transition"
                    style={{
                      color: isSelected ? accentColor : undefined,
                      backgroundColor: isSelected ? `${accentColor}25` : undefined,
                    }}
                  >
                    <Package size={14} className={isSelected ? '' : 'text-gray-400 group-hover:text-gray-200'} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span
                        className="text-xs truncate font-semibold"
                        style={{ color: isSelected ? accentColor : undefined }}
                      >
                        {getPluginName(p, language)}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      <span className="font-mono">v{p.version}</span>
                      {(hasConfig || hasCustom) && (
                        <Badge variant="accent" size="sm">
                          Настройки
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Settings Content for Selected Plugin */}
      <div className="flex-1 flex flex-col overflow-y-auto bg-base-surface custom-scrollbar">
        {!selectedPlugin ? (
          <EmptyState
            icon={<Package size={36} />}
            title={t.pluginSettingsSelectPrompt}
            description={t.pluginSettingsDesc}
            bordered={false}
            className="flex-1 my-auto"
          />
        ) : (
          <div className="p-6 space-y-6">
            {/* Header info */}
            <div className="flex items-start justify-between pb-4 border-b border-base-border gap-4">
              <div className="flex items-start space-x-3.5 min-w-0">
                <div
                  className="p-3 rounded-2xl border flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: `${accentColor}15`,
                    borderColor: `${accentColor}35`,
                    color: accentColor,
                  }}
                >
                  <Package size={24} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">
                      {getPluginName(selectedPlugin, language)}
                    </h3>
                    <Badge variant="neutral" size="sm">
                      v{selectedPlugin.version}
                    </Badge>
                    <Badge
                      variant={selectedPlugin.enabled ? 'success' : 'neutral'}
                      size="sm"
                    >
                      {selectedPlugin.enabled ? 'Включен' : 'Отключен'}
                    </Badge>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                    {getPluginDescription(selectedPlugin, language)}
                  </p>

                  <div className="flex items-center space-x-3 text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                    {selectedPlugin.author && (
                      <span>
                        {t.author}: <strong className="text-gray-300">{selectedPlugin.author}</strong>
                      </span>
                    )}
                    <span className="font-mono">ID: {selectedPlugin.id}</span>
                  </div>
                </div>
              </div>

              {/* Autosave status indicator */}
              <div className="shrink-0 flex items-center space-x-2">
                {isSaving && (
                  <span className="text-[11px] text-accent flex items-center space-x-1 font-mono">
                    <RefreshCw size={12} className="animate-spin" />
                    <span>Сохранение...</span>
                  </span>
                )}
                {saveSuccess && (
                  <span className="text-[11px] text-emerald-400 flex items-center space-x-1 font-mono">
                    <Check size={12} />
                    <span>{t.pluginSettingsSaved || 'Сохранено'}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Custom Plugin Settings Container (if registered by plugin script) */}
            {customRenderer && (
              <div className="space-y-2">
                <SectionHeader
                  icon={<Sliders size={13} />}
                  title="Пользовательская панель параметров"
                />
                <div
                  ref={customContainerRef}
                  className="p-4 rounded-2xl bg-black/20 border border-base-border min-h-[120px]"
                />
              </div>
            )}

            {/* Manifest-declared Settings Schema Form */}
            {manifestSettings.length > 0 && (
              <div className="space-y-4">
                <SectionHeader
                  icon={<Sliders size={13} />}
                  title="Параметры расширения"
                />

                <div className="space-y-3.5">
                  {manifestSettings.map((field) => {
                    const val =
                      settingsValues[field.id] !== undefined
                        ? settingsValues[field.id]
                        : field.default !== undefined
                        ? field.default
                        : '';

                    if (field.type === 'boolean') {
                      return (
                        <Card key={field.id} className="p-3.5">
                          <Toggle
                            checked={!!val}
                            onChange={(nextVal) => handleUpdateSetting(field.id, nextVal)}
                            label={field.label}
                            description={field.description}
                            size="sm"
                          />
                        </Card>
                      );
                    }

                    if (field.type === 'select') {
                      return (
                        <Card key={field.id} className="p-3.5">
                          <Dropdown
                            label={field.label}
                            description={field.description}
                            value={val}
                            onChange={(v) => handleUpdateSetting(field.id, v)}
                            options={(field.options || []).map((opt: any) => {
                              const optVal = typeof opt === 'object' ? opt.value : opt;
                              const optLabel = typeof opt === 'object' ? opt.label : opt;
                              return { value: optVal, label: optLabel };
                            })}
                            size="sm"
                          />
                        </Card>
                      );
                    }

                    return (
                      <Card key={field.id} className="p-3.5">
                        <Input
                          label={field.label}
                          description={field.description}
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={val}
                          onChange={(e) =>
                            handleUpdateSetting(
                              field.id,
                              field.type === 'number' ? Number(e.target.value) : e.target.value
                            )
                          }
                        />
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Empty state: No custom config for this plugin */}
            {!customRenderer && manifestSettings.length === 0 && (
              <Card className="p-6 space-y-3">
                <div className="flex items-center space-x-2 text-xs font-semibold text-gray-400">
                  <Info size={14} className="text-accent" />
                  <span>{t.pluginSettingsNoCustomConfig}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  Данное расширение работает с параметрами по умолчанию и готово к работе сразу после установки.
                </p>

                {/* Storage Info */}
                <div className="pt-3 border-t border-base-border/50 flex items-center space-x-2 text-[11px] text-gray-400 font-mono">
                  <FolderOpen size={13} className="text-accent" />
                  <span>{t.pluginSettingsAutosaved}</span>
                </div>
              </Card>
            )}

            {/* Technical Specifications Card */}
            <Card className="p-4 space-y-2.5">
              <SectionHeader
                icon={<Layers size={13} />}
                title="Технические метаданные"
              />

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-lg bg-black/20 border border-base-border/50">
                  <span className="text-gray-500 text-[10px] block">Идентификатор (ID):</span>
                  <span className="text-gray-200">{selectedPlugin.id}</span>
                </div>
                <div className="p-2 rounded-lg bg-black/20 border border-base-border/50">
                  <span className="text-gray-500 text-[10px] block">Точка входа:</span>
                  <span className="text-gray-200 truncate block">{selectedPlugin.entry || 'main.js'}</span>
                </div>
              </div>

              {selectedPlugin.permissions && selectedPlugin.permissions.length > 0 && (
                <div className="pt-2 border-t border-base-border/50">
                  <span className="text-gray-500 text-[10px] block mb-1">Разрешения:</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedPlugin.permissions.map((perm) => (
                      <Badge
                        key={perm}
                        variant="accent"
                        size="sm"
                        className="font-mono text-[10px]"
                      >
                        {perm}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};
