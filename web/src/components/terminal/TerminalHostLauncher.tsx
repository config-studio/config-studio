import React, { useState, useMemo } from 'react';
import { Server, Plus, Edit2, Trash2, Terminal, ArrowRight, Folder, Shield, Key } from 'lucide-react';
import { SearchInput, Button, Badge, EmptyState } from '@config-studio/ui';
import { SSHHost } from '../../types';

export interface TerminalHostLauncherProps {
  hosts: SSHHost[];
  onSelectHost: (host: SSHHost) => void;
  onAddHost: () => void;
  onEditHost: (host: SSHHost) => void;
  onDeleteHost: (host: SSHHost) => void;
  accentColor?: string;
}

export const TerminalHostLauncher: React.FC<TerminalHostLauncherProps> = ({
  hosts,
  onSelectHost,
  onAddHost,
  onEditHost,
  onDeleteHost,
  accentColor = '#00d2b4',
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredHosts = useMemo(() => {
    if (!searchQuery.trim()) return hosts;
    const q = searchQuery.toLowerCase().trim();
    return hosts.filter(
      (h) =>
        (h.name && h.name.toLowerCase().includes(q)) ||
        (h.host && h.host.toLowerCase().includes(q)) ||
        (h.user && h.user.toLowerCase().includes(q))
    );
  }, [hosts, searchQuery]);

  return (
    <div className="flex-1 w-full h-full flex flex-col overflow-hidden bg-base p-4 sm:p-5 select-none custom-scrollbar">
      {/* Top Action Toolbar (Image 2 Mockup) */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 shrink-0">
        <div className="flex items-center space-x-3">
          {/* Prominent "+ Добавить хост" Button */}
          <Button
            variant="primary"
            size="sm"
            onClick={onAddHost}
            icon={<Plus size={15} />}
          >
            Добавить хост
          </Button>

          <span className="text-xs text-[var(--text-muted)] font-medium">
            Сохраненные SSH-хосты ({hosts.length})
          </span>
        </div>

        {/* Search Input */}
        {hosts.length > 0 && (
          <div className="w-56 sm:w-64">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Поиск по имени или IP..."
            />
          </div>
        )}
      </div>

      {/* Host Cards Grid */}
      {filteredHosts.length > 0 ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
            {filteredHosts.map((host) => {
              const authBadge =
                host.authType === 'private_key'
                  ? 'key'
                  : host.authType === 'vault'
                  ? 'vault'
                  : 'pass';

              return (
                <div
                  key={host.id}
                  onClick={() => onSelectHost(host)}
                  className="group relative p-4 rounded-2xl bg-base-surface border border-base-border hover:border-accent hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between space-y-3 min-h-[135px]"
                >
                  {/* Top: Icon + Badges + Action Buttons */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className="p-2 rounded-xl bg-accent/15 text-accent shrink-0 group-hover:scale-105 transition-transform">
                        <Server size={18} />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-xs text-[var(--text-primary)] group-hover:text-accent transition-colors truncate">
                          {host.name || host.host}
                        </h4>
                        <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                          {host.user}@{host.host}:{host.port || 22}
                        </p>
                      </div>
                    </div>

                    {/* Auth Badge */}
                    <Badge variant="neutral" size="xs" className="uppercase font-mono font-bold tracking-wider shrink-0 ml-1">
                      {authBadge}
                    </Badge>
                  </div>

                  {/* Middle: Path (if set) */}
                  {host.defaultPath && (
                    <div className="flex items-center space-x-1.5 text-[11px] text-[var(--text-muted)] font-mono truncate">
                      <Folder size={11} className="shrink-0 text-accent/70" />
                      <span className="truncate">{host.defaultPath}</span>
                    </div>
                  )}

                  {/* Bottom: Connect Action & Hover Tools */}
                  <div className="flex items-center justify-between pt-2.5 border-t border-base-border/60 text-xs">
                    <span className="flex items-center space-x-1.5 text-accent font-semibold text-[11px]">
                      <Terminal size={12} />
                      <span>Подключиться</span>
                      <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                    </span>

                    {/* Quick Edit / Delete Buttons */}
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditHost(host);
                        }}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-accent hover:bg-black/10 dark:hover:bg-white/10 transition cursor-pointer"
                        title="Редактировать параметры хоста"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteHost(host);
                        }}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                        title="Удалить SSH-хост"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : hosts.length === 0 ? (
        /* Empty State: No hosts yet */
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <EmptyState
            icon={<Server size={36} />}
            title="Нет сохраненных SSH-хостов"
            description="Добавьте ваш сервер для быстрого подключения к терминалу в 1 клик, просмотра файлов по SFTP и выполнения удаленных команд."
            action={
              <Button
                variant="primary"
                size="md"
                onClick={onAddHost}
                icon={<Plus size={15} />}
              >
                Добавить первый хост
              </Button>
            }
          />
        </div>
      ) : (
        /* Search Query Has No Matches */
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <EmptyState
            title={`По запросу «${searchQuery}» хосты не найдены.`}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery('')}
              >
                Сбросить фильтр
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
};
export default TerminalHostLauncher;
