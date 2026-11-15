import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Package,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  Trash2,
  Download,
  FileArchive,
  Link2,
  Upload,
  FolderOpen,
  AlertTriangle,
  Check,
  CheckCircle2,
  Zap,
  Layers,
  Settings as SettingsIcon,
  Search,
  X,
  Server,
  Globe,
  Radio,
  Sliders,
  ArrowUpRight,
} from 'lucide-react';
import { PluginItem, CatalogItem, PendingInstall } from '../../../types';
import { api } from '../../../services/api';
import { getPluginName, getPluginDescription } from '../../../utils/i18n';
import { PluginConsentModal } from '../../PluginConsentModal';
import {
  Card,
  Input,
  Button,
  Toggle,
  Badge,
  ConfirmModal,
  EmptyState,
  SectionHeader,
  PillTabs,
  Dropzone,
  Callout,
  IconButton,
} from '../../ui';

interface PluginsTabProps {
  pluginExecUnrestricted: boolean;
  setPluginExecUnrestricted: (v: boolean) => void;
  accentColor: string;
  onReloadPlugins?: () => Promise<void>;
  onNavigateToPluginSettings?: (pluginId: string) => void;
  language: string;
  t: any;
}

function semverCompare(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export const PluginsTab: React.FC<PluginsTabProps> = ({
  pluginExecUnrestricted,
  setPluginExecUnrestricted,
  accentColor: _accentColor,
  onReloadPlugins,
  onNavigateToPluginSettings,
  language,
  t,
}) => {
  const [pluginsList, setPluginsList] = useState<PluginItem[]>([]);
  const [isLoadingPlugins, setIsLoadingPlugins] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [installTab, setInstallTab] = useState<'zip' | 'url'>('zip');
  const [installUrl, setInstallUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installingCatalogId, setInstallingCatalogId] = useState<string | null>(null);
  const [installMsg, setInstallMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Showcase & Navigation states
  const [mainTab, setMainTab] = useState<'catalog' | 'installed' | 'install' | 'security'>('catalog');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'official' | 'agent' | 'updates'>('all');
  const [installedSearch, setInstalledSearch] = useState('');

  // Delete Confirm Modal
  const [pluginToDelete, setPluginToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingPlugin, setIsDeletingPlugin] = useState(false);

  // Consent Modal
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);
  const [isConfirmingInstall, setIsConfirmingInstall] = useState(false);

  const zipInputRef = useRef<HTMLInputElement>(null);

  const loadPlugins = async () => {
    setIsLoadingPlugins(true);
    try {
      const items = await api.getPlugins();
      setPluginsList(items);
    } catch (err) {
      console.error('Failed to load plugins:', err);
    } finally {
      setIsLoadingPlugins(false);
    }
  };

  const loadCatalog = async (forceSync = false) => {
    setIsLoadingCatalog(true);
    try {
      if (forceSync) {
        try {
          const syncRes = await api.syncSources();
          if (syncRes && syncRes.items && syncRes.items.length > 0) {
            setCatalogItems(syncRes.items);
            return;
          }
        } catch (syncErr) {
          console.warn('[PluginsTab] Force sync error, falling back to getCatalog:', syncErr);
        }
      }
      const items = await api.getCatalog();
      setCatalogItems(items);
    } catch (err) {
      console.error('Failed to load catalog:', err);
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  useEffect(() => {
    loadPlugins();
    loadCatalog(false);
  }, []);

  const handleTogglePlugin = async (id: string, currentEnabled: boolean) => {
    try {
      await api.togglePlugin(id, !currentEnabled);
      await loadPlugins();
      if (onReloadPlugins) await onReloadPlugins();
    } catch (err: any) {
      alert(`Ошибка переключения плагина: ${err.message}`);
    }
  };

  const handleDeletePlugin = (id: string, name: string) => {
    setPluginToDelete({ id, name });
  };

  const handleConfirmDeletePlugin = async () => {
    if (!pluginToDelete) return;
    setIsDeletingPlugin(true);
    try {
      await api.deletePlugin(pluginToDelete.id);
      await loadPlugins();
      if (onReloadPlugins) await onReloadPlugins();
      setPluginToDelete(null);
    } catch (err: any) {
      alert(`Ошибка удаления плагина: ${err.message}`);
    } finally {
      setIsDeletingPlugin(false);
    }
  };

  const handleZipFile = async (file: File) => {
    if (!file) return;
    setIsInstalling(true);
    setInstallMsg(null);
    try {
      const pending = await api.inspectPluginZip(file);
      setPendingInstall(pending);
    } catch (err: any) {
      setInstallMsg({ text: err.message || 'Ошибка проверки архива плагина', isError: true });
    } finally {
      setIsInstalling(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    await handleZipFile(e.target.files[0]);
  };

  const handleInstallFromUrl = async () => {
    if (!installUrl.trim()) return;
    setIsInstalling(true);
    setInstallMsg(null);
    try {
      const pending = await api.inspectPluginUrl(installUrl.trim());
      setPendingInstall(pending);
    } catch (err: any) {
      setInstallMsg({ text: err.message || 'Ошибка проверки плагина по ссылке', isError: true });
    } finally {
      setIsInstalling(false);
    }
  };

  const handleInspectCatalogItem = async (item: CatalogItem) => {
    if (!item.downloadUrl) return;
    setInstallingCatalogId(item.id);
    try {
      const pending = await api.inspectPluginUrl(item.downloadUrl);
      setPendingInstall(pending);
    } catch (err: any) {
      alert(`Ошибка проверки плагина: ${err.message}`);
    } finally {
      setInstallingCatalogId(null);
    }
  };

  const handleConfirmConsent = async (selectedOptionalDeps: string[] = []) => {
    if (!pendingInstall) return;
    setIsConfirmingInstall(true);
    const mainName = pendingInstall.manifest.name;
    try {
      await api.confirmPluginInstall(pendingInstall.tempKey);

      // Install or enable any selected optional dependencies
      let installedOptionalCount = 0;
      for (const depId of selectedOptionalDeps) {
        const existingPlugin = pluginsList.find((p) => p.id === depId);
        if (existingPlugin && !existingPlugin.enabled) {
          try {
            await api.togglePlugin(depId, true);
            installedOptionalCount++;
          } catch (e) {
            console.warn(`Failed to enable optional dependency ${depId}:`, e);
          }
        } else if (!existingPlugin) {
          const catItem = catalogItems.find((c) => c.id === depId);
          if (catItem?.downloadUrl) {
            try {
              const pendingOpt = await api.inspectPluginUrl(catItem.downloadUrl);
              await api.confirmPluginInstall(pendingOpt.tempKey);
              installedOptionalCount++;
            } catch (e) {
              console.warn(`Failed to install optional dependency ${depId}:`, e);
            }
          }
        }
      }

      setPendingInstall(null);
      setInstallMsg({
        text: `Плагин "${mainName}"${
          installedOptionalCount > 0 ? ` (+${installedOptionalCount} рекомендуемых расширений)` : ''
        } успешно установлен!`,
      });
      setInstallUrl('');
      await loadPlugins();
      await loadCatalog();
      if (onReloadPlugins) await onReloadPlugins();
    } catch (err: any) {
      alert(`Ошибка подтверждения установки: ${err.message}`);
    } finally {
      setIsConfirmingInstall(false);
    }
  };

  const handleCloseConsent = async () => {
    if (pendingInstall) {
      try {
        await api.cancelPluginInstall(pendingInstall.tempKey);
      } catch {
        // ignore
      }
    }
    setPendingInstall(null);
  };

  const updatesCount = useMemo(() => {
    return catalogItems.filter((cat) => {
      const installed = pluginsList.find((p) => p.id === cat.id);
      return installed && semverCompare(cat.version, installed.version) > 0;
    }).length;
  }, [catalogItems, pluginsList]);

  const filteredCatalogItems = useMemo(() => {
    return catalogItems.filter((item) => {
      const q = catalogSearch.toLowerCase().trim();
      const matchesQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.tags && item.tags.some((t) => t.toLowerCase().includes(q))) ||
        (item.author && item.author.toLowerCase().includes(q));

      if (!matchesQuery) return false;

      const installed = pluginsList.find((p) => p.id === item.id);
      const hasUpdate = installed && semverCompare(item.version, installed.version) > 0;

      if (catalogFilter === 'official') return item.official;
      if (catalogFilter === 'agent') return item.id === 'servers' || (item.tags && item.tags.some((t) => t.toLowerCase().includes('agent')));
      if (catalogFilter === 'updates') return hasUpdate;
      return true;
    });
  }, [catalogItems, pluginsList, catalogSearch, catalogFilter]);

  const filteredInstalledPlugins = useMemo(() => {
    const q = installedSearch.toLowerCase().trim();
    if (!q) return pluginsList;
    return pluginsList.filter((p) => {
      const name = getPluginName(p, language).toLowerCase();
      const desc = getPluginDescription(p, language).toLowerCase();
      return name.includes(q) || desc.includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [pluginsList, installedSearch, language]);

  const getPluginIcon = (id: string, official?: boolean) => {
    switch (id) {
      case 'servers':
        return <Server className="w-5 h-5 text-emerald-400" />;
      case 'web-devkit':
        return <Globe className="w-5 h-5 text-sky-400" />;
      case 'traefik':
        return <Radio className="w-5 h-5 text-amber-400" />;
      default:
        return official ? (
          <Sparkles className="w-5 h-5 text-accent" />
        ) : (
          <Package className="w-5 h-5 text-gray-400" />
        );
    }
  };

  const spotlightItem = useMemo(() => {
    return catalogItems.find((c) => c.id === 'servers') || catalogItems[0];
  }, [catalogItems]);

  return (
    <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
      {/* Top Navigation Pill Tabs */}
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-base-border/40 pb-4">
        <PillTabs
          items={[
            {
              id: 'catalog',
              label: (
                <span className="flex items-center gap-1.5">
                  <span>{language === 'en' ? 'Showcase & Catalog' : 'Витрина каталога'}</span>
                  {updatesCount > 0 && (
                    <span className="px-1.5 py-0.2 text-[9px] font-bold rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white animate-pulse">
                      {updatesCount}
                    </span>
                  )}
                </span>
              ),
              icon: <Sparkles size={14} className="text-amber-400" />,
            },
            {
              id: 'installed',
              label: `${language === 'en' ? 'Installed' : 'Установленные'} (${pluginsList.length})`,
              icon: <Package size={14} />,
            },
            {
              id: 'install',
              label: language === 'en' ? 'Install Package' : 'Установка пакета',
              icon: <Upload size={14} />,
            },
            {
              id: 'security',
              label: language === 'en' ? 'Security' : 'Безопасность',
              icon: <ShieldAlert size={14} className="text-amber-500" />,
            },
          ]}
          activeId={mainTab}
          onChange={(id) => setMainTab(id as any)}
          variant="segmented"
          size="sm"
        />

        <div className="flex items-center gap-2">
          {mainTab === 'catalog' && (
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => loadCatalog(true)}
              title={t.refreshCatalogTooltip}
              loading={isLoadingCatalog}
              icon={<RefreshCw size={13} />}
            />
          )}
          {mainTab === 'installed' && (
            <IconButton
              variant="ghost"
              size="sm"
              onClick={loadPlugins}
              title={t.refreshPluginsList}
              loading={isLoadingPlugins}
              icon={<RefreshCw size={13} />}
            />
          )}
        </div>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: SHOWCASE & CATALOG                                            */}
      {/* =================================================================== */}
      {mainTab === 'catalog' && (
        <div className="space-y-5">
          {/* Spotlight Banner: Featured Flagship Plugin */}
          {spotlightItem && (
            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-neutral-900/80 to-sky-950/30 p-5 shadow-lg backdrop-blur-sm">
              <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-2 max-w-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success" size="sm" className="font-semibold tracking-wider text-[9px] uppercase">
                      {language === 'en' ? 'Featured Flagship' : 'Рекомендуемый флагман'}
                    </Badge>
                    <Badge variant="neutral" size="sm" className="font-mono">
                      v{spotlightItem.version}
                    </Badge>
                    <Badge variant="accent" size="sm" className="text-[9px]">
                      {language === 'en' ? 'Embedded Agent' : 'Встроенный агент'}
                    </Badge>
                    <Badge variant="info" size="sm" className="text-[9px]">
                      Air-Gapped Ready
                    </Badge>
                  </div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Server className="w-5 h-5 text-emerald-400" />
                    <span>{spotlightItem.name}</span>
                  </h3>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {spotlightItem.locales?.[language]?.description || spotlightItem.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {['servers.yaml v2', 'SSH / SFTP', 'Zero-Trust TOTP', 'PosixRename Rollback'].map((tag) => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-gray-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="shrink-0 flex md:flex-col items-center md:items-end justify-between gap-2.5">
                  {(() => {
                    const isInstalled = pluginsList.some((p) => p.id === spotlightItem.id);
                    const installed = pluginsList.find((p) => p.id === spotlightItem.id);
                    const hasUpdate = installed && semverCompare(spotlightItem.version, installed.version) > 0;
                    const isInstallingThis = installingCatalogId === spotlightItem.id;

                    if (hasUpdate) {
                      return (
                        <Button
                          variant="primary"
                          size="md"
                          className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-md border-0 text-xs font-semibold"
                          onClick={() => handleInspectCatalogItem(spotlightItem)}
                          disabled={isInstallingThis || isInstalling}
                          loading={isInstallingThis}
                          icon={<RefreshCw size={13} className={isInstallingThis ? 'animate-spin' : ''} />}
                        >
                          {language === 'en' ? `Update to v${spotlightItem.version}` : `Обновить до v${spotlightItem.version}`}
                        </Button>
                      );
                    }
                    if (isInstalled) {
                      return (
                        <div className="flex items-center gap-2">
                          <Badge variant="success" size="md" icon={<CheckCircle2 size={13} />}>
                            {language === 'en' ? 'Installed & Active' : 'Установлен и активен'}
                          </Badge>
                          {onNavigateToPluginSettings && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onNavigateToPluginSettings(spotlightItem.id)}
                              icon={<SettingsIcon size={12} />}
                            >
                              {language === 'en' ? 'Settings' : 'Настройки'}
                            </Button>
                          )}
                        </div>
                      );
                    }
                    return (
                      <Button
                        variant="primary"
                        size="md"
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs"
                        onClick={() => handleInspectCatalogItem(spotlightItem)}
                        disabled={isInstallingThis || isInstalling}
                        loading={isInstallingThis}
                        icon={<Download size={14} />}
                      >
                        {t.installCatalogBtn}
                      </Button>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Search, Filter Bar and Counter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder={language === 'en' ? 'Search plugins, tags, capabilities...' : 'Поиск плагинов, тегов, функций...'}
                className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl bg-base-darker border border-base-border text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent transition"
              />
              {catalogSearch && (
                <button
                  onClick={() => setCatalogSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'all', label: language === 'en' ? 'All' : 'Все' },
                { id: 'official', label: language === 'en' ? 'Official' : 'Официальные' },
                { id: 'agent', label: language === 'en' ? 'Remote Agent' : 'С агентом' },
                { id: 'updates', label: `${language === 'en' ? 'Updates' : 'Обновления'}${updatesCount > 0 ? ` (${updatesCount})` : ''}` },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setCatalogFilter(f.id as any)}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-all ${
                    catalogFilter === f.id
                      ? 'bg-accent/20 border border-accent/40 text-accent-light font-semibold shadow-sm'
                      : 'bg-base-darker/60 border border-base-border/50 text-gray-400 hover:text-gray-200 hover:border-base-border'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Catalog Cards Grid */}
          {isLoadingCatalog ? (
            <div className="py-12 text-center text-gray-400 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-accent" />
              <span>{t.catalogLoading}</span>
            </div>
          ) : filteredCatalogItems.length === 0 ? (
            <EmptyState
              icon={<Search className="w-8 h-8" />}
              title={language === 'en' ? 'No plugins matched your search' : 'Плагины не найдены'}
              description={language === 'en' ? 'Try adjusting your search terms or filter criteria.' : 'Попробуйте изменить поисковый запрос или сбросить фильтры.'}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredCatalogItems.map((catItem) => {
                const isInstalled = pluginsList.some((p) => p.id === catItem.id);
                const installed = pluginsList.find((p) => p.id === catItem.id);
                const hasUpdate = installed && semverCompare(catItem.version, installed.version) > 0;
                const isInstallingThis = installingCatalogId === catItem.id;
                const hasAgent = catItem.id === 'servers' || (catItem.tags && catItem.tags.some((t) => t.toLowerCase().includes('agent')));

                return (
                  <Card
                    key={catItem.id}
                    className="p-4 flex flex-col justify-between border-base-border hover:border-gray-500/40 transition-all duration-200 bg-base-darker/30 group"
                  >
                    <div className="space-y-2.5">
                      {/* Card Header: Icon + Name + Badges */}
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:border-accent/40 group-hover:bg-accent/10 transition">
                            {getPluginIcon(catItem.id, catItem.official)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-xs text-white truncate flex items-center gap-1.5">
                              <span>{catItem.locales?.[language]?.name || catItem.name}</span>
                            </h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Badge variant="neutral" size="sm" className="font-mono text-[9px]">
                                v{catItem.version}
                              </Badge>
                              {catItem.official && (
                                <Badge variant="info" size="sm" className="text-[9px]">
                                  {t.catalogOfficialBadge}
                                </Badge>
                              )}
                              {hasAgent && (
                                <Badge variant="accent" size="sm" className="text-[9px] bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                                  <span className="flex items-center gap-1">
                                    <Zap size={10} /> Agent
                                  </span>
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status / Quick Indicator */}
                        {hasUpdate && (
                          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 shrink-0">
                            {language === 'en' ? 'Update available' : 'Доступно обновление'}
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-[11px] text-gray-400 line-clamp-3 leading-relaxed">
                        {catItem.locales?.[language]?.description || catItem.description}
                      </p>

                      {/* Tags */}
                      {catItem.tags && catItem.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          {catItem.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[9.5px] px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-gray-400 font-mono"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Card Footer: Author & Action Buttons */}
                    <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-base-border/40">
                      <span className="text-[10px] text-gray-500 truncate">
                        {catItem.author ? `${t.author}: ${catItem.author}` : 'Official Team'}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasUpdate ? (
                          <Button
                            variant="primary"
                            size="sm"
                            className="h-7 px-2.5 text-xs gap-1.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white border-0 shadow-sm font-semibold"
                            onClick={() => handleInspectCatalogItem(catItem)}
                            disabled={isInstallingThis || isInstalling}
                            loading={isInstallingThis}
                            icon={<RefreshCw size={11} className={isInstallingThis ? 'animate-spin' : ''} />}
                          >
                            {language === 'en' ? `Update to v${catItem.version}` : `Обновить до v${catItem.version}`}
                          </Button>
                        ) : isInstalled ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="success" size="sm" icon={<CheckCircle2 size={12} />}>
                              {t.catalogInstalled}
                            </Badge>
                            {onNavigateToPluginSettings && (
                              <IconButton
                                variant="ghost"
                                size="sm"
                                onClick={() => onNavigateToPluginSettings(catItem.id)}
                                icon={<SettingsIcon size={13} />}
                                title={language === 'en' ? 'Plugin settings' : 'Настройки плагина'}
                              />
                            )}
                          </div>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleInspectCatalogItem(catItem)}
                            disabled={isInstallingThis || isInstalling}
                            loading={isInstallingThis}
                            icon={<Download size={13} />}
                          >
                            {isInstallingThis ? t.installing : t.installCatalogBtn}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: INSTALLED PLUGINS                                            */}
      {/* =================================================================== */}
      {mainTab === 'installed' && (
        <div className="space-y-4">
          {/* Search Installed Bar */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={installedSearch}
                onChange={(e) => setInstalledSearch(e.target.value)}
                placeholder={language === 'en' ? 'Filter installed plugins...' : 'Фильтр установленных плагинов...'}
                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl bg-base-darker border border-base-border text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent transition"
              />
              {installedSearch && (
                <button
                  onClick={() => setInstalledSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <span className="text-xs text-gray-400">
              {language === 'en' ? 'Active plugins' : 'Активных'}: {pluginsList.filter((p) => p.enabled).length} / {pluginsList.length}
            </span>
          </div>

          {filteredInstalledPlugins.length === 0 ? (
            <EmptyState
              icon={<Package className="w-8 h-8" />}
              title={pluginsList.length === 0 ? t.noInstalledPlugins : (language === 'en' ? 'No matching plugins' : 'Нет подходящих плагинов')}
              description={t.installHelpNote}
            />
          ) : (
            <div className="space-y-2.5">
              {filteredInstalledPlugins.map((p) => (
                <Card
                  key={p.id}
                  className="p-3.5 flex items-start justify-between gap-3 hover:border-gray-500/30 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        {getPluginIcon(p.id, p.builtin)}
                      </div>
                      <span className="font-semibold text-xs text-gray-900 dark:text-white">
                        {getPluginName(p, language)}
                      </span>
                      <Badge variant="neutral" size="sm">
                        v{p.version}
                      </Badge>
                      {(() => {
                        const cat = catalogItems.find((c) => c.id === p.id);
                        if (cat && semverCompare(cat.version, p.version) > 0 && cat.downloadUrl) {
                          return (
                            <Button
                              variant="primary"
                              size="sm"
                              className="h-5 px-1.5 text-[9px] gap-1 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white border-0 shadow-sm"
                              loading={installingCatalogId === cat.id}
                              onClick={() => handleInspectCatalogItem(cat)}
                              title={language === 'en' ? `Update to v${cat.version}` : `Обновить до v${cat.version}`}
                            >
                              <RefreshCw size={9} className={installingCatalogId === cat.id ? 'animate-spin' : ''} />
                              <span>{language === 'en' ? `Update to v${cat.version}` : `Обновить до v${cat.version}`}</span>
                            </Button>
                          );
                        }
                        return null;
                      })()}
                      {p.builtin && (
                        <Badge variant="accent" size="sm">
                          {t.builtin}
                        </Badge>
                      )}
                    </div>

                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {getPluginDescription(p, language)}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {p.author && (
                        <span className="text-[10px] text-gray-400">
                          {t.author}: {p.author}
                        </span>
                      )}
                      {p.fileMatches && p.fileMatches.length > 0 && (
                        <Badge variant="neutral" size="sm" className="font-mono">
                          {p.fileMatches.join(', ')}
                        </Badge>
                      )}
                      {p.permissions && p.permissions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {p.permissions.map((perm) => {
                            const isCritical = perm.includes('exec') || perm.includes('secrets') || perm === '*';
                            const isService = perm.startsWith('service:') || perm.startsWith('service.');
                            const isKnown =
                              isCritical ||
                              isService ||
                              ['fs.read', 'fs.write', 'network', 'network.bind', 'contextmenu', 'toolbar'].includes(perm.toLowerCase()) ||
                              perm.toLowerCase().startsWith('ui.') ||
                              perm.toLowerCase().startsWith('ui:');
                            const isUnknown = !isKnown;

                            return (
                              <Badge
                                key={perm}
                                variant={isCritical || isUnknown ? 'error' : isService ? 'info' : 'accent'}
                                size="sm"
                                className="font-mono text-[9px]"
                                title={isUnknown ? 'Неизвестное разрешение вне спецификации' : undefined}
                              >
                                {isUnknown ? <span className="inline-flex items-center"><AlertTriangle className="w-2.5 h-2.5 text-amber-400 mr-1 shrink-0" />{perm}</span> : perm}
                              </Badge>
                            );
                          })}
                        </div>
                      )}

                      {p.providesServices && p.providesServices.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {p.providesServices.map((svc) => (
                            <Badge
                              key={svc}
                              variant="accent"
                              size="sm"
                              className="font-mono text-[9px]"
                              title={`Provides inter-plugin service '${svc}'`}
                            >
                              <span className="inline-flex items-center"><Zap className="w-2.5 h-2.5 text-amber-400 mr-1 shrink-0" />{svc}</span>
                            </Badge>
                          ))}
                        </div>
                      )}

                      {p.dependencies && Object.keys(p.dependencies).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {Object.entries(p.dependencies).map(([depId, ver]) => (
                            <Badge
                              key={depId}
                              variant="info"
                              size="sm"
                              className="font-mono text-[9px]"
                              title={`Requires plugin '${depId}'`}
                            >
                              <span className="inline-flex items-center"><Package className="w-2.5 h-2.5 text-sky-400 mr-1 shrink-0" />{depId} {ver ? `(${ver})` : ''}</span>
                            </Badge>
                          ))}
                        </div>
                      )}

                      {p.optionalDependencies && Object.keys(p.optionalDependencies).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {Object.entries(p.optionalDependencies).map(([depId, ver]) => (
                            <Badge
                              key={depId}
                              variant="neutral"
                              size="sm"
                              className="font-mono text-[9px] text-purple-300 border-purple-500/30 bg-purple-500/10"
                              title={`Optional extension '${depId}'`}
                            >
                              <span className="inline-flex items-center"><Layers className="w-2.5 h-2.5 text-purple-400 mr-1 shrink-0" />{depId} {ver ? `(${ver})` : ''} (опц.)</span>
                            </Badge>
                          ))}
                        </div>
                      )}

                      {p.dependents && p.dependents.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Badge
                            variant="info"
                            size="sm"
                            className="font-medium text-[9px]"
                            title="Active plugins that depend on this plugin"
                          >
                            <span className="inline-flex items-center"><Link2 className="w-2.5 h-2.5 text-indigo-400 mr-1 shrink-0" />{language === 'en' ? 'Used by:' : 'Используется:'} {p.dependents.join(', ')}</span>
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right controls */}
                  <div className="flex items-center space-x-1.5 shrink-0 pt-0.5">
                    {onNavigateToPluginSettings && (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        onClick={() => onNavigateToPluginSettings(p.id)}
                        icon={<SettingsIcon size={14} />}
                        title={language === 'en' ? 'Plugin settings' : 'Настройки плагина'}
                      />
                    )}

                    <div className="flex items-center space-x-1.5 px-1">
                      <Toggle
                        checked={p.enabled}
                        onChange={() => handleTogglePlugin(p.id, p.enabled)}
                        size="sm"
                      />
                      <span
                        className={`text-[10px] font-medium transition-colors select-none ${
                          p.enabled ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-gray-500'
                        }`}
                      >
                        {p.enabled ? t.pluginEnabled : t.pluginDisabled}
                      </span>
                    </div>

                    {!p.builtin && (
                      <IconButton
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeletePlugin(p.id, p.name)}
                        icon={<Trash2 size={13} />}
                        title={t.deletePluginTitle}
                      />
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: INSTALL FROM PACKAGE / URL                                   */}
      {/* =================================================================== */}
      {mainTab === 'install' && (
        <Card className="p-5 space-y-4">
          <SectionHeader
            icon={<Upload size={14} />}
            title={t.installPlugin}
            subtitle={language === 'en' ? 'Upload a binary .cspkg package or install directly from a Git URL' : 'Загрузите бинарный пакет .cspkg или установите напрямую по Git-ссылке'}
          />

          <div className="pb-1">
            <PillTabs
              items={[
                { id: 'zip', label: t.installZipTab, icon: <FileArchive size={13} /> },
                { id: 'url', label: t.installUrlTab, icon: <Link2 size={13} /> },
              ]}
              activeId={installTab}
              onChange={(id) => setInstallTab(id as 'zip' | 'url')}
              variant="segmented"
              size="sm"
              className="w-full sm:w-auto"
            />
          </div>

          {/* Method 1: Zip/CSPKG file dropzone */}
          {installTab === 'zip' && (
            <Dropzone
              accept=".zip,.cspkg"
              title={t.dropZipHere}
              subtitle={t.orClickToUploadZip}
              onFileSelected={handleZipFile}
              loading={isInstalling}
            />
          )}

          {/* Method 2: URL / GitHub input */}
          {installTab === 'url' && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="flex-1">
                  <Input
                    value={installUrl}
                    onChange={(e) => setInstallUrl(e.target.value)}
                    placeholder={t.pluginUrlPlaceholder}
                  />
                </div>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleInstallFromUrl}
                  disabled={isInstalling || !installUrl.trim()}
                  loading={isInstalling}
                >
                  {t.installBtn}
                </Button>
              </div>
              <p className="text-[10px] text-gray-400">
                {t.githubUrlTip}
              </p>
            </div>
          )}

          {/* Method 3: Hint on direct placement */}
          <div className="flex items-start space-x-2 pt-3 border-t border-base-border text-[11px] text-gray-400">
            <FolderOpen size={14} className="mt-0.5 shrink-0 text-accent" />
            <span>{t.directPlacementTip}</span>
          </div>

          {/* Feedback message */}
          {installMsg && (
            <Callout
              variant={installMsg.isError ? 'error' : 'success'}
              onClose={() => setInstallMsg(null)}
            >
              {installMsg.text}
            </Callout>
          )}
        </Card>
      )}

      {/* =================================================================== */}
      {/* TAB 4: SECURITY & SANDBOX                                           */}
      {/* =================================================================== */}
      {mainTab === 'security' && (
        <div className="space-y-4">
          <Callout
            variant="warning"
            icon={<ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />}
            title={
              <div className="flex items-center justify-between w-full">
                <span className="uppercase tracking-wider font-semibold text-xs">{t.unrestrictedMode}</span>
                <Toggle
                  checked={pluginExecUnrestricted}
                  onChange={setPluginExecUnrestricted}
                  size="sm"
                />
              </div>
            }
          >
            <p className="mt-1.5 text-xs leading-relaxed">{t.unrestrictedHelp}</p>
          </Callout>

          <Card className="p-4 space-y-2.5 text-xs text-gray-400">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <Layers size={14} className="text-accent" />
              <span>{language === 'en' ? 'Sandbox & Security Model' : 'Модель изоляции и безопасности плагинов'}</span>
            </h4>
            <p className="leading-relaxed">
              {language === 'en'
                ? 'All plugins in Config Studio run under zero-trust permissions inspection. Network bindings, file system access, and host process execution require explicit operator consent upon installation.'
                : 'Все плагины в Config Studio функционируют в рамках модели нулевого доверия (Zero-Trust). Доступ к файловой системе, биндирование портов и выполнение команд хоста требуют явного согласия оператора при установке.'}
            </p>
          </Card>
        </div>
      )}

      {/* Global Plugin Modals */}
      <PluginConsentModal
        isOpen={!!pendingInstall}
        pending={pendingInstall}
        onClose={handleCloseConsent}
        onConfirm={handleConfirmConsent}
        isConfirming={isConfirmingInstall}
        language={language}
        catalogItems={catalogItems}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!pluginToDelete}
        onClose={() => setPluginToDelete(null)}
        onConfirm={handleConfirmDeletePlugin}
        title={language === 'en' ? 'Delete Plugin' : 'Удаление плагина'}
        message={
          <span>
            {language === 'en'
              ? 'Are you sure you want to delete plugin '
              : 'Вы действительно хотите удалить плагин '}
            <strong className="text-white font-semibold">«{pluginToDelete?.name}»</strong>?
          </span>
        }
        confirmText={t.delete || 'Удалить'}
        cancelText={t.cancel || 'Отмена'}
        variant="danger"
        loading={isDeletingPlugin}
      />
    </div>
  );
};
