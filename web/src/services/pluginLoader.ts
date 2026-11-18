import { setupGlobalAPI } from './pluginBridge';
import { api } from './api';
import {
  PluginItem,
  OpenFile,
  OpenFileOptions,
  ToolbarButtonDef,
  SplitPanelDef,
  HeaderItemDef,
  OutlineNode,
} from '../types';
import { contextMenuRegistry } from './contextMenuRegistry';
import {
  registerPluginLocales,
  unregisterPluginLocales,
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

export class PluginLoader {
  public plugins: PluginItem[] = [];
  public toolbarButtons: ToolbarButtonDef[] = [];
  public splitPanels: SplitPanelDef[] = [];
  public bottomPanels: BottomPanelDef[] = [];
  public headerItems: HeaderItemDef[] = [];
  public activeSplitPanelId: string | null = null;
  public activeBottomPanelId: string | null = null;
  public currentLanguage: string = 'ru';
  public languageChangeCallbacks: Set<(lang: string) => void> = new Set();
  public registeredServices: Map<
    string,
    { serviceName: string; providerPluginId: string; implementation: any }
  > = new Map();

  public onFileOpenCallbacks: Array<(file: OpenFile) => void> = [];
  public onFileSaveCallbacks: Array<(file: OpenFile) => void> = [];

  public listeners: Set<Listener> = new Set();
  public activeFileGetter: () => OpenFile | null = () => null;
  public activeContentSetter: (content: string) => void = () => {};
  public notificationHandler: (msg: string, type?: 'info' | 'success' | 'error') => void = (m) => alert(m);
  public confirmHandler: (command: string) => Promise<boolean> = async () => true;

  public monacoInstance: any = null;
  public editorInstance: any = null;
  public loadedPluginIds: Set<string> = new Set();
  public queuedCompletionProviders: Array<{ language: string; provider: any }> = [];
  public outlineProviders: Map<string, (content: string, filename: string) => OutlineNode[]> = new Map();
  public pluginSettingsPanels: Map<string, (container: HTMLElement) => void> = new Map();

  getPluginSettingsRenderer(pluginId: string) {
    return this.pluginSettingsPanels.get(pluginId);
  }

  public openFileHandler: (path: string, options?: OpenFileOptions) => Promise<void> = async () => {};
  public createFileHandler: (path: string, content?: string) => Promise<void> = async () => {};
  public refreshFilesHandler: () => Promise<void> = async () => {};
  public openCustomTabHandler: (tab: any) => Promise<void> = async () => {};

  getOutlineProvider(languageOrExt: string) {
    if (!languageOrExt) return undefined;
    const lower = languageOrExt.toLowerCase();
    if (lower === 'yml' || lower === 'yaml') {
      return this.outlineProviders.get('yaml') || this.outlineProviders.get('yml');
    }
    return this.outlineProviders.get(lower);
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
    setupGlobalAPI(this);
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
    openFile?: (path: string, options?: OpenFileOptions) => Promise<void>;
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
      // Ensure any existing registered buttons inherit fileMatches from manifest
      for (const btn of this.toolbarButtons) {
        if ((!btn.fileMatches || btn.fileMatches.length === 0) && btn.pluginId) {
          const p = this.plugins.find((x) => x.id === btn.pluginId);
          if (p?.fileMatches && p.fileMatches.length > 0) {
            btn.fileMatches = [...p.fileMatches];
          }
        }
      }
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

  public async injectPluginAssets(p: PluginItem) {
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

    // Auto-reload split panels with refreshOnSave: true
    this.splitPanels.forEach((p) => {
      if (p.open && p.refreshOnSave && typeof p.onReload === 'function') {
        try {
          p.onReload();
        } catch (e) {
          console.error('[PluginLoader] Error auto-reloading split panel on save:', p.id, e);
        }
      }
    });
  }

  setActiveSplitPanel(panelId: string) {
    const panel = this.splitPanels.find((p) => p.id === panelId);
    if (panel) {
      panel.open = true;
      this.activeSplitPanelId = panel.id;
      this.notify();
    }
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
      const remaining = this.splitPanels.find((p) => p.id !== panelId && p.open);
      this.activeSplitPanelId = remaining ? remaining.id : null;
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

  public notify() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }
}

export const pluginManager = new PluginLoader();
