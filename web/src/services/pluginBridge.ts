import { api, setRemoteEndpoint } from './api';
import { sshHostService } from './sshHosts';
import { sysinfoService, formatBytes, formatUptime } from './sysinfo';
import { telemetry } from './telemetry';
import { logStreamService, OpenLogStreamOptions } from './logStream';
import { mountDropdown } from '../components/ui/vanillaDropdown';
import {
  PluginItem,
  OpenFile,
  OpenFileOptions,
  ToolbarButtonDef,
  SplitPanelDef,
  HeaderItemDef,
  ProcessInfo,
  OutlineNode,
  ContextMenuItem,
  ContextMenuTarget,
  SecretItem,
  SSHHost,
} from '../types';
import { contextMenuRegistry } from './contextMenuRegistry';
import {
  registerPluginLocales,
  unregisterPluginLocales,
  getPluginT,
  registerLanguagePack,
  unregisterLanguagePack,
  LanguagePack,
} from '../utils/i18n';
import type { PluginLoader, BottomPanelDef } from './pluginLoader';

export function setupGlobalAPI(mgr: PluginLoader): void {
  const bridge: any = {
      registerToolbarButton: (btn: ToolbarButtonDef) => {
        // PLUGIN-002: Inherit fileMatches from plugin manifest if button omitted them
        if ((!btn.fileMatches || btn.fileMatches.length === 0) && btn.pluginId) {
          const plugin = mgr.plugins.find((p) => p.id === btn.pluginId);
          if (plugin?.fileMatches && plugin.fileMatches.length > 0) {
            btn.fileMatches = [...plugin.fileMatches];
          }
        }
        mgr.toolbarButtons = mgr.toolbarButtons.filter((b) => b.id !== btn.id);
        mgr.toolbarButtons.push(btn);
        mgr.notify();
      },

      registerSplitPanel: (panel: SplitPanelDef) => {
        mgr.splitPanels = mgr.splitPanels.filter((p) => p.id !== panel.id);
        mgr.splitPanels.push(panel);
        mgr.notify();
      },

      toggleSplitPanel: (panelDef: Partial<SplitPanelDef> & { id: string }) => {
        let existing = mgr.splitPanels.find((p) => p.id === panelDef.id);
        if (!existing && panelDef.render) {
          existing = {
            id: panelDef.id,
            pluginId: panelDef.pluginId || 'unknown',
            title: panelDef.title || 'Panel',
            icon: panelDef.icon,
            port: panelDef.port,
            url: panelDef.url,
            refreshOnSave: panelDef.refreshOnSave,
            onReload: panelDef.onReload,
            open: panelDef.open !== undefined ? panelDef.open : true,
            render: panelDef.render,
          };
          mgr.splitPanels.push(existing);
        } else if (existing) {
          if (panelDef.open !== undefined) {
            existing.open = panelDef.open;
          } else {
            existing.open = !existing.open;
          }
          if (panelDef.title) existing.title = panelDef.title;
          if (panelDef.icon) existing.icon = panelDef.icon;
          if (panelDef.port !== undefined) existing.port = panelDef.port;
          if (panelDef.url) existing.url = panelDef.url;
          if (panelDef.refreshOnSave !== undefined) existing.refreshOnSave = panelDef.refreshOnSave;
          if (panelDef.onReload) existing.onReload = panelDef.onReload;
          if (panelDef.render) existing.render = panelDef.render;
        }

        if (existing && existing.open) {
          mgr.activeSplitPanelId = existing.id;
        } else if (mgr.activeSplitPanelId === panelDef.id) {
          const remaining = mgr.splitPanels.find((p) => p.id !== panelDef.id && p.open);
          mgr.activeSplitPanelId = remaining ? remaining.id : null;
        }
        mgr.notify();
      },

      registerSplitWebview: (def: {
        id: string;
        pluginId: string;
        title: string;
        url: string;
        icon?: string;
        port?: number;
        refreshOnSave?: boolean;
        open?: boolean;
      }) => {
        let iframeEl: HTMLIFrameElement | null = null;
        const currentUrl = def.url;

        const renderWebview = (container: HTMLElement) => {
          container.innerHTML = '';
          const wrapper = document.createElement('div');
          wrapper.className = 'w-full h-full flex flex-col bg-base overflow-hidden relative';

          iframeEl = document.createElement('iframe');
          iframeEl.src = currentUrl;
          iframeEl.className = 'w-full h-full border-none flex-1';
          iframeEl.setAttribute('allow', 'cross-origin-isolated; autoplay; clipboard-write; encrypted-media; fullscreen');

          wrapper.appendChild(iframeEl);
          container.appendChild(wrapper);
        };

        const panelDef: SplitPanelDef = {
          id: def.id,
          pluginId: def.pluginId,
          title: def.title,
          icon: def.icon,
          port: def.port,
          url: def.url,
          refreshOnSave: def.refreshOnSave !== false,
          open: def.open ?? true,
          render: renderWebview,
          onReload: () => {
            if (iframeEl) {
              iframeEl.src = iframeEl.src;
            }
          },
        };

        mgr.splitPanels = mgr.splitPanels.filter((p) => p.id !== panelDef.id);
        mgr.splitPanels.push(panelDef);
        if (panelDef.open) {
          mgr.activeSplitPanelId = panelDef.id;
        }
        mgr.notify();
      },

      toggleSplitWebview: (id: string, updates?: any) => {
        const existing = mgr.splitPanels.find((p) => p.id === id);
        if (existing) {
          (window as any).ConfigStudio.toggleSplitPanel({ id, ...updates });
        } else if (updates && updates.url && updates.title) {
          (window as any).ConfigStudio.registerSplitWebview({
            id,
            pluginId: updates.pluginId || 'unknown',
            title: updates.title,
            url: updates.url,
            ...updates,
          });
        }
      },

      closeSplitWebview: (id?: string) => {
        const targetId = id || mgr.activeSplitPanelId;
        if (targetId) {
          mgr.closeSplitPanel(targetId);
        }
      },

      reloadSplitWebview: (id?: string) => {
        const targetId = id || mgr.activeSplitPanelId;
        if (targetId) {
          const panel = mgr.splitPanels.find((p) => p.id === targetId);
          if (panel && typeof panel.onReload === 'function') {
            panel.onReload();
          }
        }
      },

      setActiveSplitPanel: (panelId: string) => {
        mgr.setActiveSplitPanel(panelId);
      },

      registerBottomPanel: (panel: BottomPanelDef) => {
        mgr.bottomPanels = mgr.bottomPanels.filter((p) => p.id !== panel.id);
        mgr.bottomPanels.push(panel);
        mgr.notify();
      },

      toggleBottomPanel: (panelDef: Partial<BottomPanelDef> & { id: string }) => {
        let existing = mgr.bottomPanels.find((p) => p.id === panelDef.id);
        if (!existing && panelDef.render) {
          existing = {
            id: panelDef.id,
            pluginId: panelDef.pluginId || 'unknown',
            title: panelDef.title || 'Bottom Panel',
            open: true,
            render: panelDef.render,
          };
          mgr.bottomPanels.push(existing);
        } else if (existing) {
          if (panelDef.open !== undefined) {
            existing.open = panelDef.open;
          } else {
            existing.open = !existing.open;
          }
          if (panelDef.render) existing.render = panelDef.render;
        }

        mgr.activeBottomPanelId = existing && existing.open ? existing.id : null;
        mgr.notify();
      },

      registerHeaderItem: (item: HeaderItemDef) => {
        mgr.headerItems = mgr.headerItems.filter((h) => h.id !== item.id);
        mgr.headerItems.push(item);
        mgr.notify();
      },

      onFileOpen: (cb: (file: OpenFile) => void) => {
        mgr.onFileOpenCallbacks.push(cb);
      },

      onFileSave: (cb: (file: OpenFile) => void) => {
        mgr.onFileSaveCallbacks.push(cb);
      },

      getActiveFile: () => mgr.activeFileGetter(),
      getActiveContent: () => mgr.activeFileGetter()?.content || '',
      setActiveContent: (content: string) => mgr.activeContentSetter(content),

      getMonaco: () => mgr.monacoInstance,
      getEditor: () => mgr.editorInstance,
      registerCompletionProvider: (language: string, provider: any) => {
        if (mgr.monacoInstance) {
          return mgr.monacoInstance.languages.registerCompletionItemProvider(language, provider);
        }
        mgr.queuedCompletionProviders.push({ language, provider });
        return null;
      },

      registerOutlineProvider: (provider: {
        language: string;
        parse: (content: string, filename: string) => OutlineNode[];
      }) => {
        if (provider && provider.language && provider.parse) {
          const origParse = provider.parse;
          const safeParse = (content: string, filename: string): OutlineNode[] => {
            try {
              const raw = origParse(content, filename) || [];
              const normalize = (nodes: any[]): OutlineNode[] => {
                return (nodes || []).map((n, idx) => ({
                  id: n.id || `node_${idx}_${Math.random().toString(36).substring(2, 7)}`,
                  label: n.label || n.name || 'node',
                  type: n.type || n.kind || 'section',
                  line: typeof n.line === 'number' ? n.line : 1,
                  value: n.value,
                  children: n.children && n.children.length > 0 ? normalize(n.children) : undefined,
                }));
              };
              return normalize(raw);
            } catch (err) {
              console.error(`[PluginLoader] Error in outline provider for ${provider.language}:`, err);
              return [];
            }
          };
          const lang = provider.language.toLowerCase();
          mgr.outlineProviders.set(lang, safeParse);
          if (lang === 'yaml') {
            mgr.outlineProviders.set('yml', safeParse);
          } else if (lang === 'yml') {
            mgr.outlineProviders.set('yaml', safeParse);
          }
          console.log(`[PluginLoader] Registered custom outline provider for ${provider.language}`);
          mgr.notify();
        }
      },

      openFile: async (path: string, options?: OpenFileOptions) => {
        await mgr.openFileHandler(path, options);
      },
      createFile: async (path: string, content?: string) => {
        await mgr.createFileHandler(path, content);
      },
      refreshFiles: async () => {
        await mgr.refreshFilesHandler();
      },
      openCustomTab: async (tab: {
        path: string;
        name: string;
        content: string;
        language?: string;
        readOnly?: boolean;
        badge?: string;
        onSave?: (content: string) => Promise<void>;
      }) => {
        await mgr.openCustomTabHandler(tab);
      },

      fs: {
        batchRead: async (req: {
          root?: string;
          paths?: string[];
          patterns?: string[];
          pattern?: string;
          maxFiles?: number;
          maxSizeBytes?: number;
        }) => api.batchReadFiles(req),
        readFile: async (path: string, root?: string) => {
          const res = await api.getFile(path, root);
          return res.content;
        },
      },
      batchReadFiles: async (req: {
        root?: string;
        paths?: string[];
        patterns?: string[];
        pattern?: string;
        maxFiles?: number;
        maxSizeBytes?: number;
      }) => api.batchReadFiles(req),
      sftpBatchRead: async (req: Parameters<typeof api.sftpBatchRead>[0]) => api.sftpBatchRead(req),

      showNotification: (msg: string, type?: 'info' | 'success' | 'error') => {
        mgr.notificationHandler(msg, type);
      },

      showToast: (msg: string, type?: 'info' | 'success' | 'error') => {
        mgr.notificationHandler(msg, type);
      },

      openTerminal: (host?: any) => {
        window.dispatchEvent(new CustomEvent('cs:open-ssh-terminal', { detail: host }));
      },

      openSftp: (host?: any) => {
        window.dispatchEvent(new CustomEvent('cs:open-sftp-host', { detail: host }));
      },

      ssh: {
        list: () => sshHostService.list(),
        get: (id: string) => sshHostService.get(id),
        save: (host: SSHHost) => sshHostService.save(host),
        delete: (id: string) => sshHostService.delete(id),
        getLastActiveHostId: () => sshHostService.getLastActiveHostId(),
        setLastActiveHostId: (id: string) => sshHostService.setLastActiveHostId(id),
        getLastSftpPath: (hostId: string) => sshHostService.getLastSftpPath(hostId),
        setLastSftpPath: (hostId: string, path: string) => sshHostService.setLastSftpPath(hostId, path),
        subscribe: (cb: (hosts: SSHHost[]) => void) => sshHostService.subscribe(cb),
        reload: () => sshHostService.reload(),
        exportOpenSSH: () => sshHostService.exportOpenSSH(),
        importOpenSSH: (content: string) => sshHostService.importOpenSSH(content),
        exportPortableSecrets: (passphrase: string) => sshHostService.exportPortableSecrets(passphrase),
        importPortableSecrets: (file: Blob, passphrase: string) => sshHostService.importPortableSecrets(file, passphrase),
      },

      setRemoteEndpoint: (url: string | null, token?: string) => {
        setRemoteEndpoint(url, token);
      },

      exec: async (req: {
        pluginId: string;
        command: string;
        args?: string[];
        cwd?: string;
      }) => {
        try {
          const res = await api.execPluginCommand(
            req.pluginId,
            req.command,
            req.args || [],
            req.cwd,
            false
          );
          if (res.requiresConfirm) {
            const ok = await mgr.confirmHandler(
              `${req.command} ${(req.args || []).join(' ')}`
            );
            if (!ok) throw new Error('Command execution denied by user');
            return await api.execPluginCommand(
              req.pluginId,
              req.command,
              req.args || [],
              req.cwd,
              true
            );
          }
          return res;
        } catch (err: any) {
          throw err;
        }
      },

      startProcess: async (req: {
        pluginId: string;
        command: string;
        args?: string[];
        cwd?: string;
        port?: number;
      }) => {
        try {
          return await api.startPluginProcess(
            req.pluginId,
            req.command,
            req.args || [],
            req.cwd,
            req.port,
            false
          );
        } catch (err: any) {
          if (err.message && err.message.includes('needs confirmation')) {
            const ok = await mgr.confirmHandler(
              `${req.command} ${(req.args || []).join(' ')}`
            );
            if (!ok) throw new Error('Process launch denied by user');
            return await api.startPluginProcess(
              req.pluginId,
              req.command,
              req.args || [],
              req.cwd,
              req.port,
              true
            );
          }
          throw err;
        }
      },

      stopProcess: async (procId: string) => {
        await api.stopPluginProcess(procId);
      },

      getLanguage: () => mgr.currentLanguage,
      i18n: {
        getLanguage: () => mgr.currentLanguage,
        onLanguageChange: (cb: (lang: string) => void) => {
          mgr.languageChangeCallbacks.add(cb);
          try {
            cb(mgr.currentLanguage);
          } catch (e) {
            console.error(e);
          }
          return () => mgr.languageChangeCallbacks.delete(cb);
        },
        registerLocales: (pluginId: string, locales: Record<string, Record<string, string>>) => {
          registerPluginLocales(pluginId, locales);
        },
        registerLanguagePack: (pack: LanguagePack) => {
          registerLanguagePack(pack);
        },
        t: (pluginId: string, key: string, fallback?: string, params?: Record<string, any>) => {
          return getPluginT(pluginId, mgr.currentLanguage)(key, fallback, params);
        },
        scoped: (pluginId: string) => {
          const fn = (key: string, fallback?: string, params?: Record<string, any>) =>
            getPluginT(pluginId, mgr.currentLanguage)(key, fallback, params);

          return Object.assign(fn, {
            t: fn,
            getLanguage: () => mgr.currentLanguage,
            onLanguageChange: (cb: (lang: string) => void) => {
              mgr.languageChangeCallbacks.add(cb);
              try {
                cb(mgr.currentLanguage);
              } catch (e) {
                console.error(e);
              }
              return () => mgr.languageChangeCallbacks.delete(cb);
            },
          });
        },
      },

      services: {
        register: (serviceName: string, implementation: any, providerPluginId: string) => {
          if (!serviceName || !implementation || !providerPluginId) {
            throw new Error('[Services] register requires serviceName, implementation, and providerPluginId');
          }
          const provider = mgr.plugins.find((p) => p.id === providerPluginId);
          if (!provider) {
            console.warn(`[Services] Provider plugin '${providerPluginId}' not found in active plugins list`);
          } else if (!provider.providesServices?.includes(serviceName)) {
            console.warn(`[Services] Plugin '${providerPluginId}' did not declare providesServices: ['${serviceName}'] in its manifest`);
          }
          mgr.registeredServices.set(serviceName, {
            serviceName,
            providerPluginId,
            implementation,
          });
          console.log(`[Services] Registered inter-plugin service '${serviceName}' from provider '${providerPluginId}'`);
        },

        get: async (serviceName: string, consumerPluginId: string) => {
          if (!serviceName || !consumerPluginId) {
            throw new Error('[Services] get requires serviceName and consumerPluginId');
          }

          const reg = mgr.registeredServices.get(serviceName);
          if (!reg) {
            throw new Error(`[Services] Service '${serviceName}' is not registered or provider is inactive`);
          }

          const consumer = mgr.plugins.find((p) => p.id === consumerPluginId);
          if (!consumer) {
            throw new Error(`[Services] Consumer plugin '${consumerPluginId}' not found`);
          }

          // 1. Dependency validation: consumer must declare provider in dependencies or optionalDependencies
          const hasHardDep =
            consumer.dependencies &&
            Object.prototype.hasOwnProperty.call(consumer.dependencies, reg.providerPluginId);
          const hasOptDep =
            consumer.optionalDependencies &&
            Object.prototype.hasOwnProperty.call(consumer.optionalDependencies, reg.providerPluginId);
          if (!hasHardDep && !hasOptDep) {
            throw new Error(
              `[Services] Security violation: Plugin '${consumerPluginId}' cannot access service '${serviceName}'. Missing dependency '${reg.providerPluginId}' in manifest.dependencies or manifest.optionalDependencies`
            );
          }

          // 2. Permission validation: consumer must have permission service:<name> or service.<name> or service:*
          const hasPerm = consumer.permissions?.some(
            (p) =>
              p === `service:${serviceName}` ||
              p === `service.${serviceName}` ||
              p === 'service:*'
          );
          if (!hasPerm) {
            throw new Error(
              `[Services] Security violation: Plugin '${consumerPluginId}' lacks permission 'service:${serviceName}' in manifest.permissions`
            );
          }

          // 3. Security Proxy wrapper
          const target = reg.implementation;
          return new Proxy(target, {
            get(obj, prop, receiver) {
              const orig = Reflect.get(obj, prop, receiver);
              if (typeof orig === 'function') {
                return async (...args: any[]) => {
                  try {
                    return await orig.apply(obj, args);
                  } catch (err: any) {
                    console.error(
                      `[Services] Error calling ${serviceName}.${String(prop)} from ${consumerPluginId}:`,
                      err
                    );
                    throw err;
                  }
                };
              }
              return orig;
            },
          });
        },

        has: (serviceName: string) => {
          return mgr.registeredServices.has(serviceName);
        },

        getOptional: async (serviceName: string, consumerPluginId: string) => {
          if (!serviceName || !consumerPluginId) {
            return null;
          }
          if (!mgr.registeredServices.has(serviceName)) {
            return null;
          }
          try {
            return await (window as any).ConfigStudio.services.get(serviceName, consumerPluginId);
          } catch {
            return null;
          }
        },

        list: () => {
          return Array.from(mgr.registeredServices.keys());
        },
      },

      registerContextMenu: (item: ContextMenuItem) => {
        return contextMenuRegistry.register(item);
      },

      contextMenu: {
        register: (item: ContextMenuItem) => contextMenuRegistry.register(item),
        unregister: (id: string) => contextMenuRegistry.unregister(id),
        getItemsForTarget: (target: ContextMenuTarget) =>
          contextMenuRegistry.getItemsForTarget(target),
      },

      secrets: {
        get: async (id: string) => api.getSecretValue(id),
        set: async (item: SecretItem) => api.saveSecret(item),
        delete: async (id: string) => api.deleteSecret(id),
        listShared: async () => api.listSharedSecrets(),
        list: async () => api.listSecrets(),
        getStatus: async () => api.getSecretsStatus(),
        unlock: async (password: string) => {
          const res = await api.unlockSecrets(password);
          return res.success;
        },
      },

      registerPluginSettings: (pluginId: string, def: { render: (container: HTMLElement) => void }) => {
        if (pluginId && def?.render) {
          mgr.pluginSettingsPanels.set(pluginId, def.render);
        }
      },
      getPluginSettings: (pluginId: string) => api.getPluginSettings(pluginId),
      savePluginSettings: (pluginId: string, settings: Record<string, any>) => api.savePluginSettings(pluginId, settings),
      ui: {
        toast: (message: string, type?: 'info' | 'success' | 'error' | 'warning', title?: string) => {
          mgr.notificationHandler(message, type as any);
        },
        renderDropdown: (container: HTMLElement, config: any) => {
          return mountDropdown(container, config);
        },
      },
      sysinfo: {
        get: () => sysinfoService.getState().metrics,
        getState: () => sysinfoService.getState(),
        refresh: () => sysinfoService.refresh(),
        setActiveNode: (id: string, name: string) => sysinfoService.setActiveNode(id, name),
        subscribe: (cb: (state: any) => void) => sysinfoService.subscribe(cb),
        formatBytes: formatBytes,
        formatUptime: formatUptime,
      },
      telemetry: {
        captureError: (err: Error, context?: Record<string, any>) => telemetry.captureError(err, context),
        log: (action: string, details?: Record<string, any>, severity?: 'info' | 'warn' | 'critical') =>
          telemetry.record({ action, details, severity: severity as any, source: 'plugin' }),
      },
      logs: {
        openStream: (opts: OpenLogStreamOptions) => {
          const id = logStreamService.openStream(opts);
          window.dispatchEvent(new CustomEvent('cs:open-log-stream', { detail: opts }));
          return id;
        },
        closeStream: (id: string) => logStreamService.closeStream(id),
        getSessions: () => logStreamService.getSessions(),
        clear: (id: string) => logStreamService.clear(id),
        reconnect: (id: string) => logStreamService.reconnect(id),
        subscribe: (cb: (sessions: any[], activeId: string) => void) => logStreamService.subscribe(cb),
      },
    };

  // Secure sandbox: freeze bridge methods against malicious prototype tampering
  try {
    Object.freeze(bridge.fs);
    Object.freeze(bridge.ssh);
    Object.freeze(bridge.services);
    Object.freeze(bridge.contextMenu);
    Object.freeze(bridge.secrets);
    Object.freeze(bridge.ui);
    Object.freeze(bridge.sysinfo);
    Object.freeze(bridge.telemetry);
    Object.freeze(bridge.logs);
  } catch (err) {
    console.warn('[PluginBridge] Could not freeze some bridge namespaces:', err);
  }

  (window as any).ConfigStudio = bridge;
}
