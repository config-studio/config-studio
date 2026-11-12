import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Link2,
  Layers,
  Zap,
  Terminal,
  Globe,
  Key,
  Server,
  Edit3,
  Sparkles,
} from 'lucide-react';
import { PendingInstall, CatalogItem } from '../types';
import { getPluginName, getPluginDescription } from '../utils/i18n';
import { Modal, Button, Badge, Callout, Checkbox } from './ui';

interface PluginConsentModalProps {
  pending: PendingInstall | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedOptionalDeps?: string[]) => Promise<void>;
  isConfirming: boolean;
  language?: string;
  catalogItems?: CatalogItem[];
}

interface PermMeta {
  label: string;
  desc: string;
  risk: 'safe' | 'low' | 'medium' | 'critical';
  riskLabel: string;
  icon: React.ReactNode;
  isUnknown?: boolean;
}

function getPermissionMeta(perm: string, lang: string = 'ru'): PermMeta {
  const isEn = lang === 'en';
  if (!perm || typeof perm !== 'string') {
    return {
      label: 'Invalid Permission',
      desc: isEn ? 'Malformed or empty permission declaration' : 'Некорректное или пустое объявление разрешения',
      risk: 'critical',
      riskLabel: isEn ? 'Invalid / Critical' : 'Ошибка / Критический риск',
      icon: <ShieldAlert size={16} className="text-rose-400" />,
      isUnknown: true,
    };
  }

  const normalized = perm.trim().toLowerCase();

  switch (normalized) {
    case '*':
      return {
        label: isEn ? 'Full Unrestricted Access (*)' : 'Полный неограниченный доступ (*)',
        desc: isEn
          ? 'Grants unlimited access to all system, terminal, secrets, and files'
          : 'Предоставляет неограниченный доступ ко всей системе, терминалу, секретам и файлам',
        risk: 'critical',
        riskLabel: isEn ? 'Critical (Full Access)' : 'Критический (Полный доступ)',
        icon: <ShieldAlert size={16} className="text-rose-500" />,
      };
    case 'fs.read':
    case 'fs:read':
      return {
        label: isEn ? 'Read project files' : 'Чтение файлов проекта',
        desc: isEn
          ? 'View configuration and file contents in the working directory'
          : 'Просмотр содержимого конфигураций и файлов в рабочей директории',
        risk: 'low',
        riskLabel: isEn ? 'Low risk' : 'Низкий риск',
        icon: <FileText size={16} className="text-blue-400" />,
      };
    case 'fs.write':
    case 'fs:write':
      return {
        label: isEn ? 'Write & modify files' : 'Запись и изменение файлов',
        desc: isEn
          ? 'Create, edit, and overwrite configuration files'
          : 'Создание, редактирование и перезапись файлов конфигурации',
        risk: 'medium',
        riskLabel: isEn ? 'Medium risk' : 'Средний риск',
        icon: <Edit3 size={16} className="text-amber-400" />,
      };
    case 'shell.exec':
    case 'terminal.exec':
    case 'process:exec':
      return {
        label: isEn ? 'Execute host terminal commands' : 'Выполнение консольных команд на хосте',
        desc: isEn
          ? 'Run CLI utilities (make, docker, git) and OS processes'
          : 'Запуск CLI-утилит (make, docker, git) и системных процессов в ОС',
        risk: 'critical',
        riskLabel: isEn ? 'High risk' : 'Высокий риск',
        icon: <Terminal size={16} className="text-rose-400" />,
      };
    case 'remote.exec':
      return {
        label: isEn ? 'Remote command execution (SSH)' : 'Удаленное выполнение команд (SSH)',
        desc: isEn
          ? 'Initiate commands and sync configs on remote servers'
          : 'Инициация команд и синхронизация конфигов на удаленных серверах',
        risk: 'critical',
        riskLabel: isEn ? 'High risk' : 'Высокий риск',
        icon: <Server size={16} className="text-rose-400" />,
      };
    case 'network':
    case 'network.bind':
    case 'network:listen':
    case 'network:fetch':
      return {
        label: isEn ? 'Network access & local servers' : 'Сетевой доступ и локальные серверы',
        desc: isEn
          ? 'Start embedded web servers and send network requests'
          : 'Запуск встроенных веб-серверов и отправка сетевых запросов',
        risk: 'medium',
        riskLabel: isEn ? 'Medium risk' : 'Средний риск',
        icon: <Globe size={16} className="text-amber-400" />,
      };
    case 'secrets':
    case 'secrets.access':
      return {
        label: isEn ? 'Access protected credentials' : 'Доступ к защищенным учетным данным',
        desc: isEn
          ? 'Read tokens, access keys, and SSH passwords'
          : 'Чтение токенов, ключей доступа и SSH-паролей',
        risk: 'critical',
        riskLabel: isEn ? 'Critical risk' : 'Критический риск',
        icon: <Key size={16} className="text-rose-400" />,
      };
    case 'contextmenu':
      return {
        label: isEn ? 'File explorer context menu' : 'Контекстное меню проводника',
        desc: isEn
          ? 'Add custom actions to the file explorer right-click menu'
          : 'Добавление пользовательских действий в контекстное меню проводника файлов',
        risk: 'safe',
        riskLabel: isEn ? 'Safe' : 'Безопасно',
        icon: <Layers size={16} className="text-emerald-400" />,
      };
    case 'toolbar':
    case 'ui:toolbar-button':
      return {
        label: isEn ? 'Action toolbar integration' : 'Интеграция в панель действий (Toolbar)',
        desc: isEn
          ? 'Add 1-click action buttons and dropdowns to the top toolbar'
          : 'Добавление кнопок быстрых действий в верхнюю панель инструментов',
        risk: 'safe',
        riskLabel: isEn ? 'Safe' : 'Безопасно',
        icon: <Layers size={16} className="text-emerald-400" />,
      };
    default:
      if (normalized.startsWith('service:') || normalized.startsWith('service.')) {
        const svc = perm.replace(/^service[:.]/i, '');
        return {
          label: isEn ? `Inter-plugin Service: ${svc}` : `Межплагинный сервис: ${svc}`,
          desc: isEn
            ? `Calls '${svc}' API methods exposed by dependency plugin`
            : `Вызовы API методов сервиса '${svc}', предоставляемого зависимым плагином`,
          risk: 'medium',
          riskLabel: isEn ? 'Medium risk' : 'Средний риск',
          icon: <Layers size={16} className="text-teal-400" />,
        };
      }
      if (normalized.startsWith('ui.') || normalized.startsWith('ui:')) {
        return {
          label: isEn ? `Interface: ${perm}` : `Интерфейс: ${perm}`,
          desc: isEn
            ? 'Embed panels, buttons, and tabs into Config Studio UI'
            : 'Встраивание панелей, кнопок и вкладок в интерфейс Config Studio',
          risk: 'safe',
          riskLabel: isEn ? 'Safe' : 'Безопасно',
          icon: <Layers size={16} className="text-emerald-400" />,
        };
      }
      return {
        label: isEn ? `Unknown Permission: ${perm}` : `Неизвестное разрешение: ${perm}`,
        desc: isEn
          ? 'Unrecognized capability not defined in Config Studio specification. Exercise extreme caution!'
          : 'Нераспознанное ядром разрешение вне официальной спецификации Config Studio. Требуется предельное внимание!',
        risk: 'critical',
        riskLabel: isEn ? 'Unknown / High Risk' : 'Неизвестно / Высокий риск',
        icon: <ShieldAlert size={16} className="text-rose-400" />,
        isUnknown: true,
      };
  }
}

export const PluginConsentModal: React.FC<PluginConsentModalProps> = ({
  pending,
  isOpen,
  onClose,
  onConfirm,
  isConfirming,
  language = 'ru',
  catalogItems = [],
}) => {
  const [selectedOptionalDeps, setSelectedOptionalDeps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!pending || !isOpen) {
      setSelectedOptionalDeps({});
      return;
    }
    const initial: Record<string, boolean> = {};
    const optIssues = (pending.dependencyIssues || []).filter((i) => i.optional);
    for (const issue of optIssues) {
      const catItem = catalogItems?.find((c) => c.id === issue.pluginId);
      const canInstall = !!catItem?.downloadUrl || issue.status === 'disabled';
      if (canInstall) {
        initial[issue.pluginId] = true;
      }
    }
    setSelectedOptionalDeps(initial);
  }, [pending, isOpen, catalogItems]);

  if (!isOpen || !pending) return null;

  const isEn = language === 'en';
  const permissions = pending.manifest.permissions || (pending.manifest as any).capabilities || [];
  const metas = permissions.map((p) => getPermissionMeta(p, language));
  const hasCritical = metas.some((m) => m?.risk === 'critical');
  const hasUnknown = metas.some((m) => m?.isUnknown);

  const hardIssues = (pending.dependencyIssues || []).filter((i) => !i.optional);
  const optIssues = (pending.dependencyIssues || []).filter((i) => i.optional);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={
          <div
            className={`p-2 rounded-xl ${
              hasCritical
                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                : pending.isOfficial
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-accent/15 text-accent border border-accent/30'
            }`}
          >
            {hasCritical ? <ShieldAlert size={22} /> : <ShieldCheck size={22} />}
          </div>
        }
        title={isEn ? 'Plugin Permission Request' : 'Запрос разрешений плагина'}
        subtitle={
          isEn
            ? 'Review requested permissions before installing in Config Studio'
            : 'Проверьте запрашиваемые права перед установкой в Config Studio'
        }
        badge={
          pending.isOfficial ? (
            <Badge variant="success" size="sm">Official</Badge>
          ) : (
            <Badge variant="warning" size="sm">Community</Badge>
          )
        }
        onClose={onClose}
      />

      <Modal.Body className="p-5 sm:p-6 space-y-4">
        {/* Plugin Identification Card */}
        <div className="p-4 bg-black/25 border border-base-border rounded-xl space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-100 text-base">
                  {getPluginName(pending.manifest, language)}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[11px] bg-black/40 text-gray-300 font-mono border border-base-border">
                  v{pending.manifest.version}
                </span>
              </div>
              {pending.manifest.author && (
                <div className="text-xs text-gray-400 mt-0.5">
                  {isEn ? 'Author:' : 'Автор:'}{' '}
                  <span className="text-gray-300 font-medium">
                    {pending.manifest.author}
                  </span>
                </div>
              )}
            </div>

            {pending.isOfficial ? (
              <Badge variant="success" size="sm">Verified Official</Badge>
            ) : (
              <Badge variant="warning" size="sm">Community</Badge>
            )}
          </div>

          {pending.manifest.description && (
            <p className="text-xs text-gray-400 leading-relaxed pt-1">
              {getPluginDescription(pending.manifest, language)}
            </p>
          )}

          {pending.manifest.fileMatches && pending.manifest.fileMatches.length > 0 && (
            <div className="flex items-center gap-1.5 pt-2 text-xs text-gray-400">
              <span className="text-gray-400">
                {isEn ? 'File associations:' : 'Ассоциации файлов:'}
              </span>
              <div className="flex flex-wrap gap-1">
                {pending.manifest.fileMatches.map((m) => (
                  <Badge key={m} variant="accent" size="xs" className="font-mono">
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {pending.manifest.dependencies && Object.keys(pending.manifest.dependencies).length > 0 && (
            <div className="flex items-center gap-1.5 pt-2 text-xs text-gray-400">
              <span className="text-gray-400">{isEn ? 'Dependencies:' : 'Зависимости:'}</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(pending.manifest.dependencies).map(([depId, ver]) => (
                  <Badge key={depId} variant="info" size="xs" className="font-mono">
                    <span className="inline-flex items-center"><Link2 className="w-2.5 h-2.5 mr-1 shrink-0" />{depId} {ver ? `(${ver})` : ''}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {pending.manifest.optionalDependencies && Object.keys(pending.manifest.optionalDependencies).length > 0 && (
            <div className="flex items-center gap-1.5 pt-1.5 text-xs text-gray-400">
              <span className="text-gray-400">{isEn ? 'Optional extensions:' : 'Опциональные:'}</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(pending.manifest.optionalDependencies).map(([depId, ver]) => (
                  <Badge key={depId} variant="neutral" size="xs" className="font-mono text-purple-700 dark:text-purple-300">
                    <span className="inline-flex items-center"><Layers className="w-2.5 h-2.5 mr-1 shrink-0" />{depId} {ver ? `(${ver})` : ''}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {pending.manifest.providesServices && pending.manifest.providesServices.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-gray-400">
              <span className="text-gray-400">{isEn ? 'Provides services:' : 'Предоставляет сервисы:'}</span>
              <div className="flex flex-wrap gap-1">
                {pending.manifest.providesServices.map((svc) => (
                  <Badge key={svc} variant="accent" size="xs" className="font-mono">
                    <span className="inline-flex items-center"><Zap className="w-2.5 h-2.5 mr-1 shrink-0" />{svc}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Required Missing / Incompatible Dependencies Alert */}
        {hardIssues.length > 0 && (
          <Callout
            variant="warning"
            title={isEn ? 'Required plugin dependencies:' : 'Требуются обязательные зависимости:'}
            icon={<AlertTriangle size={15} className="shrink-0" />}
          >
            <div className="space-y-1.5 mt-1">
              {hardIssues.map((issue) => (
                <div key={issue.pluginId} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-[var(--text-primary)]">{issue.pluginId}</span>
                  <span className="text-[10px] opacity-75">({issue.required || '*'})</span>
                  <Badge variant="warning" size="xs">
                    {issue.status === 'missing'
                      ? (isEn ? 'Not installed' : 'Не установлен')
                      : issue.status === 'disabled'
                      ? (isEn ? 'Disabled' : 'Отключен')
                      : (isEn ? 'Incompatible version' : 'Несовместимая версия')}
                  </Badge>
                </div>
              ))}
            </div>
          </Callout>
        )}

        {/* Optional / Recommended Dependencies with 1-Click Install Checkboxes */}
        {optIssues.length > 0 && (
          <Callout
            variant="accent"
            icon={<Sparkles size={15} className="text-purple-500 shrink-0" />}
            title={
              <div className="flex items-center justify-between w-full">
                <span>{isEn ? 'Recommended extensions (optional):' : 'Рекомендуемые расширения (опционально):'}</span>
                <span className="text-[10px] opacity-75 font-normal">
                  {isEn ? 'Can be installed together' : 'Можно установить вместе'}
                </span>
              </div>
            }
          >
            <div className="space-y-2 mt-2">
              {optIssues.map((issue) => {
                const catItem = catalogItems?.find((c) => c.id === issue.pluginId);
                const canInstall = !!catItem?.downloadUrl || issue.status === 'disabled';
                const isChecked = selectedOptionalDeps[issue.pluginId] ?? canInstall;

                return (
                  <div
                    key={issue.pluginId}
                    className={`p-2.5 rounded-xl border transition ${
                      isChecked
                        ? 'bg-purple-500/15 border-purple-500/40'
                        : 'bg-black/5 dark:bg-black/20 border-base-border opacity-80'
                    }`}
                  >
                    <Checkbox
                      checked={isChecked}
                      disabled={!canInstall}
                      onChange={(checked) =>
                        setSelectedOptionalDeps((prev) => ({
                          ...prev,
                          [issue.pluginId]: checked,
                        }))
                      }
                      label={
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-[var(--text-primary)]">
                            {catItem?.name || issue.pluginId}
                          </span>
                          <span className="font-mono text-[10px] text-purple-600 dark:text-purple-300">
                            ({issue.required || '*'})
                          </span>
                          <Badge variant="neutral" size="xs">
                            {issue.status === 'disabled'
                              ? (isEn ? 'Installed (disabled)' : 'Установлен (выключен)')
                              : catItem
                              ? (isEn ? 'Available in catalog' : 'Доступен в каталоге')
                              : (isEn ? 'Not found in catalog' : 'Нет в каталоге')}
                          </Badge>
                        </div>
                      }
                      description={catItem?.description}
                    />
                  </div>
                );
              })}
            </div>
          </Callout>
        )}

        {/* Capabilities & Permissions Checklist */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              {isEn ? `Requested capabilities (${permissions.length})` : `Запрашиваемые возможности (${permissions.length})`}
            </h3>
            {hasCritical && (
              <span className="text-[11px] font-medium text-rose-400 flex items-center gap-1">
                <AlertTriangle size={12} /> {isEn ? 'Attention required' : 'Требуется внимание'}
              </span>
            )}
          </div>

          {permissions.length === 0 ? (
            <div className="p-3 bg-black/20 border border-base-border rounded-xl text-xs text-gray-400 flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
              <span>
                {isEn
                  ? 'Plugin requires no system permissions (visual UI only).'
                  : 'Плагин не требует системных привилегий (только визуальный интерфейс).'}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {metas.map((meta, idx) => {
                const isCrit = meta.risk === 'critical';
                const isMed = meta.risk === 'medium';
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                      meta.isUnknown
                        ? 'bg-rose-500/10 border-rose-500/30'
                        : isCrit
                        ? 'bg-rose-500/10 border-rose-500/30'
                        : isMed
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-black/5 dark:bg-black/25 border-base-border'
                    }`}
                  >
                    <div className="p-1.5 rounded-lg bg-black/5 dark:bg-black/30 border border-base-border shrink-0 mt-0.5">
                      {meta.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          {meta.label}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium border ${
                            meta.isUnknown
                              ? 'bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-500/30 font-bold'
                              : isCrit
                              ? 'bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-500/30'
                              : isMed
                              ? 'bg-amber-500/20 text-amber-900 dark:text-amber-300 border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-800 dark:text-blue-300 border-blue-500/30'
                          }`}
                        >
                          {meta.riskLabel}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                        {meta.desc}
                      </p>
                      <div className="mt-1 text-[10px] font-mono text-gray-500">
                        {permissions[idx]}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Security notice for unknown / unrecognized permissions */}
        {hasUnknown && (
          <Callout
            variant="critical"
            title={isEn ? 'Security Warning: Unknown Capabilities Requested' : 'Предупреждение безопасности: Неизвестные разрешения'}
          >
            {isEn
              ? 'This plugin requests permissions outside the Config Studio specification. In accordance with Fail-Secure / Zero Trust principles, unrecognized permissions are treated as Critical Risk.'
              : 'Плагин запрашивает привилегии, отсутствующие в спецификации Config Studio. В соответствии с принципом Fail-Secure / Zero Trust любые неизвестные разрешения классифицируются как Критический риск.'}
          </Callout>
        )}

        {/* Warning notice if high-risk permissions */}
        {hasCritical && !hasUnknown && (
          <Callout
            variant="error"
            title={isEn ? 'Elevated Permissions Requested' : 'Запрос расширенных прав'}
          >
            {isEn
              ? 'This plugin requests elevated permissions to execute host commands. Only install if you trust the source.'
              : 'Плагин запрашивает расширенные права на исполнение команд в системе хоста. Устанавливайте этот плагин только в том случае, если вы доверяете источнику и понимаете последствия.'}
          </Callout>
        )}

        {!pending.isOfficial && !hasCritical && (
          <Callout
            variant="warning"
          >
            {isEn
              ? 'This plugin is by a third-party author and is not in the verified official catalog.'
              : 'Плагин разработан сторонним автором и не входит в официальный каталог верифицированных расширений.'}
          </Callout>
        )}
      </Modal.Body>

      <Modal.Footer justify="end">
        <Button
          variant="secondary"
          size="sm"
          onClick={onClose}
          disabled={isConfirming}
        >
          {isEn ? 'Reject' : 'Отклонить'}
        </Button>

        <Button
          variant={hasCritical ? 'danger' : 'primary'}
          size="sm"
          onClick={() => {
            const toInstall = Object.keys(selectedOptionalDeps).filter((k) => selectedOptionalDeps[k]);
            onConfirm(toInstall);
          }}
          disabled={isConfirming}
          loading={isConfirming}
        >
          {isEn ? 'Allow & Install' : 'Разрешить и установить'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
