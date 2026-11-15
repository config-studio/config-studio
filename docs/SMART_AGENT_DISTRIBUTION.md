# Архитектура: Smart Plugin-Embedded Agent Distribution

## 1. Обзор и концепция

В Config Studio доставка и обновление удаленного демона мониторинга и управления (**Remote Agent**, `config-studio-agent`) реализованы по принципу **«Smart Plugin-Embedded Agent Distribution»**.

Вместо внедрения скомпилированных бинарников агента в основной исполняемый файл приложения (что привело бы к раздуванию основного бинарника Config Studio на десятки мегабайт и необходимости перекомпилировать ядро при каждом обновлении агента), скомпилированные бинарники агента под поддерживаемые платформы (`linux/amd64` и `linux/arm64`) упаковываются напрямую внутрь пакета плагина **Servers & Fleet Manager** (`servers.cspkg`) в поддиректорию `agents/`.

```
servers.cspkg (MRS / ZIP payload)
├── plugin.json                <-- Метаданные плагина (v1.4.0) и блока "agent" (v2.3.0)
├── main.js                    <-- UI переключателя, модальные окна, TOTP Web Crypto
├── style.css                  <-- Стили дизайн-системы @config-studio/ui
└── agents/                    <-- Встроенные кросс-платформенные бинарники агента
    ├── config-studio-agent-linux-amd64
    └── config-studio-agent-linux-arm64
```

---

## 2. Ключевые преимущества архитектуры

* **Поддержка изолированных сред (Air-Gapped / NAT):** Целевым Linux-серверам не требуется выход в Интернет, доступ к GitHub или сторонним репозиториям пакетов. Источником бинарника выступает сам плагин `servers.cspkg` на машине оператора. Передача идет по уже открытому SSH/SFTP-туннелю.
* **Стриминг `ZIP -> SFTP` без временных файлов на хосте:** Поток байтов бинарника читается напрямую из открытого архива `servers.cspkg` (`cspkg.OpenZipReader`) в поток удаленного SFTP-файла через `io.Copy`. На клиентском ПК в папку `%TEMP%` ничего не распаковывается, что исключает мусор на диске и ложные срабатывания Windows Defender.
* **Автоматическая доставка через двойное версионирование:** При обновлении агента patch-версия плагина инкрементируется (`1.4.0 -> 1.4.1`). Стандартный менеджер плагинов Config Studio (`PluginsTab`) автоматически обнаруживает обновление по правилам SemVer и предлагает обновить плагин в 1 клик.

---

## 3. Решение ключевых ловушек ядра Linux

### 3.1. Защита от `EXDEV (Invalid cross-device link)`
Системный вызов `rename()` (лежащий в основе `sftpClient.PosixRename`) атомарен только в пределах одной точки монтирования. На большинстве дистрибутивов Linux (Debian, Ubuntu, Alpine) каталог `/tmp` смонтирован в оперативной памяти (`tmpfs`), а `/usr/local/bin` расположен на корневом диске `/`.
* **Решение:** Временный файл загружается строго в ту же директорию, где расположен целевой бинарник:
  ```go
  tmpBin := targetBinPath + ".tmp" // /usr/local/bin/config-studio-agent.tmp
  ```
  Это гарантирует нахождение `tmpBin`, `targetBinPath` и `bakBin` на одной файловой системе, благодаря чему атомарный перенос через `PosixRename` отрабатывает мгновенно.

### 3.2. Устранение `ETXTBSY (Text file busy)` через ротацию Inode
В Linux нельзя открыть на перезапись запущенный исполняемый файл:
1. Загрузка бинарника во временный путь `targetBinPath + ".tmp"`.
2. `chmod 0755` на временный файл.
3. Атомарный перенос запущенного бинарника: `PosixRename(targetBinPath, targetBinPath + ".bak")`. У работающего процесса сохраняется активный дескриптор в памяти, а ссылка в директории освобождается.
4. Атомарное продвижение нового бинарника: `PosixRename(tmpBin, targetBinPath)`.
5. Перезапуск демона (`systemctl` / `rc-service` / `nohup`).
6. Проверка доступности `/api/health`. При сбое срабатывает **автоматический откат**: `PosixRename(targetBinPath + ".bak", targetBinPath)` и повторный запуск старой версии.

### 3.3. Лимит ядра `TASK_COMM_LEN` (15 символов) и защита SSH-сессий
Короткое имя процесса в Linux (`/proc/$PID/comm`) ограничено 15 символами. Имя `config-studio-agent` имеет длину 19 символов (обрезается до `config-studio-a`), поэтому `pkill -x config-studio-agent` не находит процесс.
* **Решение:** Использование регулярного выражения с квадратными скобками:
  ```bash
  pkill -f '[c]onfig-studio-agent' || true; nohup %s -config %s/agent.yaml -port %d </dev/null >/dev/null 2>&1 &
  ```
  * Процесс демона `/usr/local/bin/config-studio-agent` совпадает с регулярным выражением и штатно завершается.
  * Родительская оболочка SSH `sh -c "pkill -f '[c]onfig-studio-agent'..."` содержит буквальные скобки и **не совпадает** сама с собой, поэтому сессия SSH не обрывается.
  * Перенаправление `</dev/null >/dev/null 2>&1 &` отвязывает потоки ввода-вывода и предотвращает зависание вызова `session.Run()` в Go.

---

## 4. Категория `agent_credentials` в Core Vault

Для хранения реквизитов подключения агента в ядре Config Studio выделена специализированная категория секретов:
* `TypeAgentCredentials = "agent_credentials"` (в `internal/secrets/types.go`).
* Хранилище: JSON-связка `{ "keyId": "cs_key_...", "secret": "..." }` с двухсоставной TOTP-аутентификацией.
* В UI Настроек: выделенный таб «Agent Credentials» с фирменной бирюзовой иконкой молнии `Zap`.
* В селекторе модального окна узла: приоритетное отображение с бейджем `AGENT` бирюзового цвета.
* В модальном окне выбора SSH-ключей: секреты агентов отфильтрованы и скрыты, чтобы не создавать путаницы.

---

## 5. Пайплайн CI/CD (GitHub Actions)

### 5.1. Репозиторий ядра (`config-studio`)
Workflow `.github/workflows/build.yml` при сборке релиза компилирует кросс-платформенные бинарники агента:
```bash
VERSION="${GITHUB_REF_NAME#v}"
LDFLAGS="-s -w -X main.Version=${VERSION} -X main.Commit=${GITHUB_SHA::7} -X main.BuildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$LDFLAGS" -o release-binaries/config-studio-agent-linux-amd64 ./cmd/agent
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="$LDFLAGS" -o release-binaries/config-studio-agent-linux-arm64 ./cmd/agent
```
Срез префикса `${GITHUB_REF_NAME#v}` обеспечивает соответствие чистому SemVer (`2.3.0` вместо `v2.3.0`).

### 5.2. Репозиторий плагина (`config-studio-servers`)
Workflow `.github/workflows/package.yml` запускается по расписанию (раз в сутки в 03:00 UTC), по вебхуку `repository_dispatch` или вручную:
1. Проверяет последний релиз Config Studio через GitHub API.
2. Сравнивает версию агента с полем `agent.version` в `plugin.json`.
3. При обнаружении новой версии:
   - Скачивает бинарники в `agents/`.
   - Вычисляет SHA-256 чексуммы.
   - Обновляет блок `agent` в `plugin.json`.
   - Инкрементирует patch-версию плагина (`1.4.0` -> `1.4.1`).
   - Упаковывает `servers.cspkg` через утилиту `cspkg pack`.
   - Публикует новый GitHub Release с артефактом `servers.cspkg`.
