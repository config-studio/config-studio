# Config Studio 🚀

[![Build & Release](https://github.com/config-studio/config-studio/actions/workflows/build.yml/badge.svg)](https://github.com/config-studio/config-studio/actions/workflows/build.yml)
[![GitHub Release](https://img.shields.io/github/v/release/config-studio/config-studio?color=blue)](https://github.com/config-studio/config-studio/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [🇷🇺 Описание на русском](#-config-studio-на-русском) | [🇬🇧 English version below](#-config-studio-english)

---

## 🇷🇺 Config Studio (На русском)

Современный, легкий веб-редактор конфигурационных файлов со встроенным ядром **Monaco Editor** (как в VS Code), интерактивной картой структуры документа (**AST Map**), динамическим изменением ширины панелей и гибкой кастомизацией тем и брендинга.

Поставляется в виде **единого бинарного файла** под **Linux** и **Windows** без необходимости устанавливать Node.js, базы данных или другие внешние зависимости.

### 📸 Скриншоты интерфейса

![Главный интерфейс Config Editor](docs/screenshots/main-ui.png)
*Главное окно: проводник файлов, редактор с вкладками, быстрый переход по тегам и AST-карта структуры документа.*

![Настройки приложения и оформления](docs/screenshots/settings-modal.png)
*Окно настроек: смена названия и иконки приложения, выбор палитры Base & Accent, язык интерфейса, параметры авторизации и управление REST API.*

---

### ✨ Ключевые возможности

- **Ядро редактора Monaco Editor:**
  - Полноценный движок VS Code с подсветкой синтаксиса YAML, JSON, TOML, INI, Shell, Markdown, Dockerfile и др.
  - Автоматическая адаптация размера редактора при изменении ширины панелей.
- **Интерактивная карта структуры документа (AST Map):**
  - Иерархическое дерево с бейджами типов данных (`Object`, `List`, `String`, `Boolean`, `Number`, `Section`).
  - Быстрый переход к строке кода кликом по элементу дерева.
  - Поиск по структуре с подсчетом совпадений (`X из Y`) и стрелками перехода.
  - Кнопки «Свернуть все» и «Развернуть все».
  - **Плавное изменение ширины панели** перетаскиванием левой границы (двойной клик сбрасывает на 320px, запоминает ширину в `localStorage`).
  - Облако тегов корневых разделов под вкладками с поддержкой горизонтальной прокрутки колесиком мыши.
- **Мультивкладочность и управление файлами:**
  - Открытие нескольких файлов во вкладках с индикатором несохраненных изменений.
  - Диалоговое окно подтверждения закрытия при наличии правок.
  - Быстрый поиск и переключение между файлами (**Ctrl+P**).
  - Проводник файлов: создание, удаление, переименование файлов и папок, Drag-and-drop загрузка.
  - Свойства файла: подсчет SHA-256 хеша с кнопкой копирования, статистика по строкам и символам.
  - Локальная история правок сессии с просмотром diff и восстановлением любой версии.
- **Брендинг, стили и локализация:**
  - Динамическая смена названия программы (обновляет заголовок и название вкладки браузера).
  - Загрузка собственного логотипа (.svg, .png, .ico, .webp) — меняет логотип и favicon.
  - Выбор палитры базового цвета (фон) и акцентного цвета (кнопки, курсор) с авто-контрастом шрифта.
  - Темная и светлая темы оформления.
  - Мультиязычный интерфейс (**Русский** и **English**).
- **Безопасность:**
  - Встроенный экран авторизации (парольная защита).
  - Поддержка SSO-прокси (Authentik, Authelia и Traefik) через HTTP-заголовки.
  - Отключаемый REST API с генератором секретных ключей `X-API-Key`.
- **Единый переносимый бинарник:**
  - Полностью статический исполняемый файл (`CGO_ENABLED=0`).
  - Фронтенд встроен внутрь бинарника (`go:embed`).
  - Автоматическая установка в качестве службы Linux (`-install` / `-uninstall`) с автоопределением **systemd** и **OpenRC**.
- **Нативный SSH и SFTP в ядре (Core SSH/SFTP v2.0+):**
  - Интерактивный терминал xterm.js в нижней док-панели (`BottomDockStrip`) с поддержкой множественных сессий и переподключения.
  - Двухвкладочный сайдбар проводника: мгновенное переключение между «Рабочими областями» и «SFTP».
  - Прямое редактирование удаленных файлов серверов в Monaco Editor с автосохранением на сервер (`Ctrl+S`).
- **Time Machine (Визуальное версионирование и откат в 2 клика):**
  - Автоматические персистентные снимки при каждом сохранении файла.
  - Monaco DiffEditor для side-by-side сравнения текущей версии с историей (`Alt+H`) и откат в 2 клика.
- **Мульти-рабочие области ядра (Multi-Root Workspaces & `workspaces.yaml`):**
  - Подключение нескольких папок и дисков в единое дерево проводника с защитой выхода за границы (`SafePath`).
- **Аппаратная телеметрия ядра (SysInfo):**
  - Индикатор `SysInfoBar` в строке состояния (нагрузка CPU %, физическая RAM, свободное место на диске, аптайм).
  - Детальное модальное окно диагностики `SysInfoModal` и автоматический шеринг метрик с удаленными узлами флота.
- **Модульная система плагинов и бинарный формат .cspkg (Plugin System v2.1):**
  - **Бинарный MRS-контейнер `.cspkg`**: сверхбыстрое чтение пакетов на лету прямо из памяти с проверкой SHA-256.
  - **Гибридная установка**: Drag-and-drop пакетов `.cspkg`/`.zip` в окно, установка по URL или из каталога в 1 клик.
  - **Безопасная шина сервисов и хранилище Core Vault**: обмен сервисами (`services.getOptional`) и защита секретов в OS Keychain.
  - **Официальные расширения экосистемы**:
    - 🖥️ **[config-studio-servers](https://github.com/config-studio/config-studio-servers)**: «Серверы и Флот» — централизованный инвентарь `servers.yaml`, универсальный переключатель в шапке, 1-Click установка демона, сопряжение в локальной сети (LAN Discovery) и безопасное управление ключами через Core Vault.
    - 🌐 **[config-studio-web-devkit](https://github.com/config-studio/config-studio-web-devkit)**: Живой предпросмотр HTML/PHP с симуляцией вкладки Chrome, сервер :8085, AST-структура и автодополнение Monaco.
  - 🧩 **[Официальный каталог плагинов](https://config-studio.github.io/config-studio-plugins/)** и **[Интерактивная витрина дизайн-системы @config-studio/ui](https://config-studio.github.io/config-studio-plugins/ui.html)**.

---

### 🚀 Быстрый запуск

#### Скачивание готового бинарника
Скачайте бинарник для вашей системы со страницы **[GitHub Releases](https://github.com/config-studio/config-studio/releases)**:
- **Windows (amd64)**: `config-studio-windows-amd64.exe`
- **Linux (x86_64 / amd64)**: `config-studio-linux-amd64`
- **Linux (ARM64)**: `config-studio-linux-arm64`

#### Запуск на Linux:
```bash
chmod +x config-studio-linux-amd64
./config-studio-linux-amd64 --port 8080 --workdir /etc/yaml-configs
```

#### Автоустановка в качестве службы (Linux systemd / OpenRC):
Бинарник умеет сам устанавливать и настраивать системный демон:
```bash
# Установка сервиса (автоматически определит systemd или OpenRC):
sudo ./config-studio-linux-amd64 -install

# Удаление сервиса:
sudo ./config-studio-linux-amd64 -uninstall
```

#### Запуск на Windows:
```powershell
.\config-studio-windows-amd64.exe -port 8080 -workdir C:\configs
```
После запуска откройте в браузере: `http://localhost:8080` (или `http://<IP-сервера>:8080`).

---

### 🛠️ Сборка из исходников

#### Требования:
- **Go 1.22+**
- **Node.js 20+** & **npm**

```bash
# 1. Клонирование репозитория
git clone https://github.com/config-studio/config-studio.git
cd config-studio

# 2. Сборка веб-интерфейса
cd web
npm install
npm run build
cd ..

# 3. Компиляция бинарника
# Для Linux:
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o bin/config-studio ./cmd/server

# Для Windows:
go build -ldflags="-s -w" -o bin/config-studio.exe ./cmd/server
```

---

### ⚙️ Флаги запуска и переменные окружения

| Флаг | Переменная окружения | По умолчанию | Описание |
|---|---|---|---|
| `--port` | `CONFIG_PORT` | `8080` | Порт HTTP сервера |
| `--workdir` | `CONFIG_WORKDIR` | `./data/configs` | Папка с редактируемыми конфигами |
| `--data` | `CONFIG_DATADIR` | `./data` | Папка для настроек, логотипов и сессий |
| `--auth-user` | `CONFIG_AUTH_USER` | `""` | Логин базовой авторизации |
| `--auth-pass` | `CONFIG_AUTH_PASS` | `""` | Пароль авторизации |
| `-install` | — | `false` | Установить как службу systemd/OpenRC (Linux) |
| `-uninstall` | — | `false` | Удалить службу systemd/OpenRC (Linux) |

---
---

<a name="english-version"></a>
## 🇬🇧 Config Studio (English)

Modern, lightweight web-based configuration editor powered by **Monaco Editor** (VS Code core), interactive document structure map (**AST Map**), draggable resizable sidebars, and customizable branding.

Shipped as a **single standalone portable binary** for **Linux** and **Windows** with zero external runtime dependencies (no Node.js or databases needed at runtime).

### 📸 Screenshots

![Config Editor Main Interface](docs/screenshots/main-ui.png)
*Main Workspace: file explorer, multi-tab editor, quick jump tag cloud, and AST structure map.*

![Settings and Branding Modal](docs/screenshots/settings-modal.png)
*Settings: application title & favicon, Base & Accent color palettes, language switch, security credentials, and REST API management.*

---

### ✨ Features

- **Monaco Editor Core:** Full VS Code editor experience with syntax highlighting for YAML, JSON, TOML, INI, Shell, Markdown, and Dockerfile.
- **Interactive Structure Outline (AST Map):**
  - Hierarchical tree navigation with data type badges (`Object`, `List`, `String`, `Boolean`, `Number`, `Section`).
  - Click any node to instantly jump to the corresponding code line.
  - Search within outline with match counter (`X of Y`) and navigation arrows.
  - One-click "Collapse All" / "Expand All" controls.
  - **Draggable resizable panel width** (double-click resets to default 320px, state remembered in `localStorage`).
  - Horizontal scrollable quick jump root tag cloud.
- **Multi-Tab File Management:**
  - Tabbed editing with dirty indicators.
  - Unsaved changes confirmation dialog.
  - Quick File Switcher / Search (**Ctrl+P**).
  - File Explorer with folder navigation, inline create/rename/delete, and drag-and-drop file upload.
  - File properties with instant SHA-256 hash calculation, one-click clipboard copy, and line/char statistics.
  - Session edit history with visual diff preview and single-click revision rollback.
- **Branding & Localization:**
  - Dynamic application title (updates navbar and browser tab `<title>`).
  - Custom logo & favicon upload (.svg, .png, .ico, .webp).
  - Material 3 Base & Accent color pickers with automatic font contrast calculation.
  - Dark and Light theme modes.
  - Dual interface language support (**English** / **Русский**).
- **Security & Access Control:**
  - Built-in login screen with direct password protection.
  - Reverse proxy SSO compatibility (Authentik, Authelia, Traefik).
  - Disableable REST API with secret `X-API-Key` generation.
- **Single Binary Portability:**
  - Statically compiled standalone binary (`CGO_ENABLED=0`).
  - Web UI assets embedded directly into the Go binary (`go:embed`).
  - Built-in service installer (`-install` / `-uninstall`) with auto-detection for **systemd** and **OpenRC**.
- **Native Core SSH & SFTP (Core v2.0+):**
  - Interactive xterm.js terminal in persistent bottom dock (`BottomDockStrip`) with multi-session support and auto-reconnect.
  - Dual-tab file sidebar: seamless switching between "Workspaces" and remote "SFTP" servers.
  - Direct remote editing in Monaco Editor with automatic remote saves on `Ctrl+S`.
- **Time Machine (Visual History & 2-Click Rollback):**
  - Persistent automatic snapshots created upon every file save.
  - Monaco DiffEditor for side-by-side delta inspection (`Alt+H`) with single-click revision rollback.
- **Multi-Root Workspaces (`workspaces.yaml`):**
  - Mount multiple local/remote directory roots into a unified tree explorer with boundary-safe path enforcement (`SafePath`).
- **Hardware Telemetry & Node Monitoring (Core SysInfo):**
  - Dynamic `SysInfoBar` status bar widget showing CPU load %, physical RAM, disk usage, and system uptime.
  - Comprehensive `SysInfoModal` diagnostics modal with live telemetry sharing from remote fleet nodes.
- **Modular Plugin System & .cspkg Binary Packages (Plugin System v2.1):**
  - **Binary MRS Containers (`.cspkg`)**: Ultra-fast in-memory package loading verified by cryptographic SHA-256 checksums.
  - **Hybrid Installation**: Drag-and-drop `.cspkg`/`.zip` packages, install via direct URL, or browse the official registry.
  - **Secure Services Bus & Core Vault**: RPC service sharing (`services.getOptional`) and secure OS Keychain secret storage.
  - **Official Ecosystem Plugins**:
    - 🖥️ **[config-studio-servers](https://github.com/config-studio/config-studio-servers)**: "Servers & Fleet Manager" — centralized `servers.yaml` inventory, universal header switcher, 1-Click daemon auto-onboarding, LAN agent discovery, and Zero-Secret Vault security.
    - 🌐 **[config-studio-web-devkit](https://github.com/config-studio/config-studio-web-devkit)**: Live HTML/PHP preview with Chrome tab simulation, embedded :8085 web server, AST structure outline, and Monaco completions.
  - 🧩 **[Official Plugin Registry](https://config-studio.github.io/config-studio-plugins/)** and **[Design System Showcase (@config-studio/ui)](https://config-studio.github.io/config-studio-plugins/ui.html)**.

---

### 🚀 Quick Start

#### Download Pre-compiled Binary
Grab the latest release from **[GitHub Releases](https://github.com/config-studio/config-studio/releases)**:
- **Windows (amd64)**: `config-studio-windows-amd64.exe`
- **Linux (x86_64 / amd64)**: `config-studio-linux-amd64`
- **Linux (ARM64)**: `config-studio-linux-arm64`

#### Running on Linux:
```bash
chmod +x config-studio-linux-amd64
./config-studio-linux-amd64 --port 8080 --workdir /etc/yaml-configs
```

#### Self-Installing as a Service (Linux systemd / OpenRC):
```bash
# Auto-detects systemd or OpenRC and registers system daemon:
sudo ./config-studio-linux-amd64 -install

# To uninstall service:
sudo ./config-studio-linux-amd64 -uninstall
```

#### Running on Windows:
```powershell
.\config-studio-windows-amd64.exe -port 8080 -workdir C:\configs
```
Open your browser at `http://localhost:8080`.

---

### 🛠️ Building from Source

#### Prerequisites:
- **Go 1.22+**
- **Node.js 20+** & **npm**

```bash
# 1. Clone repository
git clone https://github.com/config-studio/config-studio.git
cd config-studio

# 2. Build Web Frontend
cd web
npm install
npm run build
cd ..

# 3. Build Go Binary
# For Linux:
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o bin/config-studio ./cmd/server

# For Windows:
go build -ldflags="-s -w" -o bin/config-studio.exe ./cmd/server
```

---

### ⚙️ Command Line Flags & Environment Variables

| Flag | Environment Variable | Default | Description |
|---|---|---|---|
| `--port` | `CONFIG_PORT` | `8080` | HTTP port to listen on |
| `--workdir` | `CONFIG_WORKDIR` | `./data/configs` | Working directory containing config files |
| `--data` | `CONFIG_DATADIR` | `./data` | Directory for persistent settings and icons |
| `--auth-user` | `CONFIG_AUTH_USER` | `""` | Basic Auth username (disabled if empty) |
| `--auth-pass` | `CONFIG_AUTH_PASS` | `""` | Basic Auth password |
| `-install` | — | `false` | Install as systemd/OpenRC service (Linux) |
| `-uninstall` | — | `false` | Uninstall systemd/OpenRC service (Linux) |

---

## 📄 License
MIT License.
