import { api, setRemoteEndpoint } from './api';
import { telemetry } from './telemetry';
import {
  PluginItem,
  OpenFile,
  ToolbarButtonDef,
  SplitPanelDef,
  HeaderItemDef,
  ProcessInfo,
  OutlineNode,
  ContextMenuItem,
  ContextMenuTarget,
  SecretItem,
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

export interface BottomPanelDef {
  id: string;
  pluginId: string;
  title: string;
  icon?: string;
  badge?: string | number;
  open: boolean;
  render: (container: HTMLElement) => void;
  onShow?: () => void;
  onHide?: () => void;
  onResize?: (width: number, height: number) => void;
}

export interface PluginSystemState {
  plugins: PluginItem[];
  toolbarButtons: ToolbarButtonDef[];
  splitPanels: SplitPanelDef[];
  bottomPanels: BottomPanelDef[];
  headerItems: HeaderItemDef[];
  activeSplitPanelId: string | null;
  activeBottomPanelId: string | null;
}

type Listener = (state: PluginSystemState) => void;

class PluginLoader {
  private plugins: PluginItem[] = [];
  private toolbarButtons: ToolbarButtonDef[] = [];
  private splitPanels: SplitPanelDef[] = [];
  private bottomPanels: BottomPanelDef[] = [];
  private headerItems: HeaderItemDef[] = [];
  private activeSplitPanelId: string | null = null;
  private activeBottomPanelId: string | null = null;
  private currentLanguage: string = 'ru';
  private languageChangeCallbacks: Set<(lang: string) => void> = new Set();
  private registeredServices: Map<
    string,
    { serviceName: string; providerPluginId: string; implementation: any }
  > = new Map();

  private onFileOpenCallbacks: Array<(file: OpenFile) => void> = [];
  private onFileSaveCallbacks: Array<(file: OpenFile) => void> = [];

  private listeners: Set<Listener> = new Set();
  private activeFileGetter: () => OpenFile | null = () => null;
  private activeContentSetter: (content: string) => void = () => {};
  private notificationHandler: (msg: string, type?: 'info' | 'success' | 'error') => void = (m) => alert(m);
  private confirmHandler: (command: string) => Promise<boolean> = async () => true;

  private monacoInstance: any = null;
  private editorInstance: any = null;
  private loadedPluginIds: Set<string> = new Set();
  private queuedCompletionProviders: Array<{ language: string; provider: any }> = [];
  private outlineProviders: Map<string, (content: string, filename: string) => OutlineNode[]> = new Map();
  private pluginSettingsPanels: Map<string, (container: HTMLElement) => void> = new Map();

  getPluginSettingsRenderer(pluginId: string) {
    return this.pluginSettingsPanels.get(pluginId);
  }

  private openFileHandler: (path: string) => Promise<void> = async () => {};
  private createFileHandler: (path: string, content?: string) => Promise<void> = async () => {};
  private refreshFilesHandler: () => Promise<void> = async () => {};
  private openCustomTabHandler: (tab: any) => Promise<void> = async () => {};

  getOutlineProvider(languageOrExt: string) {
    if (!languageOrExt) return undefined;
    return this.outlineProviders.get(languageOrExt.toLowerCase());
  }

  constructor() {
    this.setupGlobalAPI();
  }

  setMonacoInstances(monaco: any, editor: any) {
    this.monacoInstance = monaco;
    this.editorInstance = editor;

    if (this.monacoInstance && this.queuedCompletionProviders.length > 0) {
      for (const item of this.queuedCompletionProviders) {
        try {
          this.monacoInstance.languages.registerCompletionItemProvider(item.language, item.provider);
          console.log(`[PluginLoader] Registered completion provider for ${item.language}`);
        } catch (e) {
          console.error(`[PluginLoader] Error registering completion provider for ${item.language}:`, e);
        }
      }
      this.queuedCompletionProviders = [];
    }
  }

  private setupGlobalAPI() {
    (window as any).ConfigStudio = {
      registerToolbarButton: (btn: ToolbarButtonDef) => {
        this.toolbarButtons = this.toolbarButtons.filter((b) => b.id !== btn.id);
        this.toolbarButtons.push(btn);
        this.notify();
      },

      registerSplitPanel: (panel: SplitPanelDef) => {
        this.splitPanels = this.splitPanels.filter((p) => p.id !== panel.id);
        this.splitPanels.push(panel);
        this.notify();
      },

      toggleSplitPanel: (panelDef: Partial<SplitPanelDef> & { id: string }) => {
        let existing = this.splitPanels.find((p) => p.id === panelDef.id);
        if (!existing && panelDef.render) {
          existing = {
            id: panelDef.id,
            pluginId: panelDef.pluginId || 'unknown',
            title: panelDef.title || 'Panel',
            open: true,
            render: panelDef.render,
          };
          this.splitPanels.push(existing);
        } else if (existing) {
          if (panelDef.open !== undefined) {
            existing.open = panelDef.open;
          } else {
            existing.open = !existing.open;
          }
          if (panelDef.render) existing.render = panelDef.render;
        }

        this.activeSplitPanelId = existing && existing.open ? existing.id : null;
        this.notify();
      },

      registerBottomPanel: (panel: BottomPanelDef) => {
        this.bottomPanels = this.bottomPanels.filter((p) => p.id !== panel.id);
        this.bottomPanels.push(panel);
        this.notify();
      },

      toggleBottomPanel: (panelDef: Partial<BottomPanelDef> & { id: string }) => {
        let existing = this.bottomPanels.find((p) => p.id === panelDef.id);
        if (!existing && panelDef.render) {
          existing = {
            id: panelDef.id,
            pluginId: panelDef.pluginId || 'unknown',
            title: panelDef.title || 'Bottom Panel',
            open: true,
            render: panelDef.render,
          };
          this.bottomPanels.push(existing);
        } else if (existing) {
          if (panelDef.open !== undefined) {
            existing.open = panelDef.open;
          } else {
            existing.open = !existing.open;
          }
          if (panelDef.render) existing.render = panelDef.render;
        }

        this.activeBottomPanelId = existing && existing.open ? existing.id : null;
        this.notify();
      },

      registerHeaderItem: (item: HeaderItemDef) => {
        this.headerItems = this.headerItems.filter((h) => h.id !== item.id);
        this.headerItems.push(item);
        this.notify();
      },

      onFileOpen: (cb: (file: OpenFile) => void) => {
        this.onFileOpenCallbacks.push(cb);
      },

      onFileSave: (cb: (file: OpenFile) => void) => {
        this.onFileSaveCallbacks.push(cb);
      },

      getActiveFile: () => this.activeFileGetter(),
      getActiveContent: () => this.activeFileGetter()?.content || '',
      setActiveContent: (content: string) => this.activeContentSetter(content),

      getMonaco: () => this.monacoInstance,
      getEditor: () => this.editorInstance,
      registerCompletionProvider: (language: string, provider: any) => {
        if (this.monacoInstance) {
          return this.monacoInstance.languages.registerCompletionItemProvider(language, provider);
        }
        this.queuedCompletionProviders.push({ language, provider });
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
          this.outlineProviders.set(provider.language.toLowerCase(), safeParse);
          console.log(`[PluginLoader] Registered custom outline provider for ${provider.language}`);
        }
      },

      openFile: async (path: string) => {
        await this.openFileHandler(path);
      },
      createFile: async (path: string, content?: string) => {
        await this.createFileHandler(path, content);
      },
      refreshFiles: async () => {
        await this.refreshFilesHandler();
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
        await this.openCustomTabHandler(tab);
      },

      showNotification: (msg: string, type?: 'info' | 'success' | 'error') => {
        this.notificationHandler(msg, type);
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
            const ok = await this.confirmHandler(
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
            const ok = await this.confirmHandler(
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

      getLanguage: () => this.currentLanguage,
      i18n: {
        getLanguage: () => this.currentLanguage,
        onLanguageChange: (cb: (lang: string) => void) => {
          this.languageChangeCallbacks.add(cb);
          try {
            cb(this.currentLanguage);
          } catch (e) {
            console.error(e);
          }
          return () => this.languageChangeCallbacks.delete(cb);
        },
        registerLocales: (pluginId: string, locales: Record<string, Record<string, string>>) => {
          registerPluginLocales(pluginId, locales);
        },
        registerLanguagePack: (pack: LanguagePack) => {
          registerLanguagePack(pack);
        },
        t: (pluginId: string, key: string, fallback?: string, params?: Record<string, any>) => {
          return getPluginT(pluginId, this.currentLanguage)(key, fallback, params);
        },
        scoped: (pluginId: string) => {
          const fn = (key: string, fallback?: string, params?: Record<string, any>) =>
            getPluginT(pluginId, this.currentLanguage)(key, fallback, params);

          return Object.assign(fn, {
            t: fn,
            getLanguage: () => this.currentLanguage,
            onLanguageChange: (cb: (lang: string) => void) => {
              this.languageChangeCallbacks.add(cb);
              try {
                cb(this.currentLanguage);
              } catch (e) {
                console.error(e);
              }
              return () => this.languageChangeCallbacks.delete(cb);
            },
          });
        },
      },

      services: {
        register: (serviceName: string, implementation: any, providerPluginId: string) => {
          if (!serviceName || !implementation || !providerPluginId) {
            throw new Error('[Services] register requires serviceName, implementation, and providerPluginId');
          }
          const provider = this.plugins.find((p) => p.id === providerPluginId);
          if (!provider) {
            console.warn(`[Services] Provider plugin '${providerPluginId}' not found in active plugins list`);
          } else if (!provider.providesServices?.includes(serviceName)) {
            console.warn(`[Services] Plugin '${providerPluginId}' did not declare providesServices: ['${serviceName}'] in its manifest`);
          }
          this.registeredServices.set(serviceName, {
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

          const reg = this.registeredServices.get(serviceName);
          if (!reg) {
            throw new Error(`[Services] Service '${serviceName}' is not registered or provider is inactive`);
          }

          const consumer = this.plugins.find((p) => p.id === consumerPluginId);
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
          return this.registeredServices.has(serviceName);
        },

        getOptional: async (serviceName: string, consumerPluginId: string) => {
          if (!serviceName || !consumerPluginId) {
            return null;
          }
          if (!this.registeredServices.has(serviceName)) {
            return null;
          }
          try {
            return await (window as any).ConfigStudio.services.get(serviceName, consumerPluginId);
          } catch {
            return null;
          }
        },

        list: () => {
          return Array.from(this.registeredServices.keys());
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
          this.pluginSettingsPanels.set(pluginId, def.render);
        }
      },
      getPluginSettings: (pluginId: string) => api.getPluginSettings(pluginId),
      savePluginSettings: (pluginId: string, settings: Record<string, any>) => api.savePluginSettings(pluginId, settings),
      ui: {
        toast: (message: string, type?: 'info' | 'success' | 'error' | 'warning', title?: string) => {
          this.notificationHandler(message, type as any);
        },
      },
      telemetry: {
        captureError: (err: Error, context?: Record<string, any>) => telemetry.captureError(err, context),
        log: (action: string, details?: Record<string, any>, severity?: 'info' | 'warn' | 'critical') =>
          telemetry.record({ action, details, severity: severity as any, source: 'plugin' }),
      },
    };
  }

  setLanguage(lang: string) {
    if (this.currentLanguage !== lang) {
      this.currentLanguage = lang;
      this.languageChangeCallbacks.forEach((cb) => {
        try {
          cb(lang);
        } catch (e) {
          console.error('[PluginLoader] Error in languageChange callback:', e);
        }
      });
    }
  }

  getLanguage(): string {
    return this.currentLanguage;
  }

  init(options: {
    getActiveFile: () => OpenFile | null;
    setActiveContent: (content: string) => void;
    showNotification: (msg: string, type?: 'info' | 'success' | 'error') => void;
    confirmCommand: (command: string) => Promise<boolean>;
    openFile?: (path: string) => Promise<void>;
    createFile?: (path: string, content?: string) => Promise<void>;
    refreshFiles?: () => Promise<void>;
    openCustomTab?: (tab: any) => Promise<void>;
  }) {
    this.activeFileGetter = options.getActiveFile;
    this.activeContentSetter = options.setActiveContent;
    this.notificationHandler = options.showNotification;
    this.confirmHandler = options.confirmCommand;
    if (options.openFile) this.openFileHandler = options.openFile;
    if (options.createFile) this.createFileHandler = options.createFile;
    if (options.refreshFiles) this.refreshFilesHandler = options.refreshFiles;
    if (options.openCustomTab) this.openCustomTabHandler = options.openCustomTab;
  }

  private sortPluginsTopologically(plugins: PluginItem[]): PluginItem[] {
    const enabledPlugins = plugins.filter((p) => p.enabled);
    const pluginMap = new Map<string, PluginItem>();
    for (const p of enabledPlugins) {
      pluginMap.set(p.id, p);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: PluginItem[] = [];

    const visit = (p: PluginItem) => {
      if (visited.has(p.id)) return;
      if (visiting.has(p.id)) {
        console.warn(`[PluginLoader] Cyclic dependency detected for plugin ${p.id}`);
        return;
      }

      visiting.add(p.id);

      if (p.dependencies) {
        for (const depId of Object.keys(p.dependencies)) {
          const dep = pluginMap.get(depId);
          if (dep) {
            visit(dep);
          }
        }
      }

      if (p.optionalDependencies) {
        for (const depId of Object.keys(p.optionalDependencies)) {
          const dep = pluginMap.get(depId);
          if (dep) {
            visit(dep);
          }
        }
      }

      visiting.delete(p.id);
      visited.add(p.id);
      sorted.push(p);
    };

    for (const p of enabledPlugins) {
      if (!visited.has(p.id)) {
        visit(p);
      }
    }

    return sorted;
  }

  async loadPlugins(): Promise<PluginItem[]> {
    try {
      this.plugins = await api.getPlugins();
      const sorted = this.sortPluginsTopologically(this.plugins);
      for (const p of sorted) {
        await this.injectPluginAssets(p);
      }
      this.notify();
      return this.plugins;
    } catch (e) {
      console.error('[PluginLoader] Failed to load plugins:', e);
      return [];
    }
  }

  private async injectPluginAssets(p: PluginItem) {
    // 0. Auto-register plugin locales if present in manifest
    if (p.locales) {
      registerPluginLocales(p.id, p.locales);
    }
    // Auto-register core UI language pack if defined
    if (p.localization && p.localization.code) {
      registerLanguagePack({
        code: p.localization.code,
        name: p.localization.name,
        flag: p.localization.flag,
        pluginId: p.id,
        translations: p.localization.translations || {},
      });
    }

    // 1. Inject CSS if defined
    if (p.css) {
      const cssId = `plugin-css-${p.id}`;
      if (!document.getElementById(cssId)) {
        try {
          const res = await fetch(`/api/plugins/${encodeURIComponent(p.id)}/files/${p.css}?t=${Date.now()}`, {
            headers: { 'X-ConfigStudio-Web': '1', 'Cache-Control': 'no-cache, no-store' },
            cache: 'no-store',
          });
          if (res.ok) {
            const cssText = await res.text();
            const style = document.createElement('style');
            style.id = cssId;
            style.textContent = cssText;
            document.head.appendChild(style);
          }
        } catch (e) {
          console.warn(`[PluginLoader] Failed to load CSS for ${p.id}:`, e);
        }
      }
    }

    // 2. Load and execute Script Entrypoint
    if (p.entry && !this.loadedPluginIds.has(p.id)) {
      try {
        const res = await fetch(`/api/plugins/${encodeURIComponent(p.id)}/files/${p.entry}?t=${Date.now()}`, {
          headers: { 'X-ConfigStudio-Web': '1', 'Cache-Control': 'no-cache, no-store' },
          cache: 'no-store',
        });
        if (res.ok) {
          const code = await res.text();
          // Execute script with window.ConfigStudio in scope
          const runner = new Function('ConfigStudio', 'window', code);
          runner((window as any).ConfigStudio, window);
          this.loadedPluginIds.add(p.id);
          console.log(`[PluginLoader] Successfully initialized plugin: ${p.name} (${p.id})`);
          this.notify();
        } else {
          console.error(`[PluginLoader] Failed to fetch script for ${p.id}: HTTP ${res.status}`);
        }
      } catch (err) {
        console.error(`[PluginLoader] Error executing plugin ${p.id}:`, err);
      }
    }
  }

  removePluginAssets(id: string) {
    const css = document.getElementById(`plugin-css-${id}`);
    if (css) css.remove();

    this.pluginSettingsPanels.delete(id);
    unregisterPluginLocales(id);
    unregisterLanguagePack(id);

    // Unregister services provided by this plugin
    for (const [svcName, reg] of this.registeredServices.entries()) {
      if (reg.providerPluginId === id) {
        this.registeredServices.delete(svcName);
        console.log(`[Services] Unregistered service '${svcName}' because provider '${id}' was unloaded`);
      }
    }

    this.loadedPluginIds.delete(id);
    contextMenuRegistry.unregisterByPlugin(id);
    this.toolbarButtons = this.toolbarButtons.filter((b) => b.pluginId !== id);
    this.splitPanels = this.splitPanels.filter((p) => p.pluginId !== id);
    this.bottomPanels = this.bottomPanels.filter((p) => p.pluginId !== id);
    this.headerItems = this.headerItems.filter((h) => h.pluginId !== id);

    if (this.activeSplitPanelId && this.splitPanels.every((p) => p.id !== this.activeSplitPanelId)) {
      this.activeSplitPanelId = null;
    }
    if (this.activeBottomPanelId && this.bottomPanels.every((p) => p.id !== this.activeBottomPanelId)) {
      this.activeBottomPanelId = null;
    }
    this.notify();
  }

  notifyFileOpen(file: OpenFile) {
    this.onFileOpenCallbacks.forEach((cb) => {
      try {
        cb(file);
      } catch (err) {
        console.error('[Plugin] onFileOpen error:', err);
      }
    });
  }

  notifyFileSave(file: OpenFile) {
    this.onFileSaveCallbacks.forEach((cb) => {
      try {
        cb(file);
      } catch (err) {
        console.error('[Plugin] onFileSave error:', err);
      }
    });
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PluginSystemState {
    return {
      plugins: this.plugins,
      toolbarButtons: this.toolbarButtons,
      splitPanels: this.splitPanels,
      bottomPanels: this.bottomPanels,
      headerItems: this.headerItems,
      activeSplitPanelId: this.activeSplitPanelId,
      activeBottomPanelId: this.activeBottomPanelId,
    };
  }

  closeSplitPanel(panelId: string) {
    const panel = this.splitPanels.find((p) => p.id === panelId);
    if (panel) {
      panel.open = false;
    }
    if (this.activeSplitPanelId === panelId) {
      this.activeSplitPanelId = null;
    }
    this.notify();
  }

  closeBottomPanel(panelId: string) {
    const panel = this.bottomPanels.find((p) => p.id === panelId);
    if (panel) {
      panel.open = false;
    }
    if (this.activeBottomPanelId === panelId) {
      this.activeBottomPanelId = null;
    }
    this.notify();
  }

  private notify() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }
}

export const pluginManager = new PluginLoader();
