package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"config-studio/internal/agent"
)

var (
	Version   = "2.3.9"
	Commit    = "dev"
	BuildDate = "unknown"
)

func printUsage() {
	fmt.Printf(`Config Studio Remote Agent v%s (commit: %s, built: %s)
Lightweight, Zero-Trust Headless Daemon for Cloud & VPS Fleet Management.

USAGE:
    config-studio-agent [flags]
    config-studio-agent -install [options]
    config-studio-agent link [options]
    config-studio-agent token <action> [options]

INSTALLATION & SERVICE FLAGS:
    -install          Install agent as system service (systemd/OpenRC) and initialize agent.yaml
    -uninstall        Uninstall agent service and remove binary
    -port <int>       Override listening port (default: 8085)
    -roots <paths>    Allowed working roots comma-separated (e.g. /opt/projects,/var/www)
    -name <name>      Server node name for connection link (e.g. "Production VPS")
    -host <ip>        Override public IP/hostname in generated link
    -link             Generate 1-click import connection link
    -raw              Output only raw connection URI (ideal for curl/bash automation scripts)
    -tls              Enable HTTPS / TLS
    -config <path>    Path to agent.yaml (default: /etc/config-studio/agent.yaml on install, ./agent.yaml standalone)
    -version          Print agent version and exit

LINK COMMAND:
    link              Generate 1-click import connection link (cs-agent://...)
    link -raw         Output only the URI string (ideal for scripts and terminal pipes)
    link -host <ip>   Override public IP address in generated link
    link -name <node> Set custom node name in link fragment (#node)
    link -roots <p1,p2> Set multiple working directories in query parameters (?roots=...)

TOKEN COMMANDS:
    token list
    token create -id <name> -desc <description> -topics <comma,separated,topics>
    token delete -id <name>

TOPICS AVAILABLE:
    metrics           System metrics (CPU, RAM, Disks, Load, Prometheus format)
    health            Ping and uptime status
    logs:<path>       Read-only access to log directory or file
    configs:<path>    Read-only access to specific configuration folder
`, Version, Commit, BuildDate)
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "token":
			handleTokenCommands(os.Args[2:])
			return
		case "link", "invite", "url":
			handleLinkCommand(os.Args[2:])
			return
		case "install":
			handleInstallCommand(os.Args[2:])
			return
		case "uninstall":
			HandleUninstall()
			return
		}
	}

	installFlag := flag.Bool("install", false, "Install agent as system service (systemd/OpenRC)")
	uninstallFlag := flag.Bool("uninstall", false, "Uninstall agent service and remove binary")
	configPath := flag.String("config", "", "Path to agent.yaml")
	portStr := flag.String("port", "", "Override port (default: 8085)")
	rootsFlag := flag.String("roots", "", "Allowed working directories (comma-separated)")
	nameFlag := flag.String("name", "", "Server node name for connection link")
	hostFlag := flag.String("host", "", "Public IP / Host for connection link")
	keyFlag := flag.String("key", "", "API Token Key (cs_key_...)")
	secretFlag := flag.String("secret", "", "TOTP Base32 secret")
	tlsFlag := flag.Bool("tls", false, "Enable TLS")
	linkFlag := flag.Bool("link", false, "Generate and print 1-click connection link")
	rawFlag := flag.Bool("raw", false, "Output only raw connection URI (for scripts)")
	versionFlag := flag.Bool("version", false, "Show version")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("config-studio-agent v%s (commit: %s, built: %s)\n", Version, Commit, BuildDate)
		return
	}

	if *uninstallFlag {
		HandleUninstall()
		return
	}

	if *installFlag {
		port := parsePortString(*portStr, 8085)
		HandleInstall(InstallOptions{
			ConfigPath: *configPath,
			Port:       port,
			Roots:      *rootsFlag,
			Name:       *nameFlag,
			Host:       *hostFlag,
			KeyID:      *keyFlag,
			Secret:     *secretFlag,
			TLS:        *tlsFlag,
			Link:       *linkFlag,
			Raw:        *rawFlag,
		})
		return
	}

	cfgFile := *configPath
	if cfgFile == "" {
		cfgFile = "agent.yaml"
	}

	if *linkFlag {
		cfg, _, err := agent.LoadOrInitConfig(cfgFile)
		if err != nil {
			log.Fatalf("[Agent] Configuration error: %v", err)
		}
		var customRoots []string
		if *rootsFlag != "" {
			for _, r := range strings.Split(*rootsFlag, ",") {
				if cr := strings.TrimSpace(r); cr != "" {
					customRoots = append(customRoots, cr)
				}
			}
		}
		link := cfg.GenerateConnectionLink(*hostFlag, *nameFlag, customRoots)
		if *rawFlag {
			fmt.Println(link)
			return
		}
		fmt.Println("==================================================================")
		fmt.Printf("  Config Studio Remote Agent v%s — Connection Link\n", Version)
		fmt.Println("==================================================================")
		fmt.Println("  1-Click Import URI (copy & paste into Config Studio):")
		fmt.Println()
		fmt.Println("  " + link)
		fmt.Println()
		fmt.Println("  Included parameters:")
		fmt.Printf("    • API Token Key:  %s\n", cfg.Master.KeyID)
		fmt.Printf("    • TOTP Secret:    %s\n", cfg.Master.Secret)
		fmt.Println("==================================================================")
		return
	}

	cfg, _, err := agent.LoadOrInitConfig(cfgFile)
	if err != nil {
		log.Fatalf("[Agent] Configuration error: %v", err)
	}

	if *portStr != "" {
		if p := parsePortString(*portStr, 0); p > 0 {
			cfg.Port = p
		}
	}
	if *rootsFlag != "" {
		cfg.Sandbox.AllowedRoots = parseRootsString(*rootsFlag)
	}
	if *tlsFlag {
		cfg.TLS.Enabled = true
	}

	connectionLink := cfg.GenerateConnectionLink("", "", nil)

	fmt.Println("==================================================================")
	fmt.Printf("  Config Studio Remote Agent v%s (commit: %s)\n", Version, Commit)
	fmt.Println("==================================================================")
	if !cfg.Adopted {
		fmt.Println("  Status:         READY / UNADOPTED")
	} else {
		fmt.Println("  Status:         RUNNING")
	}
	fmt.Println("  Config:         " + *configPath)
	fmt.Printf("  Listening:      http://%s:%d (or https if TLS enabled)\n", cfg.Host, cfg.Port)
	fmt.Printf("  API Token Key:  %s\n", cfg.Master.KeyID)
	fmt.Printf("  TOTP Secret:    %s\n", cfg.Master.Secret)
	fmt.Printf("  Allowed Roots:  %s\n", strings.Join(cfg.Sandbox.AllowedRoots, ", "))
	fmt.Println()
	fmt.Println("  1-Click Connection Link (copy & paste into Config Studio):")
	fmt.Println("  " + connectionLink)
	fmt.Println("==================================================================")

	srv := agent.NewServer(cfg, Version, Commit, BuildDate)

	// Graceful shutdown handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("[Agent] Shutting down gracefully...")
		_ = srv.Shutdown(nil)
		os.Exit(0)
	}()

	if err := srv.Start(); err != nil && err.Error() != "http: Server closed" {
		log.Fatalf("[Agent] Server exited: %v", err)
	}
}

func handleTokenCommands(args []string) {
	if len(args) == 0 {
		fmt.Println("Usage: config-studio-agent token <list|create|delete> [options]")
		os.Exit(1)
	}

	action := args[0]
	cfgPath := "agent.yaml"

	// Find -config flag if passed
	for i := 1; i < len(args); i++ {
		if args[i] == "-config" && i+1 < len(args) {
			cfgPath = args[i+1]
			break
		}
	}

	cfg, _, err := agent.LoadOrInitConfig(cfgPath)
	if err != nil {
		log.Fatalf("Error loading config: %v", err)
	}

	switch action {
	case "list":
		fmt.Printf("Scoped Tokens in %s (%d total):\n", cfgPath, len(cfg.ScopedTokens))
		for _, t := range cfg.ScopedTokens {
			fmt.Printf("  - ID:     %s\n", t.ID)
			fmt.Printf("    Token:  %s\n", t.Token)
			fmt.Printf("    Desc:   %s\n", t.Description)
			fmt.Printf("    Topics: %s\n\n", strings.Join(t.Topics, ", "))
		}

	case "create":
		var id, desc, topicsStr string
		for i := 1; i < len(args); i++ {
			switch args[i] {
			case "-id":
				if i+1 < len(args) {
					id = args[i+1]
					i++
				}
			case "-desc":
				if i+1 < len(args) {
					desc = args[i+1]
					i++
				}
			case "-topics":
				if i+1 < len(args) {
					topicsStr = args[i+1]
					i++
				}
			}
		}

		if id == "" {
			fmt.Fprintln(os.Stderr, "Error: -id parameter required")
			os.Exit(1)
		}
		var topics []string
		if topicsStr != "" {
			for _, part := range strings.Split(topicsStr, ",") {
				clean := strings.TrimSpace(part)
				if clean != "" {
					topics = append(topics, clean)
				}
			}
		}
		if len(topics) == 0 {
			topics = []string{"metrics", "health"}
		}

		tok, err := cfg.AddScopedToken(id, desc, topics, nil)
		if err != nil {
			log.Fatalf("Failed to create token: %v", err)
		}

		fmt.Println("✓ Successfully created scoped telemetry token:")
		fmt.Printf("  ID:     %s\n", tok.ID)
		fmt.Printf("  Token:  %s\n", tok.Token)
		fmt.Printf("  Topics: %s\n", strings.Join(tok.Topics, ", "))

	case "delete":
		var id string
		for i := 1; i < len(args); i++ {
			if args[i] == "-id" && i+1 < len(args) {
				id = args[i+1]
				i++
			}
		}
		if id == "" {
			fmt.Fprintln(os.Stderr, "Error: -id parameter required")
			os.Exit(1)
		}
		if err := cfg.DeleteScopedToken(id); err != nil {
			log.Fatalf("Failed to delete token: %v", err)
		}
		fmt.Printf("✓ Successfully deleted token %q\n", id)

	default:
		fmt.Printf("Unknown token action: %q. Use list, create, or delete.\n", action)
		os.Exit(1)
	}
}

func handleLinkCommand(args []string) {
	fs := flag.NewFlagSet("link", flag.ExitOnError)
	configPath := fs.String("config", "agent.yaml", "Path to agent.yaml")
	overrideHost := fs.String("host", "", "Override host/IP address")
	overrideName := fs.String("name", "", "Override server node name")
	overrideRoots := fs.String("roots", "", "Override comma-separated allowed working roots")
	rawOnly := fs.Bool("raw", false, "Print only the raw cs-agent:// URL (for scripts/copying)")
	_ = fs.Parse(args)

	cfg, _, err := agent.LoadOrInitConfig(*configPath)
	if err != nil {
		log.Fatalf("[Agent] Configuration error: %v", err)
	}

	var customRoots []string
	if *overrideRoots != "" {
		for _, r := range strings.Split(*overrideRoots, ",") {
			r = strings.TrimSpace(r)
			if r != "" {
				customRoots = append(customRoots, r)
			}
		}
	}

	link := cfg.GenerateConnectionLink(*overrideHost, *overrideName, customRoots)

	if *rawOnly {
		fmt.Println(link)
		return
	}

	fmt.Println("==================================================================")
	fmt.Printf("  Config Studio Remote Agent v%s — Connection Link\n", Version)
	fmt.Println("==================================================================")
	fmt.Println("  1-Click Import URI (copy & paste into Config Studio):")
	fmt.Println()
	fmt.Println("  " + link)
	fmt.Println()
	fmt.Println("  Included parameters:")
	fmt.Printf("    • API Token Key:  %s\n", cfg.Master.KeyID)
	fmt.Printf("    • TOTP Secret:    %s\n", cfg.Master.Secret)
	rootsDisplay := strings.Join(cfg.Sandbox.AllowedRoots, ", ")
	if len(customRoots) > 0 {
		rootsDisplay = strings.Join(customRoots, ", ")
	}
	fmt.Printf("    • Allowed Roots:  %s\n", rootsDisplay)
	fmt.Println("==================================================================")
}

func handleInstallCommand(args []string) {
	fs := flag.NewFlagSet("install", flag.ExitOnError)
	configPath := fs.String("config", "", "Path to agent.yaml")
	portStr := fs.String("port", "", "Listening port (default: 8085)")
	roots := fs.String("roots", "", "Allowed working directories (comma-separated)")
	name := fs.String("name", "", "Server node name for link fragment")
	host := fs.String("host", "", "Override public IP/hostname in connection link")
	key := fs.String("key", "", "API Token Key (cs_key_...)")
	secret := fs.String("secret", "", "TOTP Base32 secret")
	tls := fs.Bool("tls", false, "Enable TLS")
	link := fs.Bool("link", false, "Generate connection link")
	raw := fs.Bool("raw", false, "Output only raw connection URI string")
	_ = fs.Parse(args)

	port := parsePortString(*portStr, 8085)
	HandleInstall(InstallOptions{
		ConfigPath: *configPath,
		Port:       port,
		Roots:      *roots,
		Name:       *name,
		Host:       *host,
		KeyID:      *key,
		Secret:     *secret,
		TLS:        *tls,
		Link:       *link,
		Raw:        *raw,
	})
}
