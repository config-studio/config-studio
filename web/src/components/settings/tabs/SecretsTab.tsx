import React, { useState, useEffect, useMemo } from 'react';
import {
  Key,
  Shield,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Unlock,
  CheckCircle2,
  Plus,
  RefreshCw,
  Sparkles,
  Eye,
  EyeOff,
  Copy,
  Edit3,
  Trash2,
  Check,
  Globe,
  Layers,
  FileCheck,
  Sliders,
  Search,
  Filter,
} from 'lucide-react';
import { SecretMeta, SecretsStatus, SecretType, SecretScope } from '../../../types';
import { api } from '../../../services/api';
import { Modal, Card, Input, Textarea, Select, Button, Badge, ScrollArea } from '../../ui';

interface SecretsTabProps {
  authEnabled: boolean;
  onNavigateToSecurity: () => void;
  language: string;
  t: any;
}

export const SecretsTab: React.FC<SecretsTabProps> = ({
  authEnabled,
  onNavigateToSecurity,
  language,
  t,
}) => {
  const [secretsList, setSecretsList] = useState<SecretMeta[]>([]);
  const [secretsStatus, setSecretsStatus] = useState<SecretsStatus | null>(null);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [copiedSecretId, setCopiedSecretId] = useState<string | null>(null);

  // Unlock Modal
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Secret Editor Modal
  const [isSecretEditorOpen, setIsSecretEditorOpen] = useState(false);
  const [editingSecretId, setEditingSecretId] = useState<string | null>(null);
  const [secretTitle, setSecretTitle] = useState('');
  const [secretId, setSecretId] = useState('');
  const [secretType, setSecretType] = useState<SecretType>('password');
  const [secretScope, setSecretScope] = useState<SecretScope>('shared');
  const [secretValue, setSecretValue] = useState('');
  const [secretEditorError, setSecretEditorError] = useState('');
  const [isSavingSecret, setIsSavingSecret] = useState(false);

  // Category Filter & Search
  const [activeCategory, setActiveCategory] = useState<'all' | SecretType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const categories = useMemo(() => [
    { id: 'all' as const, label: t.filterAll || 'Все', icon: <Layers size={12} /> },
    { id: 'password' as const, label: t.filterPasswords || 'Пароли', icon: <Key size={12} /> },
    { id: 'ssh_key' as const, label: t.filterSSHKeys || 'SSH Ключи', icon: <Shield size={12} /> },
    { id: 'token' as const, label: t.filterTokens || 'API Токены', icon: <Sparkles size={12} /> },
    { id: 'certificate' as const, label: t.filterCertificates || 'Сертификаты', icon: <FileCheck size={12} /> },
    { id: 'env' as const, label: t.filterEnv || 'Env / Окружение', icon: <Sliders size={12} /> },
    { id: 'other' as const, label: t.filterOther || 'Прочее', icon: <Lock size={12} /> },
  ], [t]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: secretsList.length };
    for (const item of secretsList) {
      map[item.type] = (map[item.type] || 0) + 1;
    }
    return map;
  }, [secretsList]);

  const filteredSecrets = useMemo(() => {
    return secretsList.filter((item) => {
      if (activeCategory !== 'all' && item.type !== activeCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchId = item.id.toLowerCase().includes(q);
        const matchPlugin = item.pluginId?.toLowerCase().includes(q);
        return matchTitle || matchId || matchPlugin;
      }
      return true;
    });
  }, [secretsList, activeCategory, searchQuery]);

  const getTypeMeta = (type: SecretType) => {
    switch (type) {
      case 'ssh_key':
        return {
          icon: <Shield className="w-3.5 h-3.5 text-sky-400" />,
          label: t.secretTypeSSHKey || 'SSH Приватный ключ',
        };
      case 'token':
        return {
          icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
          label: t.secretTypeToken || 'API Токен',
        };
      case 'certificate':
        return {
          icon: <FileCheck className="w-3.5 h-3.5 text-purple-400" />,
          label: t.secretTypeCertificate || 'Сертификат / TLS',
        };
      case 'env':
        return {
          icon: <Sliders className="w-3.5 h-3.5 text-teal-400" />,
          label: t.secretTypeEnv || 'Переменная окружения',
        };
      case 'other':
        return {
          icon: <Lock className="w-3.5 h-3.5 text-gray-400" />,
          label: t.secretTypeOther || 'Другое',
        };
      case 'password':
      default:
        return {
          icon: <Key className="w-3.5 h-3.5 text-emerald-400" />,
          label: t.secretTypePassword || 'Пароль',
        };
    }
  };

  const groupedSections = useMemo(() => {
    if (activeCategory !== 'all' || searchQuery.trim()) return null;
    const groups: { category: SecretType; label: string; icon: React.ReactNode; items: SecretMeta[] }[] = [];
    const typeOrder: SecretType[] = ['password', 'ssh_key', 'token', 'certificate', 'env', 'other'];

    for (const st of typeOrder) {
      const items = filteredSecrets.filter((s) => s.type === st);
      if (items.length > 0) {
        const cat = categories.find((c) => c.id === st);
        groups.push({
          category: st,
          label: cat?.label || st,
          icon: cat?.icon,
          items,
        });
      }
    }
    return groups;
  }, [activeCategory, searchQuery, filteredSecrets, categories]);

  const loadSecrets = async () => {
    setIsLoadingSecrets(true);
    try {
      const [status, list] = await Promise.all([
        api.getSecretsStatus(),
        api.listSecrets(),
      ]);
      setSecretsStatus(status);
      setSecretsList(list);
    } catch (err) {
      console.error('Failed to load secrets:', err);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  useEffect(() => {
    loadSecrets();
  }, []);

  const handleUnlockSecrets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPassword) return;
    setIsUnlocking(true);
    setUnlockError('');
    try {
      const res = await api.unlockSecrets(unlockPassword);
      if (res.success) {
        setIsUnlockModalOpen(false);
        setUnlockPassword('');
        await loadSecrets();
      }
    } catch (err: any) {
      setUnlockError(err.message || 'Error unlocking secrets');
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleToggleRevealSecret = async (item: SecretMeta) => {
    if (revealedSecrets[item.id] !== undefined) {
      setRevealedSecrets((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    setRevealingId(item.id);
    try {
      const value = await api.getSecretValue(item.id);
      setRevealedSecrets((prev) => ({ ...prev, [item.id]: value }));
    } catch (err: any) {
      if (err.message && err.message.includes('privileged')) {
        setIsUnlockModalOpen(true);
      } else {
        alert(`Ошибка получения секрета: ${err.message}`);
      }
    } finally {
      setRevealingId(null);
    }
  };

  const handleCopySecretValue = async (item: SecretMeta) => {
    try {
      let val = revealedSecrets[item.id];
      if (val === undefined) {
        val = await api.getSecretValue(item.id);
      }
      await navigator.clipboard.writeText(val);
      setCopiedSecretId(item.id);
      setTimeout(() => setCopiedSecretId(null), 2000);
    } catch (err: any) {
      if (err.message && err.message.includes('privileged')) {
        setIsUnlockModalOpen(true);
      } else {
        alert(`Ошибка копирования: ${err.message}`);
      }
    }
  };

  const handleOpenCreateSecret = () => {
    setEditingSecretId(null);
    setSecretTitle('');
    setSecretId('');
    setSecretType('password');
    setSecretScope('shared');
    setSecretValue('');
    setSecretEditorError('');
    setIsSecretEditorOpen(true);
  };

  const handleOpenEditSecret = async (item: SecretMeta) => {
    setEditingSecretId(item.id);
    setSecretTitle(item.title);
    setSecretId(item.id);
    setSecretType(item.type);
    setSecretScope(item.scope);
    setSecretEditorError('');

    try {
      let val = revealedSecrets[item.id];
      if (val === undefined) {
        val = await api.getSecretValue(item.id);
      }
      setSecretValue(val);
      setIsSecretEditorOpen(true);
    } catch (err: any) {
      if (err.message && err.message.includes('privileged')) {
        setIsUnlockModalOpen(true);
      } else {
        alert(`Ошибка редактирования секрета: ${err.message}`);
      }
    }
  };

  const handleDeleteSecret = async (item: SecretMeta) => {
    if (!confirm(`Вы действительно хотите удалить секрет "${item.title}"?`)) return;
    try {
      await api.deleteSecret(item.id);
      await loadSecrets();
    } catch (err: any) {
      alert(`Ошибка удаления секрета: ${err.message}`);
    }
  };

  const handleSaveSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretTitle.trim()) {
      setSecretEditorError('Название секрета обязательно');
      return;
    }
    if (!secretValue) {
      setSecretEditorError('Значение секрета обязательно');
      return;
    }

    setIsSavingSecret(true);
    setSecretEditorError('');

    try {
      await api.saveSecret({
        id: secretId.trim() || undefined,
        title: secretTitle.trim(),
        type: secretType,
        scope: secretScope,
        value: secretValue,
      });
      setIsSecretEditorOpen(false);
      await loadSecrets();
    } catch (err: any) {
      setSecretEditorError(err.message || 'Ошибка сохранения');
    } finally {
      setIsSavingSecret(false);
    }
  };

  const renderSecretCard = (item: SecretMeta) => {
    const isRevealed = revealedSecrets[item.id] !== undefined;
    const valueStr = isRevealed ? revealedSecrets[item.id] : '••••••••••••••••••••••••';
    const isCopied = copiedSecretId === item.id;
    const typeMeta = getTypeMeta(item.type);

    return (
      <Card
        key={item.id}
        className="p-4 space-y-3 hover:border-gray-500/30 transition"
      >
        {/* Top row: Title + badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-black/30 border border-base-border shrink-0">
              {typeMeta.icon}
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                {item.title}
              </h4>
              <p className="text-[10px] text-gray-400 font-mono truncate">
                ID: <span className="text-gray-300">{item.id}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            <Badge
              variant={item.scope === 'shared' ? 'info' : 'accent'}
              size="sm"
              title={
                item.scope === 'shared'
                  ? 'Общий секрет для серверов и хостов'
                  : 'Секрет конкретного плагина'
              }
            >
              {item.scope === 'shared' ? (
                <span className="inline-flex items-center">
                  <Globe className="w-2.5 h-2.5 mr-1 shrink-0" />Shared
                </span>
              ) : (
                <span className="inline-flex items-center">
                  <Layers className="w-2.5 h-2.5 mr-1 shrink-0" />
                  {item.pluginId || 'Plugin'}
                </span>
              )}
            </Badge>
            <Badge variant="neutral" size="sm">
              {typeMeta.label}
            </Badge>
          </div>
        </div>

        {/* Middle row: Masked/Revealed secret container */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-base-border font-mono text-xs">
          <div className="flex-1 truncate pr-3 select-all">
            {isRevealed ? (
              <span className="text-emerald-400 font-mono text-[11px] whitespace-pre-wrap break-all">
                {valueStr}
              </span>
            ) : (
              <span className="text-gray-500 select-none tracking-widest text-[11px]">
                {valueStr}
              </span>
            )}
          </div>
        </div>

        {/* Bottom row: Timestamps & Action buttons */}
        <div className="flex items-center justify-between pt-1 border-t border-base-border/50 text-[10px] text-gray-400">
          <div>
            {item.updatedAt && (
              <span>
                {language === 'en' ? 'Updated' : 'Обновлен'}:{' '}
                {new Date(item.updatedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {/* Reveal / Hide */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleToggleRevealSecret(item)}
              disabled={revealingId === item.id}
              icon={
                revealingId === item.id ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : isRevealed ? (
                  <EyeOff size={11} />
                ) : (
                  <Eye size={11} />
                )
              }
              title={isRevealed ? t.hideSecret : t.revealSecret}
            >
              {isRevealed ? t.hideSecret : t.revealSecret}
            </Button>

            {/* Copy value */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleCopySecretValue(item)}
              icon={
                isCopied ? (
                  <Check size={11} className="text-emerald-400" />
                ) : (
                  <Copy size={11} />
                )
              }
              title={t.copiedToClipboard}
            >
              {isCopied ? t.copied : 'Copy'}
            </Button>

            {/* Edit */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleOpenEditSecret(item)}
              icon={<Edit3 size={11} />}
              title={language === 'en' ? 'Edit secret' : 'Редактировать секрет'}
            />

            {/* Delete */}
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleDeleteSecret(item)}
              icon={<Trash2 size={11} />}
              title={t.delete}
            />
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
      {/* Header info banner */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="p-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent shrink-0">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t.secretsTitle}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t.secretsSubtitle}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <Badge variant="accent" size="md" icon={<ShieldCheck size={13} />}>
              {secretsStatus?.backend || 'Windows Credential Manager'}
            </Badge>
          </div>
        </div>

        <div className="pt-2 border-t border-base-border flex items-center space-x-2 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={13} className="shrink-0" />
          <span>{t.zeroSecretNotice}</span>
        </div>
      </Card>

      {/* Condition 1: Password protection disabled */}
      {!authEnabled && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start space-x-3.5">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              {t.authRequiredToManage}
            </h4>
            <p className="text-xs text-gray-300 leading-relaxed">
              {t.authRequiredHelp}
            </p>
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={onNavigateToSecurity}
                icon={<Shield size={13} />}
                className="text-amber-200 border-amber-500/40 hover:bg-amber-500/20"
              >
                {t.tabSecurity}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Condition 2: Password protection enabled, but Privileged Mode locked */}
      {authEnabled && !secretsStatus?.privilegedActive && (
        <Card className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-black/30 border border-base-border text-gray-400">
              <Lock size={18} />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-900 dark:text-gray-200">
                {t.privilegedLocked}
              </h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {t.privilegedLockedHelp}
              </p>
            </div>
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setUnlockError('');
              setUnlockPassword('');
              setIsUnlockModalOpen(true);
            }}
            icon={<Unlock size={14} />}
          >
            {t.unlockSecretsBtn}
          </Button>
        </Card>
      )}

      {/* Condition 3: Password protection enabled and Privileged Mode ACTIVE */}
      {authEnabled && secretsStatus?.privilegedActive && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3">
          <Badge variant="success" size="md" icon={<CheckCircle2 size={15} />}>
            {t.privilegedActiveBadge} (15m)
          </Badge>

          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenCreateSecret}
            icon={<Plus size={14} />}
          >
            {t.addSecretBtn}
          </Button>
        </div>
      )}

      {/* Secrets List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
            <Key size={14} className="text-accent" />
            <span>{t.tabSecrets} ({secretsList.length})</span>
          </label>

          <Button
            variant="ghost"
            size="sm"
            onClick={loadSecrets}
            title={t.refresh}
            icon={<RefreshCw size={13} className={isLoadingSecrets ? 'animate-spin' : ''} />}
          />
        </div>

        {/* Filter Pills + Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          {/* Categories Pill Bar */}
          <ScrollArea
            orientation="horizontal"
            className="rounded-xl bg-black/20 border border-base-border/60 p-1 flex-1 min-w-0"
            contentClassName="flex items-center gap-1.5 w-max"
          >
            {categories.map((cat) => {
              const isSelected = activeCategory === cat.id;
              const count = counts[cat.id] || 0;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  }`}
                >
                  <span className="shrink-0">{cat.icon}</span>
                  <span>{cat.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isSelected ? 'bg-black/25 text-white' : 'bg-black/30 text-gray-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </ScrollArea>

          {/* Search Input */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchSecretsPlaceholder || 'Поиск по названию или ID...'}
              className="w-full bg-black/20 border border-base-border rounded-xl pl-8 pr-7 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* List Content */}
        {isLoadingSecrets && secretsList.length === 0 ? (
          <div className="p-8 text-center text-xs text-gray-400 border border-base-border rounded-2xl bg-black/10 flex items-center justify-center space-x-2">
            <RefreshCw size={14} className="animate-spin text-accent" />
            <span>Loading secrets...</span>
          </div>
        ) : secretsList.length === 0 ? (
          <div className="p-8 text-center text-xs text-gray-400 border border-base-border rounded-2xl bg-black/10 flex flex-col items-center justify-center space-y-1.5">
            <Key className="w-8 h-8 text-gray-500 opacity-60 mb-1" />
            <span className="font-medium text-gray-300">{t.noSecretsFound}</span>
            <span className="text-[11px] text-gray-500">
              {authEnabled
                ? 'Нажмите «Добавить секрет», чтобы сохранить учетные данные в хранилище.'
                : 'Включите защиту паролем для добавления учетных данных.'}
            </span>
          </div>
        ) : filteredSecrets.length === 0 ? (
          <div className="p-8 text-center text-xs text-gray-400 border border-base-border rounded-2xl bg-black/10 flex flex-col items-center justify-center space-y-2">
            <Filter className="w-8 h-8 text-gray-500 opacity-60 mb-1" />
            <span className="font-medium text-gray-300">{t.noSecretsFoundFiltered}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setActiveCategory('all');
                setSearchQuery('');
              }}
            >
              {t.clearFilter}
            </Button>
          </div>
        ) : groupedSections ? (
          /* Grouped by categories when "Все" is selected without search filter */
          <div className="space-y-5">
            {groupedSections.map((group) => (
              <div key={group.category} className="space-y-2.5">
                <div className="flex items-center space-x-2 px-1 text-xs font-semibold text-gray-400">
                  <span className="shrink-0">{group.icon}</span>
                  <span>{group.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/20 text-gray-400 font-mono">
                    {group.items.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {group.items.map((item) => renderSecretCard(item))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Flat list for single selected category or search results */
          <div className="space-y-2.5">
            {filteredSecrets.map((item) => renderSecretCard(item))}
          </div>
        )}
      </div>

      {/* Unlock Modal */}
      <Modal
        isOpen={isUnlockModalOpen}
        onClose={() => {
          setIsUnlockModalOpen(false);
          setUnlockError('');
          setUnlockPassword('');
        }}
        size="sm"
      >
        <Modal.Header
          title={t.unlockModalTitle}
          icon={<Lock className="w-4 h-4 text-accent" />}
        />
        <form onSubmit={handleUnlockSecrets}>
          <Modal.Body className="p-5 space-y-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {t.privilegedLockedHelp}
            </p>

            <Input
              type="password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder={t.unlockPasswordPlaceholder}
              autoFocus
              error={unlockError}
            />
          </Modal.Body>

          <Modal.Footer justify="end">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setIsUnlockModalOpen(false);
                setUnlockError('');
                setUnlockPassword('');
              }}
            >
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={isUnlocking}
              disabled={!unlockPassword}
              icon={<Unlock size={12} />}
            >
              {t.unlockSubmit}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* Create / Edit Secret Modal */}
      <Modal
        isOpen={isSecretEditorOpen}
        onClose={() => {
          setIsSecretEditorOpen(false);
          setSecretEditorError('');
        }}
        size="md"
      >
        <Modal.Header
          title={editingSecretId ? t.editSecretModalTitle : t.addSecretModalTitle}
          icon={<Key className="w-4 h-4 text-accent" />}
        />

        <form onSubmit={handleSaveSecret}>
          <Modal.Body className="p-5 space-y-4">
            {/* Title */}
            <Input
              label={t.secretTitleLabel}
              value={secretTitle}
              onChange={(e) => setSecretTitle(e.target.value)}
              placeholder={t.secretTitlePlaceholder}
              autoFocus
            />

            {/* ID Identifier */}
            <Input
              label={t.secretIdLabel}
              value={secretId}
              onChange={(e) => setSecretId(e.target.value)}
              placeholder={t.secretIdPlaceholder}
              disabled={!!editingSecretId}
              className="font-mono"
              description={
                !editingSecretId
                  ? language === 'en'
                    ? 'Leave blank to generate automatically from title'
                    : 'Оставьте пустым для автогенерации из названия'
                  : undefined
              }
            />

            {/* Secret Type & Scope grid */}
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t.secretTypeLabel}
                value={secretType}
                onChange={(e) => setSecretType(e.target.value as SecretType)}
                options={[
                  { label: t.secretTypePassword, value: 'password' },
                  { label: t.secretTypeSSHKey, value: 'ssh_key' },
                  { label: t.secretTypeToken, value: 'token' },
                  { label: t.secretTypeCertificate, value: 'certificate' },
                  { label: t.secretTypeEnv, value: 'env' },
                  { label: t.secretTypeOther, value: 'other' },
                ]}
              />

              <Select
                label={t.secretScopeLabel}
                value={secretScope}
                onChange={(e) => setSecretScope(e.target.value as SecretScope)}
                options={[
                  { label: t.secretScopeShared, value: 'shared' },
                  { label: t.secretScopePlugin, value: 'plugin' },
                ]}
              />
            </div>

            {/* Secret Value */}
            {secretType === 'ssh_key' || secretType === 'certificate' || secretType === 'env' ? (
              <Textarea
                label={t.secretValueLabel}
                rows={5}
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder={
                  secretType === 'certificate'
                    ? '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'
                    : secretType === 'ssh_key'
                    ? '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'
                    : 'KEY=value\nANOTHER_KEY=value'
                }
                className="font-mono text-xs"
              />
            ) : (
              <Input
                type="password"
                label={t.secretValueLabel}
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder={t.secretValuePlaceholder}
                className="font-mono"
              />
            )}

            {secretEditorError && (
              <p className="text-[11px] text-rose-500 font-medium">{secretEditorError}</p>
            )}
          </Modal.Body>

          <Modal.Footer justify="end">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setIsSecretEditorOpen(false);
                setSecretEditorError('');
              }}
            >
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={isSavingSecret}
              icon={<Check size={12} />}
            >
              {t.saveSecretBtn}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
};
