# Руководство по локализации плагинов и созданию языковых пакетов (i18n)

Config Studio поддерживает полноценную многоязычную архитектуру как для отдельных плагинов, так и для языковых пакетов (Language Packs), переводящих весь интерфейс приложения.

---

## 1. Локализация собственных элементов плагина (Plugin-Scoped i18n)

Каждый плагин может поставлять собственные переводы интерфейса (кнопок, заголовков, подсказок, названий и описания плагина).

### 1.1 Способ А: Встроенные переводы в `plugin.json`
В манифесте плагина объявляется секция `"locales"`:

```json
{
  "id": "my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "Powerful tool for configurations",
  "locales": {
    "ru": {
      "name": "Мой инструмент",
      "description": "Мощный инструмент для конфигураций",
      "btnAction": "Запустить анализ",
      "statusReady": "Готов к работе"
    },
    "en": {
      "name": "My Tool",
      "description": "Powerful tool for configurations",
      "btnAction": "Run Analysis",
      "statusReady": "Ready"
    }
  }
}
```

### 1.2 Способ Б: Отдельные JSON-файлы в папке `locales/`
Если переводов много, их можно вынести в отдельные файлы внутри директории плагина:
- `locales/ru.json`
- `locales/en.json`
- `locales/de.json`

Ядро Config Studio автоматически сканирует папку `locales/` и подмешивает ключи в манифест плагина.

### 1.3 Использование в JavaScript (`main.js`)
В глобальном API `window.ConfigStudio.i18n` доступны методы:

```javascript
// Получение scoped-функции перевода для плагина
const t = window.ConfigStudio.i18n.scoped('my-tool');

// Использование с fallback и параметрами:
const btnText = t('btnAction', 'Запустить анализ');
const alertText = t('welcomeUser', 'Привет, {name}!', { name: 'Admin' });

// Подписка на смену языка пользователем:
window.ConfigStudio.i18n.onLanguageChange((newLang) => {
  console.log('Language changed to:', newLang);
  // Перерисовать элементы плагина
});
```

---

## 2. Плагины языковых пакетов (UI Language Packs)

Плагин может расширять список доступных языков всего интерфейса Config Studio (например, добавлять немецкий, французский, испанский и т.д.).

### 2.1 Определение языкового пакета
Языковой пакет может быть объявлен двумя способами:

#### Способ А: Вынесенный файл `local.json` или `localization.json` (Рекомендуется)
Чтобы не перегружать манифест сотнями строк переводов, словарь выносится в отдельный файл `local.json` (или `localization.json`) в корне плагина:

`local.json`:
```json
{
  "code": "de",
  "name": "Deutsch",
  "flag": "🇩🇪",
  "translations": {
    "settings": "Einstellungen",
    "save": "Speichern",
    "fileExplorer": "Datei-Explorer",
    "newFile": "Neue Datei",
    "themeDark": "Dunkel",
    "themeLight": "Hell"
  }
}
```

А в `plugin.json` манифест остается легким и содержит только базовые метаданные:
```json
{
  "id": "lang-de",
  "name": "German Language Pack",
  "version": "1.1.0",
  "description": "Deutsche Benutzeroberfläche für Config Studio",
  "minAppVersion": "2.3.6",
  "localization": {
    "code": "de",
    "name": "Deutsch",
    "flag": "🇩🇪"
  }
}
```

#### Способ Б: Встроенный блок в `plugin.json`
В `plugin.json` напрямую объявляется полная секция `"localization"` со словарем `"translations"`:

```json
{
  "id": "lang-de",
  "name": "German Language Pack",
  "version": "1.0.0",
  "description": "Deutsche Benutzeroberfläche für Config Studio",
  "localization": {
    "code": "de",
    "name": "Deutsch",
    "flag": "🇩🇪",
    "translations": {
      "settings": "Einstellungen",
      "save": "Speichern",
      "fileExplorer": "Datei-Explorer",
      "newFile": "Neue Datei",
      "themeDark": "Dunkel",
      "themeLight": "Hell"
    }
  }
}
```

### 2.2 Поведение ядра:
1. При включении плагина язык автоматически появляется в списке выбора языков в «Настройках» со значком флага и бейджем `Pack`.
2. При переключении на этот язык весь интерфейс Config Studio немедленно переводится на новый язык без перезагрузки страницы.
3. Если плагин не перевел какие-то редкие ключи, ядро безопасно берет fallback из английского / русского словаря — приложение никогда не выдает пустые строки и не ломается.
4. При отключении или удалении плагина интерфейс безопасно возвращается на встроенный язык (English / Russian).
