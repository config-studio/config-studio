package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	appfs "config-studio/internal/fs"
	"config-studio/internal/plugin"
	"config-studio/internal/secrets"
	"config-studio/internal/server"
	"config-studio/web"
)

func main() {
	var (
		port          = flag.Int("port", 8080, "Port to listen on (default 8080)")
		workdir       = flag.String("workdir", "", "Working directory containing config files (default ./data/configs)")
		dataDir       = flag.String("data", "", "Directory for settings and custom branding (default ./data)")
		authUser      = flag.String("auth-user", "", "Basic Auth username (or set CONFIG_AUTH_USER)")
		authPass      = flag.String("auth-pass", "", "Basic Auth password (or set CONFIG_AUTH_PASS)")
		installFlag   = flag.Bool("install", false, "Install Config Studio as a system service (auto-detects systemd or OpenRC)")
		uninstallFlag = flag.Bool("uninstall", false, "Uninstall Config Studio service and binary")
		tlsFlag       = flag.Bool("tls", false, "Enable HTTPS with auto-generated self-signed certificate (or set CONFIG_TLS=true)")
		tlsCert       = flag.String("tls-cert", "", "Path to custom TLS certificate file (optional)")
		tlsKey        = flag.String("tls-key", "", "Path to custom TLS private key file (optional)")
		versionFlag   = flag.Bool("version", false, "Show Config Studio version")
	)
	flag.Parse()

	if *versionFlag {
		fmt.Println("Config Studio v2.0.0")
		return
	}

	// Check if install or uninstall was requested
	if *installFlag {
		handleInstall()
		return
	}
	if *uninstallFlag {
		handleUninstall()
		return
	}

	// Load .env if present
	loadEnvFile("config.env")
	loadEnvFile("/opt/config-studio/config.env")

	// Environment variable fallbacks
	if *workdir == "" {
		if env := os.Getenv("CONFIG_WORKDIR"); env != "" {
			*workdir = env
		} else {
			*workdir = "./data/configs"
		}
	}
	if *dataDir == "" {
		if env := os.Getenv("CONFIG_DATADIR"); env != "" {
			*dataDir = env
		} else {
			*dataDir = "./data"
		}
	}
	if *authUser == "" {
		*authUser = os.Getenv("CONFIG_AUTH_USER")
	}
	if *authPass == "" {
		*authPass = os.Getenv("CONFIG_AUTH_PASS")
	}

	// Initialize config manager
	cfgMgr, err := config.NewManager(*dataDir)
	if err != nil {
		log.Fatalf("Failed to initialize configuration manager: %v", err)
	}

	// Initialize workspace manager and filesystem service
	workspaceMgr, err := appfs.NewWorkspaceManager(*dataDir, *workdir)
	if err != nil {
		log.Fatalf("Failed to initialize workspace manager: %v", err)
	}

	fsSvc, err := appfs.NewServiceWithManager(workspaceMgr)
	if err != nil {
		log.Fatalf("Failed to initialize filesystem service: %v", err)
	}

	// Initialize plugin runner and manager
	pluginRunner := plugin.NewRunner()
	pluginMgr, err := plugin.NewManager(*dataDir, pluginRunner)
	if err != nil {
		log.Fatalf("Failed to initialize plugin manager: %v", err)
	}

	// Initialize core audit logger
	auditLogger, err := audit.NewLogger(*dataDir)
	if err != nil {
		log.Printf("Warning: failed to initialize audit logger: %v", err)
	} else {
		defer auditLogger.Close()
	}

	// Initialize secrets manager
	secretsMgr, err := secrets.NewManager(*dataDir)
	if err != nil {
		log.Fatalf("Failed to initialize secrets manager: %v", err)
	}

	// Prepare embedded Web FS
	subFS, err := web.GetFS()
	if err != nil {
		log.Printf("Warning: failed to load embedded frontend: %v", err)
	}

	srvConfig := server.Config{
		AuthUser: *authUser,
		AuthPass: *authPass,
		WebFS:    subFS,
	}

	appServer := server.NewServer(srvConfig, cfgMgr, fsSvc, pluginMgr, pluginRunner, auditLogger, secretsMgr)

	useTLS := *tlsFlag || os.Getenv("CONFIG_TLS") == "true" || os.Getenv("CONFIG_TLS") == "1"
	certFile := *tlsCert
	keyFile := *tlsKey

	if useTLS && (certFile == "" || keyFile == "") {
		var err error
		certFile, keyFile, err = server.EnsureSelfSignedCert(filepath.Join(*dataDir, "certs"))
		if err != nil {
			log.Fatalf("Failed to initialize self-signed TLS certs: %v", err)
		}
	}

	addr := fmt.Sprintf("0.0.0.0:%d", *port)
	httpServer := &http.Server{
		Addr:         addr,
		Handler:      appServer,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
	}

	// Graceful shutdown channel
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("==================================================")
		protocol := "http"
		if useTLS {
			protocol = "https"
		}
		log.Printf(" Config Studio v2.0.0-beta is running at %s://%s", protocol, addr)
		log.Printf(" Working directory: %s", *workdir)
		log.Printf(" Data directory:    %s", *dataDir)
		if useTLS {
			log.Printf(" TLS / HTTPS:       enabled (cert: %s)", certFile)
		} else {
			log.Printf(" TLS / HTTPS:       disabled (run with --tls for HTTPS/PWA)")
		}
		if *authUser != "" {
			log.Printf(" Basic Auth:        enabled (user: %s)", *authUser)
		} else {
			log.Printf(" Basic Auth:        disabled")
		}
		log.Printf("==================================================")
		if err := func() error {
			if useTLS {
				return httpServer.ListenAndServeTLS(certFile, keyFile)
			}
			return httpServer.ListenAndServe()
		}(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server listen error: %v", err)
		}
	}()

	<-stop
	log.Println("Shutting down Config Studio...")

	// Terminate any running plugin processes
	pluginRunner.Shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}
	log.Println("Config Studio stopped gracefully.")
}

func loadEnvFile(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		parts := strings.SplitN(trimmed, "=", 2)
		if len(parts) == 2 {
			k := strings.TrimSpace(parts[0])
			v := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
			if os.Getenv(k) == "" {
				os.Setenv(k, v)
			}
		}
	}
}
