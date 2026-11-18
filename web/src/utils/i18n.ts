import ruLocale from '../locales/ru.json';
import enLocale from '../locales/en.json';

export type BuiltinLanguage = 'ru' | 'en';
export type Language = BuiltinLanguage | string;

export type TranslationKey = keyof typeof ruLocale;

export interface LanguageMeta {
  code: string;
  name: string;
  flag: string;
  isPlugin?: boolean;
  pluginId?: string;
}

export interface LanguagePack {
  code: string;
  name: string;
  flag?: string;
  pluginId?: string;
  translations: Record<string, string>;
}

const builtInTranslations = {
  ru: ruLocale,
  en: enLocale,
};

// ============================================================================
// Dynamic Language Pack Registry (Full UI Localizations via Plugins)
// ============================================================================

const customLanguagePacks: Map<string, LanguagePack> = new Map();
const registryChangeListeners: Set<() => void> = new Set();

export const BUILD_LOCALE = ((import.meta as any).env?.VITE_APP_LOCALE as string) || 'all';
export const DEFAULT_LANGUAGE: Language = BUILD_LOCALE === 'en' ? 'en' : 'ru';

/**
 * Returns all available languages (built-ins + dynamically registered language packs).
 */
export function getAvailableLanguages(): LanguageMeta[] {
  const list: LanguageMeta[] = [];

  if (BUILD_LOCALE === 'ru') {
    list.push({ code: 'ru', name: 'Русский', flag: '🇷🇺' });
  } else if (BUILD_LOCALE === 'en') {
    list.push({ code: 'en', name: 'English', flag: '🇬🇧' });
  } else {
    list.push({ code: 'ru', name: 'Русский', flag: '🇷🇺' });
    list.push({ code: 'en', name: 'English', flag: '🇬🇧' });
  }

  customLanguagePacks.forEach((pack) => {
    if (!list.some((item) => item.code === pack.code)) {
      list.push({
        code: pack.code,
        name: pack.name,
        flag: pack.flag || '🌐',
        isPlugin: true,
        pluginId: pack.pluginId,
      });
    }
  });

  return list;
}

/**
 * Registers or updates a full UI language pack contributed by a plugin.
 */
export function registerLanguagePack(pack: LanguagePack): void {
  if (!pack || !pack.code) return;
  const code = pack.code.toLowerCase().trim();
  customLanguagePacks.set(code, {
    ...pack,
    code,
  });

  console.log(`[i18n] Registered UI language pack: ${pack.name} (${code})`);
  registryChangeListeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.error('[i18n] Error in registry listener:', e);
    }
  });
}

/**
 * Unregisters a language pack by its code or plugin ID.
 */
export function unregisterLanguagePack(codeOrPluginId: string): void {
  let changed = false;
  if (customLanguagePacks.has(codeOrPluginId)) {
    customLanguagePacks.delete(codeOrPluginId);
    changed = true;
  }
  for (const [code, pack] of customLanguagePacks.entries()) {
    if (pack.pluginId === codeOrPluginId) {
      customLanguagePacks.delete(code);
      changed = true;
    }
  }
  if (changed) {
    registryChangeListeners.forEach((cb) => cb());
  }
}

/**
 * Subscribes to changes in the registered language list.
 */
export function subscribeLanguages(listener: () => void): () => void {
  registryChangeListeners.add(listener);
  return () => {
    registryChangeListeners.delete(listener);
  };
}

/**
 * Retrieves the translation dictionary for a given language,
 * falling back gracefully to English for any missing keys.
 */
export function getTranslations(lang: string = DEFAULT_LANGUAGE): Record<string, string> {
  const normalized = (lang || DEFAULT_LANGUAGE).toLowerCase();

  if (normalized === 'ru') {
    const custom = customLanguagePacks.get('ru');
    return custom ? { ...builtInTranslations.ru, ...custom.translations } : builtInTranslations.ru;
  }

  if (normalized === 'en') {
    const custom = customLanguagePacks.get('en');
    return custom ? { ...builtInTranslations.en, ...custom.translations } : builtInTranslations.en;
  }

  const custom = customLanguagePacks.get(normalized);
  if (custom) {
    return {
      ...builtInTranslations.en,
      ...custom.translations,
    };
  }

  return BUILD_LOCALE === 'en' ? builtInTranslations.en : builtInTranslations.ru;
}

/**
 * Backwards-compatible proxy export. Any access like `translations[lang]` or `translations.ru`
 * automatically resolves to the proper merged translation dictionary.
 */
export const translations: Record<string, any> = new Proxy(builtInTranslations as any, {
  get(target, prop: string) {
    if (typeof prop !== 'string') return target[DEFAULT_LANGUAGE] || target.ru;
    return getTranslations(prop);
  },
});

// ============================================================================
// Plugin-Scoped i18n Store (Self-Contained Plugin Translations)
// ============================================================================

const pluginLocalesStore: Map<string, Record<string, Record<string, string>>> = new Map();

/**
 * Registers localizations for a specific plugin's own UI elements.
 */
export function registerPluginLocales(
  pluginId: string,
  locales: Record<string, Record<string, string>>
): void {
  if (!pluginId || !locales) return;
  const existing = pluginLocalesStore.get(pluginId) || {};
  for (const [lang, dict] of Object.entries(locales)) {
    existing[lang] = {
      ...(existing[lang] || {}),
      ...dict,
    };
  }
  pluginLocalesStore.set(pluginId, existing);
}

/**
 * Unregisters a plugin's localizations on unload.
 */
export function unregisterPluginLocales(pluginId: string): void {
  pluginLocalesStore.delete(pluginId);
}

/**
 * Returns a scoped translation helper `t(key, fallback?, params?)` for a given plugin.
 */
export function getPluginT(pluginId: string, currentLang: string = 'ru') {
  return function t(key: string, fallback?: string, params?: Record<string, any>): string {
    const pLocales = pluginLocalesStore.get(pluginId);
    let val: string | undefined;
    if (pLocales) {
      val = pLocales[currentLang]?.[key] || pLocales['en']?.[key] || pLocales['ru']?.[key];
    }
    let res = val !== undefined ? val : (fallback !== undefined ? fallback : key);
    if (params && typeof res === 'string') {
      for (const [k, v] of Object.entries(params)) {
        res = res.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return res;
  };
}

/**
 * Resolves a plugin's localized name from its manifest.
 */
export function getPluginName(
  manifest: { name: string; locales?: Record<string, any> },
  lang: string = 'ru'
): string {
  return manifest.locales?.[lang]?.name || manifest.locales?.en?.name || manifest.name;
}

/**
 * Resolves a plugin's localized description from its manifest.
 */
export function getPluginDescription(
  manifest: { description: string; locales?: Record<string, any> },
  lang: string = 'ru'
): string {
  return manifest.locales?.[lang]?.description || manifest.locales?.en?.description || manifest.description;
}
