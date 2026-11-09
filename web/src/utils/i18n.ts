export type BuiltinLanguage = 'ru' | 'en';
export type Language = BuiltinLanguage | string;

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
  ru: {
    appTitle: 'Название приложения',
    appTitleHelp: 'Изменяет заголовок в шапке и название вкладки браузера.',
    appIcon: 'Значок приложения и Favicon',
    appIconHelp: 'Заменяет логотип в навигации и значок вкладки браузера.',
    chooseImage: 'Выбрать изображение (.svg, .png, .ico)',
    baseColor: 'Базовый цвет (основной фон и карточки)',
    accentColor: 'Акцентный цвет (кнопки и подсветка)',
    theme: 'Тема оформления',
    themeDark: 'Тёмная',
    themeLight: 'Светлая',
    language: 'Язык интерфейса',
    save: 'Сохранить',
    saving: 'Сохранение...',
    saved: 'Сохранено',
    download: 'Скачать',
    settings: 'Настройки',
    settingsTitle: 'Настройки приложения и оформления',
    applyChanges: 'Применить настройки',
    cancel: 'Отмена',
    resetDefaults: 'Сбросить по умолчанию',
    fileExplorer: 'Проводник файлов',
    newFile: 'Новый файл',
    newFolder: 'Новая папка',
    refresh: 'Обновить',
    emptyFolder: 'Папка пуста',
    dropFiles: 'Перетащите файлы сюда',
    clickToUpload: 'или нажмите для загрузки',
    uploadFile: 'Загрузить файл',
    uploadFileHere: 'Загрузить файлы сюда...',
    uploadTo: 'Загрузка в',
    rename: 'Переименовать',
    delete: 'Удалить',
    deleteConfirm: 'Вы уверены, что хотите удалить "{name}"?',
    enterNewName: 'Введите новое имя:',
    enterFileName: 'Введите имя нового файла:',
    enterFolderName: 'Введите имя новой папки:',
    structureOutline: 'Структура документа',
    astMap: 'Карта AST',
    searchOutline: 'Поиск по структуре...',
    searchFiles: 'Поиск по файлам (Ctrl+P)...',
    noFilesFound: 'Файлы не найдены',
    matchesFound: 'Найдено: {current} из {total}',
    noMatches: 'Нет совпадений',
    nextMatch: 'Следующее совпадение',
    prevMatch: 'Предыдущее совпадение',
    showDiff: 'Показать предпросмотр изменений',
    hideDiff: 'Скрыть предпросмотр',
    currentVersion: 'Текущая версия',
    selectedRevision: 'Выбранная версия',
    validationError: 'Ошибка валидации синтаксиса',
    noStructure: 'Структура не обнаружена или файл пуст',
    quickJump: 'Быстрый переход:',
    unsavedWarning: 'В файле "{name}" есть несохраненные изменения. Закрыть без сохранения?',
    timeMachine: 'История',
    timeMachineTitle: 'Time Machine: История изменений',
    rollbackToRevision: 'Откатить к этой версии',
    revisionOlder: 'Старее',
    revisionNewer: 'Новее',
    noRevisionsYet: 'Снимков истории пока нет. Они создаются автоматически при каждом сохранении файла.',
    fileProperties: 'Свойства файла',
    editHistory: 'История правок',
    restoreVersion: 'Восстановить эту версию',
    revisions: 'Контрольные точки',
    noRevisions: 'Пока нет сохраненных правок в этой сессии',
    hashSha256: 'SHA-256 Хэш',
    fileSize: 'Размер файла',
    lineCount: 'Всего строк',
    charCount: 'Символов',
    fileName: 'Имя файла',
    serverPath: 'Путь на сервере',
    createdAt: 'Дата создания',
    modifiedAt: 'Дата изменения',
    copied: 'Скопировано в буфер!',
    authTitle: 'Авторизация в системе',
    authSubtitle: 'Введите учетные данные для доступа к Config Studio',
    username: 'Имя пользователя',
    password: 'Пароль',
    signIn: 'Войти в систему',
    signOut: 'Выйти',
    collapseAll: 'Свернуть все',
    expandAll: 'Развернуть все',
    authSettings: 'Настройки безопасности',
    enableAuth: 'Включить защиту паролем (Direct Login)',
    authHelp: 'При использовании Authentik / Authelia авторизация проходит прозрачно через заголовки SSO.',
    newPassword: 'Новый пароль (оставьте пустым, если не меняется)',
    enableApi: 'Разрешить доступ через REST API',
    enableApiHelp: 'Разрешает внешним скриптам, curl и интеграциям обращаться к серверу через API. Не требуется для обычной работы в браузере (рекомендуется выключать для максимальной безопасности).',
    apiDisabledNote: 'Прямой доступ к REST API отключен. Работа в браузере полностью доступна.',
    apiKey: 'Секретный API Ключ (X-API-Key)',
    generateApiKey: 'Сгенерировать новый ключ',
    apiKeyHelp: 'Передавайте заголовок X-API-Key или Authorization: Bearer <ключ> в запросах curl и скриптах.',
    resizeWidthHelp: 'Перетащите границу для изменения ширины (двойной клик для сброса на 320px)',
    tabGeneral: 'Оформление',
    tabSecurity: 'Безопасность',
    tabPlugins: 'Плагины',
    tabPluginSettings: 'Настройки плагинов',
    tabAudit: 'Аудит',
    pluginSettingsTitle: 'Параметры расширений',
    pluginSettingsDesc: 'Настройка параметров работы и конфигурации установленных расширений.',
    pluginSettingsNoPlugins: 'Нет установленных плагинов',
    pluginSettingsSelectPrompt: 'Выберите плагин в списке слева для просмотра параметров',
    pluginSettingsNoCustomConfig: 'Это расширение работает автоматически и не требует дополнительных настроек',
    pluginSettingsAutosaved: 'Настройки сохраняются на сервере в data/plugin-settings/',
    pluginSettingsSaved: 'Сохранено',
    pluginSettingsSaveBtn: 'Сохранить настройки',
    pluginSettingsSearch: 'Поиск плагина...',
    auditTitle: 'Встроенный журнал аудита (Core Audit Trail)',
    auditDesc: 'Фиксация всех критических операций: изменения файлов, принудительные сохранения (Force Save), выполнение команд и установка плагинов.',
    auditExport: 'Экспорт журнала (.jsonl)',
    auditFilterAll: 'Все уровни',
    auditSeverityInfo: 'Информация',
    auditSeverityWarn: 'Предупреждения',
    auditSeverityCritical: 'Критические',
    auditCategoryAll: 'Все категории',
    auditCatUser: 'Действия',
    auditCatError: 'Ошибки',
    auditCatNetwork: 'Сеть',
    auditCatSystem: 'Система',
    auditCatPlugin: 'Плагины',
    auditCopyAi: 'Скопировать для ИИ',
    auditCopied: 'Скопировано!',
    auditSearchPlaceholder: 'Поиск по объекту, действию, пользователю...',
    auditEmpty: 'Журнал аудита пуст',
    auditNoMatches: 'События не найдены по заданным фильтрам',
    auditTimestamp: 'Время',
    auditUser: 'Пользователь',
    auditAction: 'Действие',
    auditSeverity: 'Уровень',
    auditTarget: 'Объект / Цель',
    auditDetails: 'Детали',
    auditTotal: 'Всего событий',
    auditRefresh: 'Обновить',
    pluginsTitle: 'Управление плагинами',
    pluginsDesc: 'Устанавливайте расширения, кастомизируйте интерфейс и подключайте инструменты хоста.',
    installedPlugins: 'Установленные плагины',
    installPlugin: 'Установка нового плагина',
    installZipTab: 'Пакет .CSPKG / .ZIP',
    installUrlTab: 'По ссылке (URL / GitHub)',
    dropZipHere: 'Перетащите файл .cspkg или .zip плагина сюда',
    orClickToUploadZip: 'или нажмите для выбора файла на диске (.cspkg, .zip)',
    pluginUrlPlaceholder: 'Например: https://github.com/username/cs-plugin-example',
    installBtn: 'Установить',
    installing: 'Установка...',
    directPlacementTip: 'Прямая установка: также можно просто скопировать папку плагина в каталог data/plugins/<имя>/ — система определит её автоматически.',
    unrestrictedMode: 'Режим повышенных привилегий («Я знаю, что делаю»)',
    unrestrictedHelp: 'Разрешает плагинам выполнять команды хост-системы без всплывающих окон подтверждения (строгий черный список критических команд остается активным).',
    noPlugins: 'Плагины не найдены',
    noInstalledPlugins: 'Нет установленных плагинов. Базовая версия Config Studio работает в чистом минималистичном режиме.',
    catalogTitle: 'Каталог официальных плагинов',
    catalogDesc: 'Модульные расширения по требованию. Устанавливайте только то, что вам действительно нужно.',
    installCatalogBtn: 'Установить',
    installedBadge: 'Установлен',
    builtin: 'Встроенный',
    pluginEnabled: 'Включен',
    pluginDisabled: 'Отключен',
    author: 'Автор',
    version: 'Версия',
    permissions: 'Разрешения',
    fileMatches: 'Поддерживаемые файлы',

    // Tab Profile & Sources
    tabProfile: 'Профиль и Источники',
    headerPluginsTitle: 'Плагины',
    headerPluginsActive: 'активных',

    // Audit Details Toggle
    hideDetails: '▲ Скрыть детали',
    showDetails: '▼ Показать детали события',
    auditRefreshing: 'Обновление журнала...',
    auditExporting: 'Экспорт...',

    // Bottom Dock Settings
    dockStripSetting: 'Нижняя панель (Dock Strip)',
    dockModeAuto: 'Авто (Zero-Clutter)',
    dockModeAutoDesc: 'Скрыта без плагинов',
    dockModeAlways: 'Всегда видна',
    dockModeAlwaysDesc: 'Строка 28px внизу',
    dockModeHidden: 'Отключена',
    dockModeHiddenDesc: 'Всегда скрыта',

    // Structure Guard Settings
    structureGuardDesc:
      'Двойная проверка AST-синтаксиса (YAML, JSON, TOML, .env, Nginx) перед физической записью на диск. При обнаружении синтаксических ошибок сохранение чувствительных конфигов блокируется с предложением Force Save.',
    criticalPatternsLabel: 'Пользовательские маски чувствительных файлов (по одной на строку):',
    criticalPatternsHelp: 'Базовые системные маски активны всегда:',

    // Profile Portability & Sources
    profilePortabilityTitle: 'Переносимость профиля (1-Click Profile Portability)',
    profilePortabilityDesc:
      'Экспортируйте ваши темы, правила Deep Guard и список плагинов для мгновенного развертывания на любом компьютере или сервере.',
    exportProfileBtn: 'Экспорт профиля (.json)',
    importProfileBtn: 'Импорт профиля (.json)',
    secretsExcludedNote: 'Пароли и ключи исключены по умолчанию',
    sourcesTitle: 'Доверенные каталоги плагинов (Plugin Sources)',
    sourcesDesc:
      'Репозитории и реестры, из которых Config Studio подтягивает список официальных и сторонних плагинов.',
    syncSources: 'Синхронизировать',
    syncingSources: 'Синхронизация...',
    addSourceBtn: 'Добавить источник',
    addSourceTitle: 'Подключение нового каталога плагинов',
    sourceNameLabel: 'Название каталога',
    sourceNamePlaceholder: 'Например: Internal DevOps Registry',
    sourceUrlLabel: 'URL к registry.json',
    saveSourceBtn: 'Сохранить источник',
    addingSource: 'Добавление...',
    loadingSources: 'Загрузка списка источников...',
    noSources: 'Нет подключенных источников',
    officialBadge: 'Официальный',
    communityBadge: 'Сообщество',
    pluginsCountSuffix: 'плагинов',
    syncedPrefix: 'Синхр:',
    deleteSourceTitle: 'Удалить источник',
    deletePluginTitle: 'Удалить плагин',
    refreshPluginsList: 'Обновить список плагинов',
    installHelpNote: 'Установите нужные модули из каталога ниже, через ZIP или по ссылке из GitHub.',
    githubUrlTip:
      'Поддерживаются прямые ссылки на GitHub репозитории (например, https://github.com/author/plugin) или прямые ссылки на .zip архивы.',

    // Profile Import Modal
    importProfileModalTitle: 'Импорт профиля Config Studio',
    exportedAtPrefix: 'Экспортирован:',
    safeTransferBadge: '100% Безопасный перенос:',
    safeTransferExplanation:
      'файл профиля содержит только визуальные настройки, источники и манифесты плагинов. Пароли, приватные ключи и токены исключены.',
    themeSettingsLabel: 'Настройки темы и интерфейса',
    sourcesLabel: 'Источники каталогов плагинов',
    pluginsLabel: 'Плагины профиля',
    diffChanges: 'изменений',
    diffNoChanges: 'Без изменений',
    diffNew: 'новых',
    diffAllConnected: 'Все подключены',
    actionInstall: 'установить',
    actionEnable: 'включить',
    actionInstalled: 'установлен',
    applyingProfile: 'Применение профиля...',
    applyProfile: 'Применить профиль',

    // Bottom Dock Strip
    dockTerminal: 'Терминал',
    dockTerminalTitle: 'SSH / Shell Терминал',
    dockProblems: 'Проблемы',
    dockOutput: 'Вывод',
    dockOutputTitle: 'Журнал вывода и аудита',
    dockProblemsTitle: 'Проблемы и синтаксический анализ',
    dockNoProblems: 'Проблем не обнаружено. Структура конфигурации валидна.',
    dockNoOutput: 'Событий вывода пока нет',
    dockErrors: 'ошибок',
    dockWarnings: 'предупреждений',
    sysinfoTitle: 'Мониторинг узла',
    sysinfoCpu: 'ЦП',
    sysinfoRam: 'ОЗУ',
    sysinfoDisk: 'Диск',
    sysinfoUptime: 'Аптайм',
    sysinfoFree: 'свободно',
    sysinfoTotal: 'всего',
    sysinfoUsed: 'занято',
    sysinfoCores: 'ядер',
    sysinfoRefresh: 'Обновить',
    sysinfoOffline: 'Офлайн',
    dockToggleTooltip: 'Переключить нижний док (Ctrl+~ / Ctrl+J)',
    dockResizeTooltip: 'Потяните для изменения высоты панели',
    dockRefreshTooltip: 'Обновить журнал',
    dockMaximizeTooltip: 'Во весь экран',
    dockRestoreTooltip: 'Свернуть из полного экрана',
    dockCloseTooltip: 'Свернуть нижний док',

    // Context Menu
    ctxOpen: 'Открыть',
    ctxOpenFolder: 'Открыть папку',
    ctxCopyPath: 'Копировать относительный путь',
    ctxCopyPathSuccess: 'Путь скопирован в буфер',
    ctxNewFileHere: 'Новый файл...',
    ctxNewFolderHere: 'Новая папка...',
    ctxRename: 'Переименовать',
    ctxDelete: 'Удалить',
    ctxRefresh: 'Обновить',

    // Workspaces
    workspaces: 'Рабочие области',
    addWorkspace: 'Добавить папку',
    addWorkspaceTitle: 'Добавить рабочую папку в проект',
    editWorkspaceTitle: 'Настройки рабочей папки',
    workspaceId: 'Идентификатор (ID)',
    workspaceName: 'Название папки',
    workspacePath: 'Путь на сервере / ПК',
    workspaceIcon: 'Иконка',
    workspaceReadOnly: 'Режим только для чтения (Read-Only)',
    workspaceReadOnlyBadge: 'Только чтение',
    removeWorkspaceConfirm: 'Удалить папку "{name}" из рабочей области?\n\nФайлы на диске останутся нетронутыми, удалится только запись из конфигурации.',
    removeWorkspace: 'Удалить из рабочей области',

    // Secrets & Credentials Store
    tabSecrets: 'Секреты и Ключи',
    secretsTitle: 'Безопасное хранилище секретов (OS Keychain)',
    secretsSubtitle: 'Надежное хранение паролей, SSH-ключей и токенов в системном хранилище ОС.',
    backendLabel: 'Бэкенд хранилища:',
    zeroSecretNotice: '100% Zero-Secret Guarantee: Секреты надежно изолированы и исключены из экспорта профилей.',
    authRequiredToManage: 'Управление секретами заблокировано',
    authRequiredHelp: 'Для просмотра, добавления и изменения секретов включите защиту паролем (Direct Login) в разделе «Безопасность».',
    privilegedLocked: 'Секреты заблокированы',
    privilegedLockedHelp: 'Требуется подтверждение пароля администратора для входа в режим повышенных привилегий.',
    unlockSecretsBtn: 'Разблокировать секреты',
    unlockModalTitle: 'Подтверждение пароля администратора',
    unlockPasswordPlaceholder: 'Введите пароль администратора...',
    unlockSubmit: 'Разблокировать',
    unlocking: 'Проверка...',
    privilegedActiveBadge: 'Режим повышенных привилегий активен',
    addSecretBtn: 'Добавить секрет',
    addSecretModalTitle: 'Новый секрет',
    editSecretModalTitle: 'Редактирование секрета',
    secretTitleLabel: 'Название',
    secretTitlePlaceholder: 'Например: Root пароль серверов Prod',
    secretIdLabel: 'Идентификатор (ID)',
    secretIdPlaceholder: 'Например: shared:prod-root',
    secretTypeLabel: 'Тип секрета',
    secretTypePassword: 'Пароль',
    secretTypeSSHKey: 'SSH Приватный ключ',
    secretTypeToken: 'API Токен',
    secretTypeCertificate: 'Сертификат / TLS',
    secretTypeEnv: 'Переменная окружения',
    secretTypeOther: 'Другое',
    filterAll: 'Все',
    filterPasswords: 'Пароли',
    filterSSHKeys: 'SSH Ключи',
    filterTokens: 'API Токены',
    filterCertificates: 'Сертификаты',
    filterEnv: 'Env / Окружение',
    filterOther: 'Прочее',
    searchSecretsPlaceholder: 'Поиск по названию или ID...',
    noSecretsFoundFiltered: 'В этой категории секретов не найдено',
    clearFilter: 'Сбросить фильтр',
    secretScopeLabel: 'Область применения',
    secretScopeShared: 'Общий (для всех хостов и серверов)',
    secretScopePlugin: 'Для плагина',
    secretValueLabel: 'Значение',
    secretValuePlaceholder: 'Введите пароль, токен или приватный ключ...',
    saveSecretBtn: 'Сохранить секрет',
    savingSecret: 'Сохранение...',
    noSecretsFound: 'Сохраненных секретов пока нет',
    secretDeleteConfirm: 'Вы уверены, что хотите удалить секрет "{name}"?',
    secretDeleted: 'Секрет удален',
    secretSaved: 'Секрет успешно сохранен',
    revealSecret: 'Показать значение',
    hideSecret: 'Скрыть значение',
    copiedToClipboard: 'Скопировано в буфер',
  },
  en: {
    appTitle: 'Application Title',
    appTitleHelp: 'Updates header logo, navigation bar, and browser tab title.',
    appIcon: 'App Icon & Favicon',
    appIconHelp: 'Replaces application logo in navigation and browser favicon.',
    chooseImage: 'Choose Image (.svg, .png, .ico)',
    baseColor: 'Base Color (Primary Palette)',
    accentColor: 'Accent Color (Highlight & Buttons)',
    theme: 'Appearance Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    language: 'Interface Language',
    save: 'Save',
    saving: 'Saving...',
    saved: 'Saved',
    download: 'Download',
    settings: 'Settings',
    settingsTitle: 'Application & Branding Settings',
    applyChanges: 'Apply Changes',
    cancel: 'Cancel',
    resetDefaults: 'Reset to defaults',
    fileExplorer: 'File Explorer',
    newFile: 'New File',
    newFolder: 'New Folder',
    refresh: 'Refresh',
    emptyFolder: 'Folder is empty',
    dropFiles: 'Drop files here',
    clickToUpload: 'or click to upload',
    uploadFile: 'Upload file',
    uploadFileHere: 'Upload files here...',
    uploadTo: 'Upload to',
    rename: 'Rename',
    delete: 'Delete',
    deleteConfirm: 'Are you sure you want to delete "{name}"?',
    enterNewName: 'Enter new name:',
    enterFileName: 'Enter new file name:',
    enterFolderName: 'Enter new folder name:',
    structureOutline: 'Structure Outline',
    astMap: 'AST Map',
    searchOutline: 'Search in outline...',
    searchFiles: 'Search files (Ctrl+P)...',
    noFilesFound: 'No files found',
    matchesFound: 'Match {current} of {total}',
    noMatches: 'No matches',
    nextMatch: 'Next match',
    prevMatch: 'Previous match',
    showDiff: 'Preview changes',
    hideDiff: 'Hide preview',
    currentVersion: 'Current version',
    selectedRevision: 'Selected revision',
    validationError: 'Validation Issue',
    noStructure: 'No structure detected or empty file',
    quickJump: 'Quick Jump:',
    unsavedWarning: 'File "{name}" has unsaved changes. Close without saving?',
    timeMachine: 'History',
    timeMachineTitle: 'Time Machine: Revision History',
    rollbackToRevision: 'Restore this revision',
    revisionOlder: 'Older',
    revisionNewer: 'Newer',
    noRevisionsYet: 'No revision snapshots recorded yet. They are created automatically on every file save.',
    fileProperties: 'File Properties',
    editHistory: 'Edit History',
    restoreVersion: 'Restore this version',
    revisions: 'Revisions',
    noRevisions: 'No revisions recorded in this session yet',
    hashSha256: 'SHA-256 Hash',
    fileSize: 'File Size',
    lineCount: 'Total Lines',
    charCount: 'Characters',
    fileName: 'File Name',
    serverPath: 'Server Path',
    createdAt: 'Created At',
    modifiedAt: 'Modified At',
    copied: 'Copied to clipboard!',
    authTitle: 'Authentication',
    authSubtitle: 'Enter your credentials to access Config Studio',
    username: 'Username',
    password: 'Password',
    signIn: 'Sign In',
    signOut: 'Sign Out',
    collapseAll: 'Collapse all',
    expandAll: 'Expand all',
    authSettings: 'Security Settings',
    enableAuth: 'Enable Password Protection (Direct Login)',
    authHelp: 'When using Authentik / Authelia, SSO authentication happens transparently via reverse proxy headers.',
    newPassword: 'New Password (leave empty to keep current)',
    enableApi: 'Enable REST API Access',
    enableApiHelp: 'Allows external scripts, curl, and integrations to access the server via API. Not required for normal browser usage (recommended to disable for best security).',
    apiDisabledNote: 'Direct REST API access is disabled. Web UI remains fully functional.',
    apiKey: 'Secret API Key (X-API-Key)',
    generateApiKey: 'Generate new key',
    apiKeyHelp: 'Pass the X-API-Key header or Authorization: Bearer <key> in curl and scripts.',
    resizeWidthHelp: 'Drag border to resize (double click to reset to 320px)',
    tabGeneral: 'Appearance',
    tabSecurity: 'Security',
    tabPlugins: 'Plugins',
    tabPluginSettings: 'Plugin Settings',
    tabAudit: 'Audit Log',
    pluginSettingsTitle: 'Extension Preferences',
    pluginSettingsDesc: 'Configure options and settings for installed plugins and extensions.',
    pluginSettingsNoPlugins: 'No installed plugins',
    pluginSettingsSelectPrompt: 'Select a plugin from the left list to view options',
    pluginSettingsNoCustomConfig: 'This extension runs automatically and does not require additional configuration',
    pluginSettingsAutosaved: 'Settings are saved on server in data/plugin-settings/',
    pluginSettingsSaved: 'Saved',
    pluginSettingsSaveBtn: 'Save Settings',
    pluginSettingsSearch: 'Search plugin...',
    auditTitle: 'Core Audit Trail & Log',
    auditDesc: 'Records all critical operations: file modifications, force saves, command executions, and plugin installations.',
    auditExport: 'Export Log (.jsonl)',
    auditFilterAll: 'All Severities',
    auditSeverityInfo: 'Info',
    auditSeverityWarn: 'Warnings',
    auditSeverityCritical: 'Critical',
    auditCategoryAll: 'All Categories',
    auditCatUser: 'Actions',
    auditCatError: 'Errors',
    auditCatNetwork: 'Network',
    auditCatSystem: 'System',
    auditCatPlugin: 'Plugins',
    auditCopyAi: 'Copy for AI',
    auditCopied: 'Copied!',
    auditSearchPlaceholder: 'Search target, action, user, IP...',
    auditEmpty: 'Audit log is currently empty',
    auditNoMatches: 'No events match the selected filters',
    auditTimestamp: 'Timestamp',
    auditUser: 'User',
    auditAction: 'Action',
    auditSeverity: 'Severity',
    auditTarget: 'Target',
    auditDetails: 'Details',
    auditTotal: 'Total events',
    auditRefresh: 'Refresh',
    pluginsTitle: 'Plugin Management',
    pluginsDesc: 'Install extensions, customize UI and connect host tools.',
    installedPlugins: 'Installed Plugins',
    installPlugin: 'Install New Plugin',
    installZipTab: '.CSPKG / .ZIP File',
    installUrlTab: 'From URL / GitHub',
    dropZipHere: 'Drop .cspkg package or .zip archive here',
    orClickToUploadZip: 'or click to browse file (.cspkg, .zip)',
    pluginUrlPlaceholder: 'e.g. https://github.com/username/cs-plugin-example',
    installBtn: 'Install',
    installing: 'Installing...',
    directPlacementTip: 'Direct placement: you can also copy the plugin folder directly into data/plugins/<name>/ — it will be detected automatically.',
    unrestrictedMode: 'Unrestricted Mode ("I know what I am doing")',
    unrestrictedHelp: 'Allows plugins to execute host commands without confirmation popups (strict destructive blacklist remains active).',
    noPlugins: 'No plugins found',
    noInstalledPlugins: 'No plugins installed. Config Studio is running in pure minimal mode.',
    catalogTitle: 'Official Plugins Catalog',
    catalogDesc: 'On-demand modular extensions. Install only the features you actually need.',
    installCatalogBtn: 'Install',
    installedBadge: 'Installed',
    builtin: 'Built-in',
    pluginEnabled: 'Enabled',
    pluginDisabled: 'Disabled',
    author: 'Author',
    version: 'Version',
    permissions: 'Permissions',
    fileMatches: 'Supported files',

    // Tab Profile & Sources
    tabProfile: 'Profile & Sources',
    headerPluginsTitle: 'Plugins',
    headerPluginsActive: 'active',

    // Audit Details Toggle
    hideDetails: '▲ Hide Details',
    showDetails: '▼ Show Event Details',
    auditRefreshing: 'Refreshing audit trail...',
    auditExporting: 'Exporting...',

    // Bottom Dock Settings
    dockStripSetting: 'Bottom Dock Strip',
    dockModeAuto: 'Auto (Zero-Clutter)',
    dockModeAutoDesc: 'Hidden when no active plugins',
    dockModeAlways: 'Always Visible',
    dockModeAlwaysDesc: '28px bottom dock bar',
    dockModeHidden: 'Disabled',
    dockModeHiddenDesc: 'Always hidden',

    // Structure Guard Settings
    structureGuardDesc:
      'Dual AST-syntax validation (YAML, JSON, TOML, .env, Nginx) before writing to disk. When errors are found, sensitive files are protected with a Force Save prompt.',
    criticalPatternsLabel: 'Custom sensitive file patterns (one per line):',
    criticalPatternsHelp: 'Default system masks are always active:',

    // Profile Portability & Sources
    profilePortabilityTitle: '1-Click Profile Portability',
    profilePortabilityDesc:
      'Export your themes, Deep Guard rules, and plugin list for instant deployment on any workstation or server.',
    exportProfileBtn: 'Export Profile (.json)',
    importProfileBtn: 'Import Profile (.json)',
    secretsExcludedNote: 'Passwords and secrets excluded by default',
    sourcesTitle: 'Trusted Plugin Sources',
    sourcesDesc:
      'Registries from which Config Studio fetches official and community extensions.',
    syncSources: 'Sync',
    syncingSources: 'Syncing...',
    addSourceBtn: 'Add Source',
    addSourceTitle: 'Connect New Plugin Source',
    sourceNameLabel: 'Source Name',
    sourceNamePlaceholder: 'e.g. Internal DevOps Registry',
    sourceUrlLabel: 'URL to registry.json',
    saveSourceBtn: 'Save Source',
    addingSource: 'Adding...',
    loadingSources: 'Loading plugin sources...',
    noSources: 'No plugin sources connected',
    officialBadge: 'Official',
    communityBadge: 'Community',
    pluginsCountSuffix: 'plugins',
    syncedPrefix: 'Synced:',
    deleteSourceTitle: 'Delete source',
    deletePluginTitle: 'Delete plugin',
    refreshPluginsList: 'Refresh plugins list',
    installHelpNote: 'Install modules from the catalog below, via ZIP upload, or from a GitHub repository.',
    githubUrlTip:
      'Direct links to GitHub repositories (e.g. https://github.com/author/plugin) or direct .zip archives are supported.',

    // Profile Import Modal
    importProfileModalTitle: 'Import Config Studio Profile',
    exportedAtPrefix: 'Exported:',
    safeTransferBadge: '100% Safe Portability:',
    safeTransferExplanation:
      'profile file contains only visual preferences, source catalogs, and plugin manifests. Passwords, auth keys, and tokens are strictly excluded.',
    themeSettingsLabel: 'Theme & UI Preferences',
    sourcesLabel: 'Plugin Sources & Registries',
    pluginsLabel: 'Profile Plugins',
    diffChanges: 'changes',
    diffNoChanges: 'No changes',
    diffNew: 'new',
    diffAllConnected: 'All connected',
    actionInstall: 'install',
    actionEnable: 'enable',
    actionInstalled: 'installed',
    applyingProfile: 'Applying profile...',
    applyProfile: 'Apply Profile',

    // Bottom Dock Strip
    dockTerminal: 'Terminal',
    dockTerminalTitle: 'SSH / Shell Terminal',
    dockProblems: 'Problems',
    dockOutput: 'Output',
    dockOutputTitle: 'Core Output & Audit Stream',
    dockProblemsTitle: 'Diagnostic & Syntax Issues',
    dockNoProblems: 'No issues detected. Configuration syntax is valid.',
    dockNoOutput: 'No output events recorded yet',
    dockErrors: 'errors',
    dockWarnings: 'warnings',
    sysinfoTitle: 'Node Monitoring',
    sysinfoCpu: 'CPU',
    sysinfoRam: 'RAM',
    sysinfoDisk: 'Disk',
    sysinfoUptime: 'Uptime',
    sysinfoFree: 'free',
    sysinfoTotal: 'total',
    sysinfoUsed: 'used',
    sysinfoCores: 'cores',
    sysinfoRefresh: 'Refresh',
    sysinfoOffline: 'Offline',
    dockToggleTooltip: 'Toggle Bottom Dock (Ctrl+~ / Ctrl+J)',
    dockResizeTooltip: 'Drag to resize dock height',
    dockRefreshTooltip: 'Refresh logs',
    dockMaximizeTooltip: 'Maximize',
    dockRestoreTooltip: 'Restore size',
    dockCloseTooltip: 'Collapse dock',

    // Context Menu
    ctxOpen: 'Open',
    ctxOpenFolder: 'Open Folder',
    ctxCopyPath: 'Copy Relative Path',
    ctxCopyPathSuccess: 'Path copied to clipboard',
    ctxNewFileHere: 'New File...',
    ctxNewFolderHere: 'New Folder...',
    ctxRename: 'Rename',
    ctxDelete: 'Delete',
    ctxRefresh: 'Refresh',

    // Workspaces
    workspaces: 'Workspaces',
    addWorkspace: 'Add Folder',
    addWorkspaceTitle: 'Add Workspace Folder',
    editWorkspaceTitle: 'Workspace Settings',
    workspaceId: 'Identifier (ID)',
    workspaceName: 'Folder Name',
    workspacePath: 'Path on Host / Server',
    workspaceIcon: 'Icon',
    workspaceReadOnly: 'Read-Only Mode',
    workspaceReadOnlyBadge: 'Read-Only',
    removeWorkspaceConfirm: 'Remove "{name}" from workspace?\n\nFiles on disk will remain untouched, only the workspace reference will be removed.',
    removeWorkspace: 'Remove from Workspace',

    // Secrets & Credentials Store
    tabSecrets: 'Secrets & Keys',
    secretsTitle: 'Secure Secrets Store (OS Keychain)',
    secretsSubtitle: 'Encrypted storage for passwords, SSH keys, and tokens in OS Keychain.',
    backendLabel: 'Storage Backend:',
    zeroSecretNotice: '100% Zero-Secret Guarantee: Secrets are strictly isolated and never exported in profiles.',
    authRequiredToManage: 'Secrets Management Locked',
    authRequiredHelp: 'To view, add, and edit secrets, enable password protection (Direct Login) in the Security section.',
    privilegedLocked: 'Secrets Locked',
    privilegedLockedHelp: 'Admin password confirmation is required to enter privileged mode.',
    unlockSecretsBtn: 'Unlock Secrets',
    unlockModalTitle: 'Confirm Admin Password',
    unlockPasswordPlaceholder: 'Enter admin password...',
    unlockSubmit: 'Unlock',
    unlocking: 'Verifying...',
    privilegedActiveBadge: 'Privileged Mode Active',
    addSecretBtn: 'Add Secret',
    addSecretModalTitle: 'New Secret',
    editSecretModalTitle: 'Edit Secret',
    secretTitleLabel: 'Title',
    secretTitlePlaceholder: 'e.g., Prod Servers Root Password',
    secretIdLabel: 'Identifier (ID)',
    secretIdPlaceholder: 'e.g., shared:prod-root',
    secretTypeLabel: 'Secret Type',
    secretTypePassword: 'Password',
    secretTypeSSHKey: 'SSH Private Key',
    secretTypeToken: 'API Token',
    secretTypeCertificate: 'Certificate / TLS',
    secretTypeEnv: 'Environment Variable',
    secretTypeOther: 'Other',
    filterAll: 'All',
    filterPasswords: 'Passwords',
    filterSSHKeys: 'SSH Keys',
    filterTokens: 'API Tokens',
    filterCertificates: 'Certificates',
    filterEnv: 'Env / Variables',
    filterOther: 'Other',
    searchSecretsPlaceholder: 'Search by title or ID...',
    noSecretsFoundFiltered: 'No secrets found in this category',
    clearFilter: 'Clear filter',
    secretScopeLabel: 'Scope',
    secretScopeShared: 'Shared (for all hosts and servers)',
    secretScopePlugin: 'Plugin-specific',
    secretValueLabel: 'Value',
    secretValuePlaceholder: 'Enter password, token, or private key...',
    saveSecretBtn: 'Save Secret',
    savingSecret: 'Saving...',
    noSecretsFound: 'No secrets saved yet',
    secretDeleteConfirm: 'Are you sure you want to delete secret "{name}"?',
    secretDeleted: 'Secret deleted',
    secretSaved: 'Secret successfully saved',
    revealSecret: 'Reveal Value',
    hideSecret: 'Hide Value',
    copiedToClipboard: 'Copied to clipboard',
  },
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
    // English as default base fallback, overridden by custom pack translations
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
