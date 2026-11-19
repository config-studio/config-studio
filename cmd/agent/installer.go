package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"config-studio/internal/agent"
)

const (
	agentTargetBinaryPath = "/usr/local/bin/config-studio-agent"
	agentConfigDir        = "/etc/config-studio"
	agentDefaultConfig    = "/etc/config-studio/agent.yaml"
	agentSystemdUnitPath  = "/etc/systemd/system/config-studio-agent.service"
	agentOpenrcScriptPath = "/etc/init.d/config-studio-agent"
)

// InstallOptions encapsulates flags for agent installation and config generation.
type InstallOptions struct {
	ConfigPath string
	Port       int
	Roots      string
	Name       string
	Host       string
	KeyID      string
	Secret     string
	TLS        bool
	Link       bool
	Raw        bool
}

func detectInitSystem() string {
	if _, err := os.Stat("/run/systemd/system"); err == nil {
		return "systemd"
	}
	if p, err := exec.LookPath("systemctl"); err == nil && p != "" {
		return "systemd"
	}
	if _, err := os.Stat("/run/openrc"); err == nil {
		return "openrc"
	}
	if p, err := exec.LookPath("rc-service"); err == nil && p != "" {
		return "openrc"
	}
	if _, err := os.Stat("/sbin/openrc-run"); err == nil {
		return "openrc"
	}
	return "unknown"
}

func parsePortString(s string, defaultPort int) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return defaultPort
	}
	p, err := strconv.Atoi(s)
	if err != nil || p <= 0 || p > 65535 {
		return defaultPort
	}
	return p
}

func parseRootsString(s string) []string {
	var roots []string
	if strings.TrimSpace(s) != "" {
		for _, part := range strings.Split(s, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				roots = append(roots, part)
			}
		}
	}
	if len(roots) == 0 {
		if runtime.GOOS == "windows" {
			roots = []string{"C:\\"}
		} else {
			roots = []string{"/"}
		}
	}
	return roots
}

func copyBinaryFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmpDst := dst + ".tmp"
	out, err := os.OpenFile(tmpDst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}

	if _, err = io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(tmpDst)
		return err
	}
	out.Close()

	return os.Rename(tmpDst, dst)
}

func runSystemCmd(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// GenerateOrUpdateAgentConfig creates or updates agent.yaml based on flags,
// strictly ensuring real cs_key_<32hex> tokens and base32 secrets.
func GenerateOrUpdateAgentConfig(cfgPath string, port int, roots []string, keyID, secret string, tlsEnabled bool) (*agent.Config, error) {
	if cfgPath == "" {
		if runtime.GOOS == "windows" {
			cfgPath = "agent.yaml"
		} else {
			cfgPath = agentDefaultConfig
		}
	}

	dir := filepath.Dir(cfgPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create config dir %s: %w", dir, err)
		}
	}

	if port <= 0 {
		port = 8085
	}

	// Check if already exists
	if _, err := os.Stat(cfgPath); err == nil {
		cfg, _, loadErr := agent.LoadOrInitConfig(cfgPath)
		if loadErr != nil {
			return nil, fmt.Errorf("failed to load existing config %s: %w", cfgPath, loadErr)
		}
		if port > 0 {
			cfg.Port = port
		}
		if len(roots) > 0 {
			cfg.Sandbox.AllowedRoots = roots
		}
		if tlsEnabled {
			cfg.TLS.Enabled = true
		}
		if keyID != "" {
			cfg.Master.KeyID = keyID
		}
		if secret != "" {
			cfg.Master.Secret = secret
		}
		if err := cfg.Save(); err != nil {
			return nil, fmt.Errorf("failed to save updated config: %w", err)
		}
		return cfg, nil
	}

	// Create fresh credentials if not explicitly provided
	if keyID == "" {
		keyID = agent.GenerateRandomToken("cs_key")
	}
	if secret == "" {
		secret = agent.GenerateBase32Secret(20)
	}

	// Create fresh config
	cfg := &agent.Config{
		Host:    "0.0.0.0",
		Port:    port,
		Adopted: false,
		TLS: agent.TLSConfig{
			Enabled: tlsEnabled,
		},
		Master: agent.MasterAuth{
			KeyID:  keyID,
			Secret: secret,
		},
		Sandbox: agent.SandboxConfig{
			AllowedRoots: roots,
			DeniedPaths: []string{
				"/etc/shadow",
				"/etc/gshadow",
				"/root/.ssh",
			},
		},
		ScopedTokens: []agent.ScopedToken{},
	}

	// Use agent's SafeWrite via Config.Save
	cfgData := fmt.Sprintf(`# config-studio-agent configuration
host: "%s"
port: %d
adopted: false
tls:
  enabled: %t
master:
  key_id: "%s"
  secret: "%s"
sandbox:
  allowed_roots:
%s
  denied_paths:
    - "/etc/shadow"
    - "/etc/gshadow"
    - "/root/.ssh"
`, cfg.Host, cfg.Port, cfg.TLS.Enabled, cfg.Master.KeyID, cfg.Master.Secret, formatYAMLRoots(cfg.Sandbox.AllowedRoots))

	if err := os.WriteFile(cfgPath, []byte(cfgData), 0600); err != nil {
		return nil, fmt.Errorf("failed to write %s: %w", cfgPath, err)
	}

	loadedCfg, _, err := agent.LoadOrInitConfig(cfgPath)
	if err != nil {
		return nil, err
	}
	return loadedCfg, nil
}

func formatYAMLRoots(roots []string) string {
	var sb strings.Builder
	for _, r := range roots {
		sb.WriteString(fmt.Sprintf("    - %q\n", r))
	}
	return strings.TrimRight(sb.String(), "\n")
}

// HandleInstall runs full installation of config-studio-agent as a service.
func HandleInstall(opts InstallOptions) {
	logMsg := func(format string, a ...interface{}) {
		if !opts.Raw {
			fmt.Printf(format+"\n", a...)
		}
	}

	cfgPath := opts.ConfigPath
	if cfgPath == "" {
		if runtime.GOOS == "windows" {
			cfgPath = "agent.yaml"
		} else {
			cfgPath = agentDefaultConfig
		}
	}

	roots := parseRootsString(opts.Roots)

	if runtime.GOOS != "linux" {
		// Non-linux (e.g. Windows or MacOS local test): generate config & output link
		cfg, err := GenerateOrUpdateAgentConfig(cfgPath, opts.Port, roots, opts.KeyID, opts.Secret, opts.TLS)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error generating agent config: %v\n", err)
			os.Exit(1)
		}

		link := cfg.GenerateConnectionLink(opts.Host, opts.Name, roots)
		if opts.Raw {
			fmt.Println(link)
			return
		}

		logMsg("==================================================================")
		logMsg("  Config Studio Remote Agent — Configuration Initialized")
		logMsg("==================================================================")
		logMsg("  Note:           System service auto-registration is supported on Linux (systemd/OpenRC).")
		logMsg("  Config:         %s", cfgPath)
		logMsg("  Listening:      http://0.0.0.0:%d", cfg.Port)
		logMsg("  API Token Key:  %s", cfg.Master.KeyID)
		logMsg("  TOTP Secret:    %s", cfg.Master.Secret)
		logMsg("  Allowed Roots:  %s", strings.Join(cfg.Sandbox.AllowedRoots, ", "))
		logMsg("")
		logMsg("  1-Click Connection Link:")
		logMsg("  %s", link)
		logMsg("==================================================================")
		return
	}

	// Linux service installation requires root
	if os.Geteuid() != 0 {
		fmt.Fprintf(os.Stderr, "Error: root privileges required to install system service. Please run with sudo: sudo %s -install ...\n", os.Args[0])
		os.Exit(1)
	}

	initSys := detectInitSystem()
	if initSys == "unknown" {
		fmt.Fprintf(os.Stderr, "Error: could not detect systemd or OpenRC on this system.\n")
		os.Exit(1)
	}

	logMsg("--> Detected init system: %s", initSys)

	// 1. Locate current binary and copy to /usr/local/bin/config-studio-agent
	selfPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to resolve current binary path: %v\n", err)
		os.Exit(1)
	}
	selfPath, _ = filepath.EvalSymlinks(selfPath)

	_ = os.MkdirAll("/usr/local/bin", 0755)
	if selfPath != agentTargetBinaryPath {
		logMsg("--> Installing binary to %s...", agentTargetBinaryPath)
		if err := copyBinaryFile(selfPath, agentTargetBinaryPath); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to copy binary to %s: %v\n", agentTargetBinaryPath, err)
			os.Exit(1)
		}
	} else {
		logMsg("--> Binary is already located at %s", agentTargetBinaryPath)
	}

	// 2. Prepare /etc/config-studio/agent.yaml
	logMsg("--> Configuring agent at %s...", cfgPath)
	cfg, err := GenerateOrUpdateAgentConfig(cfgPath, opts.Port, roots, opts.KeyID, opts.Secret, opts.TLS)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create agent configuration: %v\n", err)
		os.Exit(1)
	}

	// 3. Register and start system service
	if initSys == "systemd" {
		unitContent := fmt.Sprintf(`[Unit]
Description=Config Studio Remote Agent
After=network.target

[Service]
Type=simple
User=root
ExecStart=%s -config %s -port %d
Restart=always
RestartSec=3s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`, agentTargetBinaryPath, cfgPath, cfg.Port)

		logMsg("--> Writing systemd unit to %s...", agentSystemdUnitPath)
		if err := os.WriteFile(agentSystemdUnitPath, []byte(unitContent), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to write systemd unit: %v\n", err)
			os.Exit(1)
		}

		logMsg("--> Reloading systemd and enabling service...")
		_ = exec.Command("systemctl", "daemon-reload").Run()
		_ = exec.Command("systemctl", "enable", "config-studio-agent.service").Run()
		_ = exec.Command("systemctl", "restart", "config-studio-agent.service").Run()

	} else if initSys == "openrc" {
		openrcContent := fmt.Sprintf(`#!/sbin/openrc-run
description="Config Studio Remote Agent"
command="%s"
command_args="-config %s -port %d"
command_background="yes"
pidfile="/run/config-studio-agent.pid"

depend() {
	need net
	after firewall
}
`, agentTargetBinaryPath, cfgPath, cfg.Port)

		logMsg("--> Writing OpenRC service to %s...", agentOpenrcScriptPath)
		if err := os.WriteFile(agentOpenrcScriptPath, []byte(openrcContent), 0755); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to write OpenRC script: %v\n", err)
			os.Exit(1)
		}

		_ = exec.Command("rc-update", "add", "config-studio-agent", "default").Run()
		_ = exec.Command("rc-service", "config-studio-agent", "restart").Run()
	}

	// 4. Generate connection link
	link := cfg.GenerateConnectionLink(opts.Host, opts.Name, roots)

	if opts.Raw {
		// When -raw is requested, output strictly the connection link URI on stdout
		fmt.Println(link)
		return
	}

	logMsg("\n==================================================================")
	logMsg("  Config Studio Remote Agent v%s — Installed & Active", Version)
	logMsg("==================================================================")
	logMsg("  Status:         RUNNING (service: %s)", initSys)
	logMsg("  Binary:         %s", agentTargetBinaryPath)
	logMsg("  Config:         %s", cfgPath)
	logMsg("  Listening:      http://0.0.0.0:%d", cfg.Port)
	logMsg("  API Token Key:  %s", cfg.Master.KeyID)
	logMsg("  TOTP Secret:    %s", cfg.Master.Secret)
	logMsg("  Allowed Roots:  %s", strings.Join(cfg.Sandbox.AllowedRoots, ", "))
	logMsg("")
	logMsg("  1-Click Connection Link (copy & paste into Config Studio):")
	logMsg("  %s", link)
	logMsg("")
	logMsg("  Service Commands:")
	if initSys == "systemd" {
		logMsg("    systemctl status config-studio-agent")
		logMsg("    systemctl restart config-studio-agent")
		logMsg("    systemctl stop config-studio-agent")
	} else {
		logMsg("    rc-service config-studio-agent status")
		logMsg("    rc-service config-studio-agent restart")
		logMsg("    rc-service config-studio-agent stop")
	}
	logMsg("==================================================================")
}

// HandleUninstall removes the agent service and binary.
func HandleUninstall() {
	if runtime.GOOS != "linux" {
		fmt.Println("Service uninstallation (-uninstall) is designed for Linux systemd and OpenRC systems.")
		return
	}

	if os.Geteuid() != 0 {
		fmt.Fprintf(os.Stderr, "Error: root privileges required. Please run with sudo: sudo %s -uninstall\n", os.Args[0])
		os.Exit(1)
	}

	initSys := detectInitSystem()
	fmt.Printf("--> Detected init system: %s\n", initSys)

	if initSys == "systemd" {
		fmt.Println("--> Stopping and disabling systemd service...")
		_ = exec.Command("systemctl", "stop", "config-studio-agent.service").Run()
		_ = exec.Command("systemctl", "disable", "config-studio-agent.service").Run()
		_ = os.Remove(agentSystemdUnitPath)
		_ = exec.Command("systemctl", "daemon-reload").Run()
		_ = exec.Command("systemctl", "reset-failed").Run()
	} else if initSys == "openrc" {
		fmt.Println("--> Stopping and removing OpenRC service...")
		_ = exec.Command("rc-service", "config-studio-agent", "stop").Run()
		_ = exec.Command("rc-update", "del", "config-studio-agent", "default").Run()
		_ = os.Remove(agentOpenrcScriptPath)
	}

	_ = os.Remove(agentTargetBinaryPath)
	fmt.Printf("--> Removed binary %s\n", agentTargetBinaryPath)

	fmt.Println("\n==================================================================")
	fmt.Println("  Config Studio Remote Agent uninstalled successfully.")
	fmt.Printf("  Configuration file %s was preserved.\n", agentDefaultConfig)
	fmt.Println("  To remove all data completely: rm -rf /etc/config-studio")
	fmt.Println("==================================================================")
}
