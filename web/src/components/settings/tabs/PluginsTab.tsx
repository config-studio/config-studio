import React, { useState, useEffect, useRef } from 'react';
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

  const loadCatalog = async () => {
    setIsLoadingCatalog(true);
    try {
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
    loadCatalog();
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

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
      {/* Host Command Execution Security ("I know what I'm doing" mode) */}
      <Callout
        variant="warning"
        icon={<ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />}
        title={
          <div className="flex items-center justify-between w-full">
            <span className="uppercase tracking-wider">{t.unrestrictedMode}</span>
            <Toggle
              checked={pluginExecUnrestricted}
              onChange={setPluginExecUnrestricted}
              size="sm"
            />
          </div>
        }
      >
        <p className="mt-1">{t.unrestrictedHelp}</p>
      </Callout>

      {/* Installed Plugins List */}
      <div>
        <SectionHeader
          icon={<Package size={14} />}
          title={t.installedPlugins}
          rightElement={
            <IconButton
              variant="ghost"
              size="sm"
              onClick={loadPlugins}
              title={t.refreshPluginsList}
              loading={isLoadingPlugins}
              icon={<RefreshCw size={13} />}
            />
          }
          className="mb-3"
        />

        {pluginsList.length === 0 ? (
          <EmptyState
            icon={<Package className="w-8 h-8" />}
            title={t.noInstalledPlugins}
            description={t.installHelpNote}
          />
        ) : (
          <div className="space-y-2.5">
            {pluginsList.map((p) => (
              <Card
                key={p.id}
                className="p-3.5 flex items-start justify-between gap-3 hover:border-gray-500/30 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-xs text-gray-900 dark:text-white">
                      {getPluginName(p, language)}
                    </span>
                    <Badge variant="neutral" size="sm">
                      v{p.version}
                    </Badge>
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

      {/* Official & Remote Plugins Catalog */}
      <Card className="p-4 space-y-3">
        <SectionHeader
          icon={<Sparkles size={14} />}
          title={t.catalogTitle}
          subtitle={t.catalogSubtitle}
          rightElement={
            <IconButton
              variant="ghost"
              size="sm"
              onClick={loadCatalog}
              title={t.refreshCatalogTooltip}
              loading={isLoadingCatalog}
              icon={<RefreshCw size={13} />}
            />
          }
        />

        {catalogItems.length === 0 ? (
          <EmptyState
            loading={isLoadingCatalog}
            loadingText={t.catalogLoading}
            title={!isLoadingCatalog ? t.catalogEmpty : undefined}
            bordered={false}
          />
        ) : (
          <div className="space-y-2">
            {catalogItems.map((catItem) => {
              const isInstalled = pluginsList.some((p) => p.id === catItem.id);
              const isInstallingThis = installingCatalogId === catItem.id;

              return (
                <div
                  key={catItem.id}
                  className="p-3 rounded-xl border border-base-border bg-black/10 flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-xs text-gray-900 dark:text-white">
                        {catItem.name}
                      </span>
                      <Badge variant="neutral" size="sm">
                        v{catItem.version}
                      </Badge>
                      {catItem.official && (
                        <Badge variant="info" size="sm">
                          {t.catalogOfficialBadge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {catItem.description}
                    </p>
                  </div>

                  <div>
                    {isInstalled ? (
                      <Badge variant="success" size="sm" icon={<CheckCircle2 size={13} />}>
                        {t.catalogInstalled}
                      </Badge>
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
              );
            })}
          </div>
        )}
      </Card>

      {/* Install New Plugin Section (Zip vs URL) */}
      <Card className="p-4 space-y-3">
        <SectionHeader
          icon={<Upload size={14} />}
          title={t.installPlugin}
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
        <div className="flex items-start space-x-2 pt-2 border-t border-base-border text-[11px] text-gray-400">
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
