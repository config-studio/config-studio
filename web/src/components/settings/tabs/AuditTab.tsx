import React, { useState, useEffect } from 'react';
import {
  ScrollText,
  Search,
  Download,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  Info,
  ShieldAlert,
  User,
  Globe,
  Cpu,
} from 'lucide-react';
import { AuditEvent } from '../../../types';
import { api } from '../../../services/api';
import { telemetry } from '../../../services/telemetry';
import { ScrollArea, Card, Input, Button, Badge } from '../../ui';

interface AuditTabProps {
  t: any;
}

export const AuditTab: React.FC<AuditTabProps> = ({ t }) => {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSeverity, setAuditSeverity] = useState<string>('');
  const [auditCategory, setAuditCategory] = useState<string>('');
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [isExportingAudit, setIsExportingAudit] = useState(false);
  const [copiedAiAudit, setCopiedAiAudit] = useState(false);

  const loadAuditLogs = async (
    sev = auditSeverity,
    query = auditSearch,
    cat = auditCategory
  ) => {
    setAuditLoading(true);
    try {
      const res = await api.getAuditLogs({
        severity: sev || undefined,
        category: cat || undefined,
        search: query.trim() || undefined,
        limit: 100,
      });
      setAuditEvents(res.events || []);
      setAuditTotal(res.total || 0);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, []);

  const handleExportAuditLogs = async () => {
    setIsExportingAudit(true);
    try {
      const blob = await api.exportAuditLogs();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `config-studio-audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Ошибка экспорта логов: ${err.message}`);
    } finally {
      setIsExportingAudit(false);
    }
  };

  const handleCopyAiReport = async () => {
    const ok = await telemetry.copyDiagnosticReport();
    if (ok) {
      setCopiedAiAudit(true);
      setTimeout(() => setCopiedAiAudit(false), 2000);
    }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-base-border">
        <div>
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
            <ScrollText size={15} className="text-accent" />
            <span>{t.auditTitle}</span>
          </label>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
            {t.auditDesc}
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {/* Copy AI Report button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyAiReport}
            title={t.auditCopyAi}
            icon={copiedAiAudit ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            className="text-teal-400 border-teal-500/30 hover:bg-teal-500/20"
          >
            {copiedAiAudit ? t.auditCopied : t.auditCopyAi}
          </Button>

          {/* Export button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportAuditLogs}
            disabled={isExportingAudit}
            title={t.auditExport}
            icon={<Download size={13} className={`text-accent ${isExportingAudit ? 'animate-bounce' : ''}`} />}
          >
            {isExportingAudit ? t.auditExporting : t.auditExport}
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex flex-col sm:flex-row gap-2.5">
          {/* Search input */}
          <div className="flex-1">
            <Input
              value={auditSearch}
              onChange={(e) => {
                setAuditSearch(e.target.value);
                loadAuditLogs(auditSeverity, e.target.value, auditCategory);
              }}
              placeholder={t.auditSearchPlaceholder}
              icon={<Search size={14} />}
            />
          </div>

          {/* Severity Filter Pills */}
          <div className="flex items-center space-x-1 p-1 bg-black/10 dark:bg-black/30 rounded-xl border border-base-border shrink-0">
            <button
              type="button"
              onClick={() => {
                setAuditSeverity('');
                loadAuditLogs('', auditSearch, auditCategory);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                auditSeverity === ''
                  ? 'bg-base-surface text-accent shadow-xs'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.auditFilterAll}
            </button>
            <button
              type="button"
              onClick={() => {
                setAuditSeverity('critical');
                loadAuditLogs('critical', auditSearch, auditCategory);
              }}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer ${
                auditSeverity === 'critical'
                  ? 'bg-red-500/20 text-red-700 dark:text-red-400 font-semibold shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
              <span>{t.auditSeverityCritical}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuditSeverity('warn');
                loadAuditLogs('warn', auditSearch, auditCategory);
              }}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer ${
                auditSeverity === 'warn'
                  ? 'bg-amber-500/20 text-amber-800 dark:text-amber-400 font-semibold shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-amber-800 dark:hover:text-amber-400'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{t.auditSeverityWarn}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuditSeverity('info');
                loadAuditLogs('info', auditSearch, auditCategory);
              }}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer ${
                auditSeverity === 'info'
                  ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400 font-semibold shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400'
              }`}
            >
              <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>{t.auditSeverityInfo}</span>
            </button>
          </div>

          {/* Refresh button */}
          <Button
            variant="secondary"
            size="md"
            onClick={() => loadAuditLogs()}
            disabled={auditLoading}
            title={t.auditRefresh}
            icon={<RefreshCw size={14} className={auditLoading ? 'animate-spin text-accent' : ''} />}
          />
        </div>

        {/* Category Filter Pills with Mouse Wheel Horizontal Scrolling */}
        <ScrollArea
          orientation="horizontal"
          horizontalWheel
          className="py-0.5 select-none"
          contentClassName="flex items-center gap-1.5 text-xs"
        >
          <span className="text-[11px] text-gray-500 dark:text-gray-400 mr-1 shrink-0">{t.auditCategoryAll}:</span>
          <button
            type="button"
            onClick={() => {
              setAuditCategory('');
              loadAuditLogs(auditSeverity, auditSearch, '');
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer shrink-0 ${
              auditCategory === ''
                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                : 'text-gray-400 hover:text-white bg-black/5 dark:bg-white/5'
            }`}
          >
            Все
          </button>
          <button
            type="button"
            onClick={() => {
              setAuditCategory('error');
              loadAuditLogs(auditSeverity, auditSearch, 'error');
            }}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer shrink-0 ${
              auditCategory === 'error'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'text-gray-400 hover:text-rose-300 bg-black/5 dark:bg-white/5'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>{t.auditCatError || 'Ошибки'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuditCategory('user');
              loadAuditLogs(auditSeverity, auditSearch, 'user');
            }}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer shrink-0 ${
              auditCategory === 'user'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-gray-400 hover:text-emerald-300 bg-black/5 dark:bg-white/5'
            }`}
          >
            <User className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{t.auditCatUser || 'Действия'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuditCategory('network');
              loadAuditLogs(auditSeverity, auditSearch, 'network');
            }}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer shrink-0 ${
              auditCategory === 'network'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                : 'text-gray-400 hover:text-indigo-300 bg-black/5 dark:bg-white/5'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{t.auditCatNetwork || 'Сеть'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuditCategory('system');
              loadAuditLogs(auditSeverity, auditSearch, 'system');
            }}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer shrink-0 ${
              auditCategory === 'system'
                ? 'bg-slate-700/60 text-slate-200 border border-slate-600'
                : 'text-gray-400 hover:text-slate-300 bg-black/5 dark:bg-white/5'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-slate-300 shrink-0" />
            <span>{t.auditCatSystem || 'Система'}</span>
          </button>
        </ScrollArea>
      </div>

      {/* Total Count and Status */}
      <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 px-1">
        <span>{t.auditTotal}: {auditTotal}</span>
        {auditLoading && <span className="text-accent">{t.auditRefreshing}</span>}
      </div>

      {/* Events List */}
      {auditEvents.length === 0 ? (
        <Card className="p-8 text-center space-y-2">
          <ScrollText className="w-8 h-8 text-gray-400 mx-auto opacity-40" />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {auditSearch || auditSeverity ? t.auditNoMatches : t.auditEmpty}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {auditEvents.map((evt) => {
            const isExpanded = expandedAuditId === evt.id;
            const dateStr = new Date(evt.timestamp).toLocaleString();
            const isCritical = evt.severity === 'critical';
            const isWarn = evt.severity === 'warn';

            const catVariant =
              evt.category === 'error' || evt.severity === 'error'
                ? 'error'
                : evt.category === 'network'
                ? 'info'
                : evt.category === 'system'
                ? 'neutral'
                : 'success';

            const sevVariant = isCritical ? 'error' : isWarn ? 'warning' : 'info';

            return (
              <Card
                key={evt.id}
                className={`p-3 transition ${
                  isCritical
                    ? 'bg-red-500/5 border-red-500/30'
                    : isWarn
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : 'bg-black/10 dark:bg-black/25 hover:border-gray-500/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    {/* Category badge */}
                    <Badge variant={catVariant} size="sm" className="uppercase font-bold tracking-wider">
                      {evt.category || 'user'}
                    </Badge>

                    {/* Severity badge */}
                    <Badge variant={sevVariant} size="sm" className="uppercase font-bold tracking-wider">
                      {evt.severity}
                    </Badge>

                    {/* Action badge */}
                    <Badge variant="neutral" size="sm" className="font-mono font-medium">
                      {evt.action}
                    </Badge>

                    {/* Target */}
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 font-mono">
                      {evt.target}
                    </span>
                  </div>

                  {/* Timestamp & User */}
                  <div className="text-right shrink-0 text-[10px] text-gray-600 dark:text-gray-400">
                    <div>{dateStr}</div>
                    <div className="text-gray-500 dark:text-gray-400 font-mono">
                      {evt.user} {evt.source ? `[${evt.source}]` : ''} {evt.ip ? `(${evt.ip})` : ''}
                    </div>
                  </div>
                </div>

                {/* Details toggler */}
                {evt.details && Object.keys(evt.details).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-base-border/50">
                    <button
                      type="button"
                      onClick={() => setExpandedAuditId(isExpanded ? null : evt.id)}
                      className="text-[10px] text-accent hover:underline flex items-center space-x-1 cursor-pointer"
                    >
                      <span>{isExpanded ? t.hideDetails : t.showDetails}</span>
                    </button>

                    {isExpanded && (
                      <pre className="mt-1.5 p-2 rounded-lg bg-black/40 border border-base-border text-[10px] font-mono text-gray-300 overflow-x-auto max-h-36 custom-scrollbar">
                        {JSON.stringify(evt.details, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
