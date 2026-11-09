import React, { useState, useEffect, useRef } from 'react';
import {
  Share2,
  Globe,
  Download,
  Upload,
  Sparkles,
  RefreshCw,
  Plus,
  Trash2,
} from 'lucide-react';
import { PluginSource, ProfilePreview } from '../../../types';
import { api } from '../../../services/api';
import { ProfileImportModal } from '../../ProfileImportModal';
import { Card, Input, Button, Toggle, Badge, ConfirmModal, EmptyState } from '../../ui';

interface ProfileTabProps {
  onReloadSettings?: () => Promise<void>;
  onReloadPlugins?: () => Promise<void>;
  language: string;
  t: any;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  onReloadSettings,
  onReloadPlugins,
  language,
  t,
}) => {
  const [sources, setSources] = useState<PluginSource[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isSyncingSources, setIsSyncingSources] = useState(false);

  const [showAddSourceForm, setShowAddSourceForm] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [isAddingSource, setIsAddingSource] = useState(false);

  // Profile Import Preview Modal
  const [isProfileImportModalOpen, setIsProfileImportModalOpen] = useState(false);
  const [profilePreview, setProfilePreview] = useState<ProfilePreview | null>(null);
  const [isImportingProfile, setIsImportingProfile] = useState(false);
  const profileFileInputRef = useRef<HTMLInputElement>(null);

  // Delete Confirm Modal
  const [sourceToDelete, setSourceToDelete] = useState<PluginSource | null>(null);
  const [isDeletingSource, setIsDeletingSource] = useState(false);

  const loadSources = async () => {
    setIsLoadingSources(true);
    try {
      const data = await api.getSources();
      setSources(data);
    } catch (err) {
      console.error('Failed to load plugin sources:', err);
    } finally {
      setIsLoadingSources(false);
    }
  };

  useEffect(() => {
    loadSources();
  }, []);

  const handleSyncSources = async () => {
    setIsSyncingSources(true);
    try {
      await api.syncSources();
      await loadSources();
      if (onReloadPlugins) await onReloadPlugins();
    } catch (err: any) {
      alert(`Ошибка синхронизации каталогов: ${err.message}`);
    } finally {
      setIsSyncingSources(false);
    }
  };

  const handleAddSource = async () => {
    if (!newSourceUrl.trim()) return;
    setIsAddingSource(true);
    try {
      await api.addSource({
        name: newSourceName.trim() || 'Custom Catalog',
        url: newSourceUrl.trim(),
      });
      setNewSourceName('');
      setNewSourceUrl('');
      setShowAddSourceForm(false);
      await loadSources();
    } catch (err: any) {
      alert(`Ошибка добавления источника: ${err.message}`);
    } finally {
      setIsAddingSource(false);
    }
  };

  const handleToggleSource = async (source: PluginSource) => {
    try {
      await api.updateSource(source.id, { enabled: !source.enabled });
      await loadSources();
    } catch (err: any) {
      alert(`Ошибка обновления источника: ${err.message}`);
    }
  };

  const handleDeleteSource = (source: PluginSource) => {
    setSourceToDelete(source);
  };

  const handleConfirmDeleteSource = async () => {
    if (!sourceToDelete) return;
    setIsDeletingSource(true);
    try {
      await api.deleteSource(sourceToDelete.id);
      await loadSources();
      setSourceToDelete(null);
    } catch (err: any) {
      alert(`Ошибка удаления источника: ${err.message}`);
    } finally {
      setIsDeletingSource(false);
    }
  };

  const handleProfileFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    try {
      const text = await file.text();
      const preview = await api.previewProfile(text);
      setProfilePreview(preview);
      setIsProfileImportModalOpen(true);
    } catch (err: any) {
      alert(`Ошибка чтения профиля: ${err.message}`);
    } finally {
      if (profileFileInputRef.current) profileFileInputRef.current.value = '';
    }
  };

  const handleConfirmImportProfile = async (options: {
    applySettings: boolean;
    importSources: boolean;
    autoInstallPlugins: boolean;
  }) => {
    if (!profilePreview) return;
    setIsImportingProfile(true);
    try {
      const res = await api.importProfile({
        profile: profilePreview.profile,
        ...options,
      });

      setIsProfileImportModalOpen(false);
      setProfilePreview(null);

      let msg = 'Профиль успешно импортирован!\n';
      if (res.settingsApplied) msg += '• Настройки внешнего вида применены.\n';
      if (res.sourcesAdded > 0) msg += `• Добавлено новых источников: ${res.sourcesAdded}\n`;
      if (res.pluginsQueued.length > 0) msg += `• Установлено плагинов: ${res.pluginsQueued.length}\n`;
      if (res.pluginsEnabled && res.pluginsEnabled.length > 0) msg += `• Включено плагинов: ${res.pluginsEnabled.length}\n`;
      if (res.errors && res.errors.length > 0) {
        msg += `\nПредупреждения:\n${res.errors.join('\n')}`;
      }
      alert(msg);

      if (onReloadSettings) await onReloadSettings();
      if (onReloadPlugins) await onReloadPlugins();
      await loadSources();
    } catch (err: any) {
      alert(`Ошибка импорта профиля: ${err.message}`);
    } finally {
      setIsImportingProfile(false);
    }
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
      {/* Card 1: 1-Click Profile Portability */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
            <Share2 size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              {t.profilePortabilityTitle}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t.profilePortabilityDesc}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <a
            href={api.getProfileExportUrl()}
            download="config-studio-profile.json"
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold bg-accent hover:brightness-105 active:scale-95 text-white shadow-xs transition-all cursor-pointer"
          >
            <Download size={14} />
            <span>{t.exportProfileBtn}</span>
          </a>

          <input
            type="file"
            ref={profileFileInputRef}
            onChange={handleProfileFileSelect}
            accept=".json"
            className="hidden"
          />
          <Button
            variant="secondary"
            size="md"
            onClick={() => profileFileInputRef.current?.click()}
            icon={<Upload size={14} />}
          >
            {t.importProfileBtn}
          </Button>

          <span className="text-[11px] text-teal-400/90 font-medium flex items-center gap-1.5 ml-auto">
            <Sparkles size={12} />
            {t.secretsExcludedNote}
          </span>
        </div>
      </Card>

      {/* Card 2: Trusted Plugin Sources & Repositories */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Globe size={16} className="text-accent" />
              <span>{t.sourcesTitle}</span>
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t.sourcesDesc}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSyncSources}
              disabled={isSyncingSources}
              loading={isSyncingSources}
              icon={<RefreshCw size={12} />}
            >
              {isSyncingSources ? t.syncingSources : t.syncSources}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAddSourceForm(!showAddSourceForm)}
              icon={<Plus size={12} />}
            >
              {t.addSourceBtn}
            </Button>
          </div>
        </div>

        {/* Add Source Inline Form */}
        {showAddSourceForm && (
          <Card className="p-4 border-accent/40 bg-accent/5 space-y-3 animate-in fade-in duration-100">
            <h4 className="text-xs font-bold text-gray-900 dark:text-white">
              {t.addSourceTitle}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t.sourceNameLabel}
                type="text"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder={t.sourceNamePlaceholder}
              />
              <Input
                label={t.sourceUrlLabel}
                type="text"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                placeholder="https://raw.githubusercontent.com/.../registry.json"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddSourceForm(false)}
              >
                {t.cancel}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddSource}
                disabled={!newSourceUrl.trim() || isAddingSource}
                loading={isAddingSource}
              >
                {isAddingSource ? t.addingSource : t.saveSourceBtn}
              </Button>
            </div>
          </Card>
        )}

        {/* Sources List */}
        <div className="space-y-2">
          {isLoadingSources ? (
            <EmptyState
              loading={true}
              loadingText={t.loadingSources}
              bordered={false}
              className="py-8"
            />
          ) : sources.length === 0 ? (
            <EmptyState
              description={t.noSources}
              bordered={false}
              className="py-8"
            />
          ) : (
            sources.map((s) => (
              <Card
                key={s.id}
                className="p-3.5 flex items-center justify-between gap-4"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <Toggle
                    checked={s.enabled}
                    onChange={() => handleToggleSource(s)}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-900 dark:text-white truncate">
                        {s.name}
                      </span>
                      {s.official ? (
                        <Badge variant="accent" size="sm">
                          {t.officialBadge}
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          {t.communityBadge}
                        </Badge>
                      )}
                      <span className="text-[11px] text-gray-400 font-mono">
                        ({s.pluginsCount} {t.pluginsCountSuffix})
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 font-mono truncate mt-0.5 max-w-xl">
                      {s.url}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  {s.lastSync && (
                    <span className="text-[10px] text-gray-400 font-mono hidden md:inline">
                      {t.syncedPrefix} {new Date(s.lastSync).toLocaleTimeString(language === 'en' ? 'en-US' : 'ru-RU')}
                    </span>
                  )}
                  {!s.official && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSource(s)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                      title={t.deleteSourceTitle}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>

      <ProfileImportModal
        isOpen={isProfileImportModalOpen}
        preview={profilePreview}
        isImporting={isImportingProfile}
        language={language}
        onClose={() => {
          setIsProfileImportModalOpen(false);
          setProfilePreview(null);
        }}
        onConfirm={handleConfirmImportProfile}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!sourceToDelete}
        onClose={() => setSourceToDelete(null)}
        onConfirm={handleConfirmDeleteSource}
        title="Удаление источника плагинов"
        message={
          <span>
            Вы уверены, что хотите удалить источник плагинов{' '}
            <strong className="text-white font-semibold">«{sourceToDelete?.name}»</strong>?
          </span>
        }
        confirmText="Удалить"
        variant="danger"
        loading={isDeletingSource}
      />
    </div>
  );
};
