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

const version = "2.3.0"

func printUsage() {
	fmt.Printf(`Config Studio Remote Agent v%s
Lightweight, Zero-Trust Headless Daemon for Cloud & VPS Fleet Management.

USAGE:
    config-studio-agent [flags]
    config-studio-agent token <action> [options]

FLAGS:
    -config <path>    Path to agent.yaml (default: ./agent.yaml)
    -port <int>       Override listening port (default: 8085)
    -tls              Enable HTTPS / TLS
    -version          Print agent version and exit

TOKEN COMMANDS:
    token list
    token create -id <name> -desc <description> -topics <comma,separated,topics>
    token delete -id <name>

TOPICS AVAILABLE:
    metrics           System metrics (CPU, RAM, Disks, Load, Prometheus format)
    health            Ping and uptime status
    logs:<path>       Read-only access to log directory or file
    configs:<path>    Read-only access to specific configuration folder
`, version)
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "token" {
		handleTokenCommands(os.Args[2:])
		return
	}

	configPath := flag.String("config", "agent.yaml", "Path to agent.yaml")
	portFlag := flag.Int("port", 0, "Override port")
	tlsFlag := flag.Bool("tls", false, "Enable TLS")
	versionFlag := flag.Bool("version", false, "Show version")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("config-studio-agent v%s\n", version)
		return
	}

	cfg, isNew, err := agent.LoadOrInitConfig(*configPath)
	if err != nil {
		log.Fatalf("[Agent] Configuration error: %v", err)
	}

	if *portFlag > 0 {
		cfg.Port = *portFlag
	}
	if *tlsFlag {
		cfg.TLS.Enabled = true
	}

	if isNew || !cfg.Adopted {
		fmt.Println("==================================================================")
		fmt.Printf("  Config Studio Remote Agent v%s\n", version)
		fmt.Println("==================================================================")
		if !cfg.Adopted {
			fmt.Println("  Status:         UNADOPTED (Ready for 1-Click Adopt from Config Studio)")
		} else {
			fmt.Println("  Status:         ADOPTED")
		}
		fmt.Println("  Config:         " + *configPath)
		fmt.Println()
		fmt.Printf("  Master Key ID:  %s\n", cfg.Master.KeyID)
		fmt.Printf("  Master Secret:  %s\n", cfg.Master.Secret)
		fmt.Println()
		fmt.Println("  Use these credentials or click 'Adopt' in Config Studio:")
		fmt.Printf("  URL:            http://%s:%d (or https if TLS enabled)\n", cfg.Host, cfg.Port)
		fmt.Println("==================================================================")
	}

	srv := agent.NewServer(cfg, version)

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
