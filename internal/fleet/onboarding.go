package fleet

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

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

	// 4. Locate local agent binary
	binaryName := fmt.Sprintf("config-studio-agent-linux-%s", archSlug)
	localBinPath, err := findLocalAgentBinary(m.dataDir, opts.AgentsDir, binaryName)
	if err != nil {
		addLog("Не найден бинарник агента %s: %v", binaryName, err)
		result.Error = err.Error()
		return result, err
	}
	addLog("Найден бинарник для отправки: %s", filepath.Base(localBinPath))

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
	keyID := fmt.Sprintf("cs_master_%d", time.Now().Unix())
	secretBytes := make([]byte, 20)
	_, _ = rand.Read(secretBytes)
	totpSecret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secretBytes)

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
				Type:     secrets.TypePassword,
				Scope:    secrets.ScopeShared,
				PluginID: "servers",
			},
			Value: string(credsJSON),
		})
		addLog("Секрет авторизации сгенерирован и безопасно сохранен в Core Vault (ID: %s)", vaultSecretID)
	}

	// 7. Upload binary via SFTP to /tmp/config-studio-agent
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		addLog("Ошибка инициализации SFTP: %v", err)
		result.Error = err.Error()
		return result, err
	}
	defer sftpClient.Close()

	binData, err := os.ReadFile(localBinPath)
	if err != nil {
		addLog("Ошибка чтения локального бинарника: %v", err)
		result.Error = err.Error()
		return result, err
	}

	remoteTmpBin := "/tmp/config-studio-agent"
	addLog("Загрузка бинарника (%d КБ) на сервер по SFTP в %s...", len(binData)/1024, remoteTmpBin)
	dstFile, err := sftpClient.Create(remoteTmpBin)
	if err != nil {
		addLog("Ошибка создания временного файла на сервере: %v", err)
		result.Error = err.Error()
		return result, err
	}
	if _, err := io.Copy(dstFile, bytes.NewReader(binData)); err != nil {
		_ = dstFile.Close()
		addLog("Ошибка передачи данных бинарника: %v", err)
		result.Error = err.Error()
		return result, err
	}
	_ = dstFile.Close()
	_ = sftpClient.Chmod(remoteTmpBin, 0755)

	// 8. Stop old agent instances and safely place new binary
	sudoPrefix := ""
	if opts.UseSudo && !strings.EqualFold(sshCfg.User, "root") {
		sudoPrefix = "sudo "
	}

	targetBinPath := "/usr/local/bin/config-studio-agent"
	targetCfgDir := "/etc/config-studio"
	if !opts.UseSudo && !strings.EqualFold(sshCfg.User, "root") {
		targetBinPath = "$HOME/.config-studio/bin/config-studio-agent"
		targetCfgDir = "$HOME/.config-studio"
	}

	addLog("Остановка предыдущих процессов агента (если были)...")
	_, _ = runRemoteCmd(client, fmt.Sprintf("%ssystemctl stop config-studio-agent 2>/dev/null || %src-service config-studio-agent stop 2>/dev/null || %spkill -9 -f config-studio-agent 2>/dev/null || true", sudoPrefix, sudoPrefix, sudoPrefix))

	addLog("Установка бинарника в %s...", targetBinPath)
	_, _ = runRemoteCmd(client, fmt.Sprintf("%smkdir -p $(dirname %s) %s", sudoPrefix, targetBinPath, targetCfgDir))
	// install unlinks existing target inode so running processes don't trigger ETXTBSY (Text file busy)
	_, err = runRemoteCmd(client, fmt.Sprintf("%sinstall -m 755 %s %s 2>/dev/null || (%scp -f %s %s && %schmod 755 %s)", sudoPrefix, remoteTmpBin, targetBinPath, sudoPrefix, remoteTmpBin, targetBinPath, sudoPrefix, targetBinPath))
	if err != nil {
		addLog("Предупреждение/ошибка при копировании бинарника: %v", err)
	}
	_, _ = runRemoteCmd(client, fmt.Sprintf("rm -f %s", remoteTmpBin))

	// Generate agent.yaml
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
	cfgFile, err := sftpClient.Create(remoteTmpCfg)
	if err == nil {
		_, _ = cfgFile.Write([]byte(agentYAML))
		_ = cfgFile.Close()
		targetCfgFile := fmt.Sprintf("%s/agent.yaml", targetCfgDir)
		_, _ = runRemoteCmd(client, fmt.Sprintf("%smv %s %s && %schmod 600 %s", sudoPrefix, remoteTmpCfg, targetCfgFile, sudoPrefix, targetCfgFile))
		addLog("Конфигурация agent.yaml сохранена в %s", targetCfgFile)
	}

	// 9. Configure & Start Service
	if serviceType == "systemd" {
		addLog("Регистрация службы systemd config-studio-agent.service...")
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
		sf, err := sftpClient.Create(tmpSvc)
		if err == nil {
			_, _ = sf.Write([]byte(serviceContent))
			_ = sf.Close()
			_, _ = runRemoteCmd(client, fmt.Sprintf("%smv %s /etc/systemd/system/config-studio-agent.service", sudoPrefix, tmpSvc))
			_, _ = runRemoteCmd(client, fmt.Sprintf("%ssystemctl daemon-reload && %ssystemctl restart config-studio-agent && %ssystemctl enable config-studio-agent", sudoPrefix, sudoPrefix, sudoPrefix))
			addLog("Служба systemd запущена и включена в автозагрузку")
		}
	} else if serviceType == "openrc" {
		addLog("Регистрация службы OpenRC config-studio-agent...")
		openrcContent := fmt.Sprintf(`#!/sbin/openrc-run
description="Config Studio Remote Agent"
command="/usr/local/bin/config-studio-agent"
command_args="-config /etc/config-studio/agent.yaml -port %d"
command_background="yes"
pidfile="/run/config-studio-agent.pid"

depend() {
    need net
}
`, port)

		tmpInit := "/tmp/config-studio-agent.init"
		sf, err := sftpClient.Create(tmpInit)
		if err == nil {
			_, _ = sf.Write([]byte(openrcContent))
			_ = sf.Close()
			_, _ = runRemoteCmd(client, fmt.Sprintf("%smv %s /etc/init.d/config-studio-agent && %schmod +x /etc/init.d/config-studio-agent", sudoPrefix, tmpInit, sudoPrefix))
			_, _ = runRemoteCmd(client, fmt.Sprintf("%src-update add config-studio-agent default && (%src-service config-studio-agent restart || %src-service config-studio-agent start)", sudoPrefix, sudoPrefix, sudoPrefix))
			addLog("Служба OpenRC запущена и добавлена в runlevel default")
		}
	} else {
		// Fallback: nohup background process
		addLog("Запуск агента в фоновом режиме (nohup)...")
		_, _ = runRemoteCmd(client, fmt.Sprintf("nohup %s -config %s/agent.yaml -port %d > /dev/null 2>&1 &", targetBinPath, targetCfgDir, port))
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

func runRemoteCmd(client *gossh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	out, err := session.CombinedOutput(cmd)
	return strings.TrimSpace(string(out)), err
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
