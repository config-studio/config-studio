import React from 'react';
import {
  Key,
  Shield,
  Sparkles,
  Zap,
  Eye,
  EyeOff,
  Copy,
  Edit3,
  Trash2,
  Check,
  Globe,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { SecretMeta, SecretType } from '../../../types';
import { Card, Button, Badge } from '../../ui';

interface SecretCardProps {
  item: SecretMeta;
  isRevealed: boolean;
  valueStr: string;
  isCopied: boolean;
  isRevealing: boolean;
  language: string;
  t: any;
  typeMeta: { icon: React.ReactNode; label: string };
  onToggleReveal: (item: SecretMeta) => void;
  onCopy: (item: SecretMeta) => void;
  onEdit: (item: SecretMeta) => void;
  onDelete: (item: SecretMeta) => void;
}

export const SecretCard: React.FC<SecretCardProps> = ({
  item,
  isRevealed,
  valueStr,
  isCopied,
  isRevealing,
  language,
  t,
  typeMeta,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
}) => {
  return (
    <Card className="p-4 space-y-3 hover:border-gray-500/30 transition">
      {/* Top row: Title + badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-black/5 dark:bg-black/30 border border-base-border shrink-0">
            {typeMeta.icon}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-gray-900 dark:text-white truncate">
              {item.title}
            </h4>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">
              ID: <span className="text-gray-700 dark:text-gray-300">{item.id}</span>
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
      <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/5 dark:bg-black/30 border border-base-border font-mono text-xs">
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
            onClick={() => onToggleReveal(item)}
            disabled={isRevealing}
            icon={
              isRevealing ? (
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
            onClick={() => onCopy(item)}
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
            onClick={() => onEdit(item)}
            icon={<Edit3 size={11} />}
            title={language === 'en' ? 'Edit secret' : 'Редактировать секрет'}
          />

          {/* Delete */}
          <Button
            variant="danger"
            size="sm"
            onClick={() => onDelete(item)}
            icon={<Trash2 size={11} />}
            title={t.delete}
          />
        </div>
      </div>
    </Card>
  );
};
