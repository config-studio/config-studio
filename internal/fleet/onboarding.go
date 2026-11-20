package fleet

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"config-studio/internal/agent"
	"config-studio/internal/cspkg"
	"config-studio/internal/secrets"
	"config-studio/internal/ssh"
	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"
)

// InstallAgentOptions defines customizable settings for the 1-Click remote agent installation.
type InstallAgentOptions struct {
	Port        int    `json:"port"`        // Custom listening port (default: 8085)
	UseSudo     bool   `json:"useSudo"`     // Run service and installation with sudo (default: true)
	ServiceType string `json:"serviceType"` // "auto", "systemd", "openrc", "none" (default: "auto")
	AgentsDir   string `json:"agentsDir"`   // Optional local directory where agent binaries reside
	UpgradeOnly bool   `json:"upgradeOnly"` // Preserve existing agent.yaml configuration and credentials
}

// InstallAgentResult captures execution logs and status.
type InstallAgentResult struct {
	Success  bool     `json:"success"`
	Logs     []string `json:"logs"`
	AgentURL string   `json:"agentUrl,omitempty"`
	Error    string   `json:"error,omitempty"`
}

// InstallAgent performs automated end-to-end installation of config-studio-agent via SSH.
func (m *Manager) InstallAgent(ctx context.Context, srvID string, opts InstallAgentOptions, sshMgr *ssh.ClientManager, secMgr *secrets.Manager) (*InstallAgentResult, error) {
	result := &InstallAgentResult{
		Logs: make([]string, 0),
	}

	addLog := func(format string, a ...any) {
		msg := fmt.Sprintf(format, a...)
		result.Logs = append(result.Logs, msg)
	}

	srv, err := m.GetServer(srvID)
	if err != nil {
		return nil, fmt.Errorf("server %q not found: %w", srvID, err)
	}

	if srv.ID == "localhost" {
		return nil, fmt.Errorf("cannot remote-install agent on localhost default node")
	}

	sshCfg := srv.Connection.SSH
	if sshCfg == nil || !sshCfg.Enabled {
		return nil, fmt.Errorf("SSH connection is not configured or disabled for server %q", srv.Name)
	}

	targetHost := strings.TrimSpace(sshCfg.Host)
	if targetHost == "" {
		return nil, fmt.Errorf("SSH host is empty for server %q", srv.Name)
	}

	// 1. Port customization
	port := opts.Port
	if port <= 0 || port > 65535 {
		port = 8085
	}
	addLog("Параметры установки: порт агента :%d, sudo: %t, сервис: %s", port, opts.UseSudo, opts.ServiceType)

	// 2. Connect via SSH
	addLog("Подключение по SSH к %s:%d (пользователь %s)...", targetHost, sshCfg.Port, sshCfg.User)
	sshReq := &ssh.Config{
		Host:       targetHost,
		Port:       sshCfg.Port,
		User:       sshCfg.User,
		IdentityID: sshCfg.Identity,
		TimeoutSec: 10,
	}
	if sshCfg.ProxyJump != "" {
		sshReq.JumpHost = &ssh.Config{
			Host: sshCfg.ProxyJump,
		}
	}

	client, err := sshMgr.Dial(ctx, sshReq)
	if err != nil {
		addLog("Ошибка SSH подключения: %v", err)
		result.Error = err.Error()
		return result, err
	}
	defer client.Close()
	addLog("SSH соединение успешно установлено!")

	runRemoteCmd := func(client *gossh.Client, cmd string) (string, error) {
		return runRemoteCmdWithContext(ctx, client, cmd)
	}

	// 3. Detect OS & Architecture
	unameS, err := runRemoteCmd(client, "uname -s")
	if err != nil {
		addLog("Ошибка определения ОС (uname -s): %v", err)
		result.Error = err.Error()
		return result, err
	}
	unameM, err := runRemoteCmd(client, "uname -m")
	if err != nil {
		addLog("Ошибка определения архитектуры (uname -m): %v", err)
		result.Error = err.Error()
		return result, err
	}
	addLog("Удаленная система: OS=%s, Arch=%s", unameS, unameM)

	if !strings.EqualFold(unameS, "Linux") {
		err := fmt.Errorf("1-Click установка сейчас поддерживается только для Linux (обнаружено %s)", unameS)
		addLog("Ошибка: %v", err)
		result.Error = err.Error()
		return result, err
	}

	var archSlug string
	switch strings.ToLower(unameM) {
	case "x86_64", "amd64":
		archSlug = "amd64"
	case "aarch64", "arm64":
		archSlug = "arm64"
	case "armv7l", "armv7":
		archSlug = "armv7"
	default:
		archSlug = "amd64"
	}

	// 4. Resolve agent binary stream (from servers.cspkg or local disk)
	binaryName := fmt.Sprintf("config-studio-agent-linux-%s", archSlug)
	binReader, binSize, binSource, err := getAgentBinaryStream(m.dataDir, opts.AgentsDir, binaryName)
	if err != nil {
		addLog("Не найден бинарник агента %s: %v", binaryName, err)
		result.Error = err.Error()
		return result, err
	}
	defer binReader.Close()
	addLog("Найден бинарник для отправки: %s (%d КБ)", binSource, binSize/1024)

	// 5. Detect Init System (systemd or openrc)
	serviceType := opts.ServiceType
	if serviceType == "" || serviceType == "auto" {
		if _, err := runRemoteCmd(client, "which systemctl"); err == nil {
			serviceType = "systemd"
		} else if _, err := runRemoteCmd(client, "which rc-service"); err == nil {
			serviceType = "openrc"
		} else {
			serviceType = "none"
		}
	}
	addLog("Выбрана система инициализации службы: %s", serviceType)

	// 6. Generate Master Key & TOTP Secret and store in Core Vault
	keyID := agent.GenerateRandomToken("cs_key")
	totpSecret := agent.GenerateBase32Secret(20)

	credsJSON, _ := json.Marshal(map[string]string{
		"keyId":  keyID,
		"secret": totpSecret,
	})

	vaultSecretID := fmt.Sprintf("agent:%s", srv.ID)
	if secMgr != nil {
		_ = secMgr.Set(secrets.SecretItem{
			SecretMeta: secrets.SecretMeta{
				ID:       vaultSecretID,
				Title:    fmt.Sprintf("Agent Credentials (%s)", srv.Name),
				Type:     secrets.TypeAgentCredentials,
				Scope:    secrets.ScopeShared,
				PluginID: "servers",
			},
			Value: string(credsJSON),
		})
		addLog("Секрет авторизации сгенерирован и безопасно сохранен в Core Vault (ID: %s)", vaultSecretID)
	}

	// 7. Initialize SFTP client with concurrent write acceleration
	sftpClient, err := sftp.NewClient(client, sftp.UseConcurrentWrites(true))
	if err != nil {
		addLog("Ошибка инициализации SFTP: %v", err)
		result.Error = err.Error()
		return result, err
	}
	defer sftpClient.Close()

	sudoPrefix := ""
	if opts.UseSudo && !strings.EqualFold(sshCfg.User, "root") {
		sudoPrefix = "sudo "
	}

	targetBinPath := "/usr/local/bin/config-studio-agent"
	targetCfgDir := "/etc/config-studio"
	if !opts.UseSudo && !strings.EqualFold(sshCfg.User, "root") {
		homeDir, _ := runRemoteCmd(client, "echo $HOME")
		if homeDir == "" {
			homeDir = "~"
		}
		targetBinPath = fmt.Sprintf("%s/.config-studio/bin/config-studio-agent", homeDir)
		targetCfgDir = fmt.Sprintf("%s/.config-studio", homeDir)
	}

	targetDir := filepath.Dir(targetBinPath)
	_, _ = runRemoteCmd(client, fmt.Sprintf("%smkdir -p %s %s", sudoPrefix, targetDir, targetCfgDir))

	// 8. Stream binary directly into target directory (.tmp) to guarantee same filesystem (avoids EXDEV)
	tmpBin := targetBinPath + ".tmp"
	bakBin := targetBinPath + ".bak"

	addLog("Потоковая передача бинарника по SFTP в %s...", tmpBin)
	dstFile, err := sftpClient.Create(tmpBin)
	if err != nil {
		// Fallback if targetDir is write-restricted for non-root: stream to /tmp and move via sudo
		fallbackTmp := "/tmp/config-studio-agent.tmp"
		dstFile, err = sftpClient.Create(fallbackTmp)
		if err != nil {
			addLog("Ошибка создания временного файла на сервере: %v", err)
			result.Error = err.Error()
			return result, err
		}
		if _, err := io.Copy(dstFile, binReader); err != nil {
			_ = dstFile.Close()
			addLog("Ошибка передачи данных бинарника: %v", err)
			result.Error = err.Error()
			return result, err
		}
		_ = dstFile.Close()
		_ = sftpClient.Chmod(fallbackTmp, 0755)
		_, _ = runRemoteCmd(client, fmt.Sprintf("%smv -f %s %s", sudoPrefix, fallbackTmp, tmpBin))
	} else {
		if _, err := io.Copy(dstFile, binReader); err != nil {
			_ = dstFile.Close()
			addLog("Ошибка передачи данных бинарника: %v", err)
			result.Error = err.Error()
			return result, err
		}
		_ = dstFile.Close()
	}
	_ = sftpClient.Chmod(tmpBin, 0755)

	// 9. Stop previous daemon instances and perform atomic replacement with PosixRename
	addLog("Остановка предыдущих процессов агента (если были)...")
	_, _ = runRemoteCmd(client, fmt.Sprintf("%ssystemctl stop config-studio-agent 2>/dev/null || %src-service config-studio-agent stop 2>/dev/null || %spkill -f '[c]onfig-studio-agent' 2>/dev/null || true", sudoPrefix, sudoPrefix, sudoPrefix))

	atomicRename := func(oldPath, newPath string) error {
		if err := sftpClient.PosixRename(oldPath, newPath); err == nil {
			return nil
		}
		if err := sftpClient.Rename(oldPath, newPath); err == nil {
			return nil
		}
		_, err := runRemoteCmd(client, fmt.Sprintf("%smv -f %s %s", sudoPrefix, oldPath, newPath))
		return err
	}

	hasOldBin := false
	if _, err := sftpClient.Stat(targetBinPath); err == nil {
		hasOldBin = true
		addLog("Резервное копирование текущего бинарника: %s -> %s", targetBinPath, bakBin)
		_ = atomicRename(targetBinPath, bakBin)
	}

	addLog("Атомарная активация нового бинарника: %s -> %s", tmpBin, targetBinPath)
	if err := atomicRename(tmpBin, targetBinPath); err != nil {
		addLog("Ошибка активации бинарника: %v", err)
		if hasOldBin {
			_ = atomicRename(bakBin, targetBinPath)
		}
		result.Error = err.Error()
		return result, err
	}

	// Check if agent.yaml should be preserved in upgrade mode
	targetCfgFile := fmt.Sprintf("%s/agent.yaml", targetCfgDir)
	shouldWriteConfig := true
	if opts.UpgradeOnly {
		checkOut, _ := runRemoteCmd(client, fmt.Sprintf("%stest -f %s && echo EXISTS", sudoPrefix, targetCfgFile))
		if strings.Contains(checkOut, "EXISTS") {
			shouldWriteConfig = false
			addLog("Сохранение существующей конфигурации и секретов агента (%s)", targetCfgFile)
		}
	}

	// 9. Configure & Start Service via the agent's native installer (-install)
	if serviceType == "systemd" || serviceType == "openrc" {
		addLog("Установка и запуск службы агента через нативный режим (%s -install)...", targetBinPath)
		var installCmd string
		rootsParam := "/"
		if srv.Connection.Agent != nil && len(srv.Connection.Agent.Roots) > 0 {
			rootsParam = strings.Join(srv.Connection.Agent.Roots, ",")
		}
		if opts.UpgradeOnly && !shouldWriteConfig {
			installCmd = fmt.Sprintf("%s%s -install -port %d -roots %q -name %q -host %q -raw",
				sudoPrefix, targetBinPath, port, rootsParam, srv.Name, targetHost)
		} else {
			installCmd = fmt.Sprintf("%s%s -install -port %d -roots %q -name %q -host %q -key %q -secret %q -raw",
				sudoPrefix, targetBinPath, port, rootsParam, srv.Name, targetHost, keyID, totpSecret)
		}

		installOut, err := runRemoteCmd(client, installCmd)
		if err != nil {
			addLog("Предупреждение: нативная установка завершилась с ошибкой (%v), применение резервного способа...", err)
			if shouldWriteConfig {
				agentYAML := fmt.Sprintf(`# config-studio-agent configuration
host: "0.0.0.0"
port: %d
adopted: true
tls:
  enabled: false
master:
  key_id: "%s"
  secret: "%s"
sandbox:
  allowed_roots:
    - "/"
  denied_paths:
    - "/etc/shadow"
    - "/etc/gshadow"
    - "/root/.ssh"
`, port, keyID, totpSecret)

				remoteTmpCfg := "/tmp/agent.yaml"
				if cfgFile, err := sftpClient.Create(remoteTmpCfg); err == nil {
					_, _ = cfgFile.Write([]byte(agentYAML))
					_ = cfgFile.Close()
					_, _ = runRemoteCmd(client, fmt.Sprintf("%smv %s %s && %schmod 600 %s", sudoPrefix, remoteTmpCfg, targetCfgFile, sudoPrefix, targetCfgFile))
					addLog("Конфигурация agent.yaml сохранена в %s", targetCfgFile)
				}
			}
			if serviceType == "systemd" {
				serviceContent := fmt.Sprintf(`[Unit]
Description=Config Studio Remote Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/config-studio-agent -config /etc/config-studio/agent.yaml -port %d
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`, port)
				tmpSvc := "/tmp/config-studio-agent.service"
				if sf, err := sftpClient.Create(tmpSvc); err == nil {
					_, _ = sf.Write([]byte(serviceContent))
					_ = sf.Close()
					_, _ = runRemoteCmd(client, fmt.Sprintf("%smv %s /etc/systemd/system/config-studio-agent.service", sudoPrefix, tmpSvc))
					_, _ = runRemoteCmd(client, fmt.Sprintf("%ssystemctl daemon-reload && %ssystemctl restart config-studio-agent && %ssystemctl enable config-studio-agent", sudoPrefix, sudoPrefix, sudoPrefix))
					addLog("Служба systemd запущена и включена в автозагрузку (резервный путь)")
				}
			}
		} else {
			addLog("✓ Служба %s успешно зарегистрирована, запущена и включена в автозагрузку", serviceType)
			cleanLink := ""
			for _, line := range strings.Split(installOut, "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "cs-agent://") {
					cleanLink = line
					break
				}
			}
			if cleanLink != "" {
				addLog("✓ Получена ссылка подключения агента: %s", cleanLink)
				if parsed, err := agent.ParseConnectionLink(cleanLink); err == nil {
					if parsed.Port > 0 && parsed.Port != port {
						addLog("✓ Порт %d был занят, агент автономно запущен на свободном порту: %d", port, parsed.Port)
						port = parsed.Port
					}
					if opts.UpgradeOnly && !shouldWriteConfig && parsed.KeyID != "" {
						keyID = parsed.KeyID
						totpSecret = parsed.Secret
						if secMgr != nil {
							credsJSON, _ := json.Marshal(map[string]string{
								"keyId":  keyID,
								"secret": totpSecret,
							})
							_ = secMgr.Set(secrets.SecretItem{
								SecretMeta: secrets.SecretMeta{
									ID:       vaultSecretID,
									Title:    fmt.Sprintf("Agent Credentials (%s)", srv.Name),
									Type:     secrets.TypeAgentCredentials,
									Scope:    secrets.ScopeShared,
									PluginID: "servers",
								},
								Value: string(credsJSON),
							})
						}
					}
				}
			}
		}
	} else {
		// Fallback: nohup background process (with stdio redirection and regex pkill to avoid hanging SSH)
		addLog("Запуск агента в фоновом режиме (nohup)...")
		_, _ = runRemoteCmd(client, fmt.Sprintf("pkill -f '[c]onfig-studio-agent' || true; nohup %s -config %s/agent.yaml -port %d </dev/null >/dev/null 2>&1 &", targetBinPath, targetCfgDir, port))
	}

	// 10. Health Check (Wait for daemon to open port)
	agentURL := fmt.Sprintf("http://%s:%d", targetHost, port)
	addLog("Проверка доступности агента по адресу %s/api/health...", agentURL)

	healthy := false
	httpClient := &http.Client{Timeout: 2 * time.Second}
	for i := 1; i <= 6; i++ {
		time.Sleep(1 * time.Second)
		resp, err := httpClient.Get(fmt.Sprintf("%s/api/health", agentURL))
		if err == nil && resp.StatusCode == http.StatusOK {
			healthy = true
			_ = resp.Body.Close()
			addLog("✓ Health check пройден: HTTP 200 OK на попытке %d/6", i)
			break
		}
		if resp != nil {
			_ = resp.Body.Close()
		}
	}

	if !healthy {
		// Fallback check: verify socket is listening on target via SSH
		checkNet, _ := runRemoteCmd(client, fmt.Sprintf("ss -tulpn | grep :%d || netstat -tulpn | grep :%d", port, port))
		if strings.Contains(checkNet, fmt.Sprintf(":%d", port)) {
			healthy = true
			addLog("✓ Порт :%d активен на удаленном сервере (сокет прослушивается)", port)
		} else {
			addLog("Предупреждение: Агент еще не ответил на внешнем порту (возможно, закрыт фаервол).")
		}
	}

	if !healthy {
		addLog("ОШИБКА: Health check не пройден после запуска агента (%s)", agentURL)
		if hasOldBin {
			addLog("Выполняется автоматический откат на предыдущую стабильную версию (.bak)...")
			_ = atomicRename(bakBin, targetBinPath)
			if serviceType == "systemd" {
				_, _ = runRemoteCmd(client, fmt.Sprintf("%ssystemctl restart config-studio-agent", sudoPrefix))
			} else if serviceType == "openrc" {
				_, _ = runRemoteCmd(client, fmt.Sprintf("%src-service config-studio-agent restart", sudoPrefix))
			} else {
				_, _ = runRemoteCmd(client, fmt.Sprintf("pkill -f '[c]onfig-studio-agent' || true; nohup %s -config %s/agent.yaml -port %d </dev/null >/dev/null 2>&1 &", targetBinPath, targetCfgDir, port))
			}
			addLog("Откат завершен. Предыдущая версия агента восстановлена.")
		}
		result.Error = fmt.Sprintf("health check failed on %s", agentURL)
		return result, fmt.Errorf("agent failed health check on %s", agentURL)
	}

	if hasOldBin {
		addLog("✓ Обновление успешно завершено! Резервная копия сохранена в %s", bakBin)
	}

	// 11. Update server in servers.yaml
	srv.Connection.Agent = &AgentConnectionConfig{
		Enabled:     true,
		URL:         agentURL,
		VaultSecret: vaultSecretID,
		TLSVerify:   false,
	}

	if err := m.AddOrUpdateServer(*srv); err != nil {
		addLog("Ошибка обновления servers.yaml: %v", err)
	} else {
		addLog("✓ servers.yaml обновлен: узел %s переведен в гибридный режим (3 кнопки действий)!", srv.Name)
	}

	result.Success = true
	result.AgentURL = agentURL
	return result, nil
}

func runRemoteCmdWithContext(ctx context.Context, client *gossh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	type cmdResult struct {
		out []byte
		err error
	}
	resChan := make(chan cmdResult, 1)
	go func() {
		out, err := session.CombinedOutput(cmd)
		resChan <- cmdResult{out: out, err: err}
	}()

	select {
	case <-ctx.Done():
		_ = session.Close()
		return "", ctx.Err()
	case res := <-resChan:
		return strings.TrimSpace(string(res.out)), res.err
	}
}

func runRemoteCmd(client *gossh.Client, cmd string) (string, error) {
	return runRemoteCmdWithContext(context.Background(), client, cmd)
}

// getAgentBinaryStream resolves the binary reader and metadata.
// 1. First priority: stream directly out of servers.cspkg (zero disk footprint on host)
// 2. Fallback: local filesystem in dataDir/agents or bin/agents
func getAgentBinaryStream(dataDir, optsAgentsDir, binaryName string) (io.ReadCloser, int64, string, error) {
	// 1. Try servers.cspkg in dataDir/plugins, plugins/, or test/data/plugins
	cspkgCandidates := []string{
		filepath.Join(dataDir, "plugins", "servers.cspkg"),
		filepath.Join("plugins", "servers.cspkg"),
		filepath.Join(dataDir, "servers.cspkg"),
		filepath.Join("data", "plugins", "servers.cspkg"),
	}

	for _, cspkgPath := range cspkgCandidates {
		if fi, err := os.Stat(cspkgPath); err == nil && !fi.IsDir() {
			zr, err := cspkg.OpenZipReader(cspkgPath)
			if err == nil {
				targetRel := "agents/" + binaryName
				for _, f := range zr.File {
					if filepath.ToSlash(filepath.Clean(f.Name)) == targetRel {
						rc, err := f.Open()
						if err == nil {
							return rc, int64(f.UncompressedSize64), fmt.Sprintf("%s (внутри %s)", targetRel, filepath.Base(cspkgPath)), nil
						}
					}
				}
			}
		}
	}

	// 2. Fallback: local binary on host filesystem
	localPath, err := findLocalAgentBinary(dataDir, optsAgentsDir, binaryName)
	if err != nil {
		return nil, 0, "", fmt.Errorf("бинарник агента %q не найден ни в .cspkg, ни на диске: %w", binaryName, err)
	}

	f, err := os.Open(localPath)
	if err != nil {
		return nil, 0, "", err
	}
	fi, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, 0, "", err
	}

	return f, fi.Size(), localPath, nil
}

func findLocalAgentBinary(dataDir, optsAgentsDir, binaryName string) (string, error) {
	candidates := []string{
		filepath.Join(optsAgentsDir, binaryName),
		filepath.Join(dataDir, "agents", binaryName),
		filepath.Join(dataDir, "..", "bin", "agents", binaryName),
		filepath.Join("bin", "agents", binaryName),
		filepath.Join(".", binaryName),
	}

	for _, p := range candidates {
		if p == "" {
			continue
		}
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return filepath.Abs(p)
		}
	}

	return "", fmt.Errorf("file %q not found in data/agents or bin/agents", binaryName)
}
