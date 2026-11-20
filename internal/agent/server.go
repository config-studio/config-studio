package agent

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

type Server struct {
	cfg       *Config
	auth      *Authenticator
	version   string
	commit    string
	buildDate string
	srv       *http.Server
}

func NewServer(cfg *Config, version string, optMetadata ...string) *Server {
	auth := NewAuthenticator(cfg.Master, cfg.ScopedTokens)
	s := &Server{
		cfg:     cfg,
		auth:    auth,
		version: version,
	}
	if len(optMetadata) > 0 {
		s.commit = optMetadata[0]
	}
	if len(optMetadata) > 1 {
		s.buildDate = optMetadata[1]
	}

	mux := http.NewServeMux()
	s.registerRoutes(mux)

	s.srv = &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Handler:      s.corsMiddleware(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
	}

	return s
}

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// 1. Health & Status
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("POST /api/adopt", s.handleAdopt)

	// 2. Metrics (Prometheus / JSON)
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	mux.HandleFunc("GET /api/metrics", s.handleMetrics)
	mux.HandleFunc("GET /api/sysinfo", s.handleMetrics)

	// 3. File System
	mux.HandleFunc("GET /api/fs/tree", s.handleFSTree)
	mux.HandleFunc("GET /api/fs/file", s.handleFSReadFile)
	mux.HandleFunc("POST /api/fs/file", s.handleFSWriteFile)
	mux.HandleFunc("DELETE /api/fs/file", s.handleFSDelete)
	mux.HandleFunc("DELETE /api/fs/delete", s.handleFSDelete)
	mux.HandleFunc("POST /api/fs/create", s.handleFSCreate)
	mux.HandleFunc("POST /api/fs/rename", s.handleFSRename)

	// 4. Command Execution
	mux.HandleFunc("POST /api/exec", s.handleExec)

	// 5. Token Management (Master RW only)
	mux.HandleFunc("GET /api/tokens", s.handleListTokens)
	mux.HandleFunc("POST /api/tokens", s.handleCreateToken)
	mux.HandleFunc("DELETE /api/tokens/{id}", s.handleDeleteToken)
}

func (s *Server) Start() error {
	log.Printf("[Agent] Config Studio Agent v%s starting on %s:%d (TLS: %v)", s.version, s.cfg.Host, s.cfg.Port, s.cfg.TLS.Enabled)

	if s.cfg.TLS.Enabled {
		if s.cfg.TLS.CertFile != "" && s.cfg.TLS.KeyFile != "" {
			return s.srv.ListenAndServeTLS(s.cfg.TLS.CertFile, s.cfg.TLS.KeyFile)
		}
		// Self-signed fallback
		cert, err := generateSelfSignedCert()
		if err != nil {
			return fmt.Errorf("failed to generate self-signed cert: %w", err)
		}
		s.srv.TLSConfig = &tls.Config{
			Certificates: []tls.Certificate{cert},
		}
		return s.srv.ListenAndServeTLS("", "")
	}

	return s.srv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.srv.Shutdown(ctx)
}

// corsMiddleware handles CORS and appends server timestamp for TOTP clock drift synchronization.
func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CS-Agent-Key, X-CS-Agent-OTP, X-ConfigStudio-Web, X-Nonce, X-Request-ID")
		w.Header().Set("Access-Control-Expose-Headers", "X-CS-Server-Time, X-CS-Access-Level")
		w.Header().Set("X-CS-Server-Time", fmt.Sprintf("%d", time.Now().Unix()))

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) *AuthContext {
	ctx, err := s.auth.AuthenticateRequest(r)
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "Authentication failed: "+err.Error())
		return nil
	}
	w.Header().Set("X-CS-Access-Level", ctx.Level.String())
	return ctx
}

// ============================================================================
// Handlers: Health & Status
// ============================================================================

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	hostname, _ := os.Hostname()
	resp := map[string]any{
		"status":    "ok",
		"version":   s.version,
		"timestamp": time.Now().Unix(),
		"uptime":    int64(time.Since(agentStartTime).Seconds()),
		"hostname":  hostname,
		"adopted":   s.cfg.Adopted,
	}
	if s.commit != "" {
		resp["commit"] = s.commit
	}
	if s.buildDate != "" {
		resp["buildDate"] = s.buildDate
	}
	jsonResponse(w, http.StatusOK, resp)
}



func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":      "online",
		"accessLevel": ctx.Level.String(),
		"isMaster":    ctx.IsMaster,
		"keyId":       ctx.KeyID,
		"version":     s.version,
		"timestamp":   time.Now().Unix(),
	})
}

// ============================================================================
// Handlers: Metrics & Sysinfo
// ============================================================================

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if !s.auth.CanAccessTopic(ctx, "metrics") && !s.auth.CanAccessTopic(ctx, "sysinfo") {
		jsonError(w, http.StatusForbidden, "Token not authorized for topic 'metrics'")
		return
	}

	metrics := CollectSystemMetrics(s.version)

	accept := r.Header.Get("Accept")
	if strings.Contains(accept, "text/plain") {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(metrics.ToPrometheusFormat()))
		return
	}

	jsonResponse(w, http.StatusOK, metrics)
}

// ============================================================================
// Handlers: Command Execution (Master RW only)
// ============================================================================

func (s *Server) handleExec(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Command execution requires Master RW elevation (TOTP)")
		return
	}

	var req struct {
		Cmd        string `json:"cmd"`
		Cwd        string `json:"cwd"`
		TimeoutSec int    `json:"timeoutSec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if strings.TrimSpace(req.Cmd) == "" {
		jsonError(w, http.StatusBadRequest, "cmd is required")
		return
	}

	timeout := 30 * time.Second
	if req.TimeoutSec > 0 && req.TimeoutSec <= 300 {
		timeout = time.Duration(req.TimeoutSec) * time.Second
	}

	execCtx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	var cmd *exec.Cmd
	if os.PathSeparator == '\\' {
		cmd = exec.CommandContext(execCtx, "cmd.exe", "/c", req.Cmd)
	} else {
		cmd = exec.CommandContext(execCtx, "sh", "-c", req.Cmd)
	}

	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}

	start := time.Now()
	out, err := cmd.CombinedOutput()
	duration := time.Since(start)

	exitCode := 0
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	} else if err != nil {
		exitCode = 1
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"output":     string(out),
		"exitCode":   exitCode,
		"durationMs": duration.Milliseconds(),
		"success":    exitCode == 0,
	})
}



// ============================================================================
// Helpers
// ============================================================================

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":   message,
		"status":  status,
		"success": false,
	})
}

func generateSelfSignedCert() (tls.Certificate, error) {
	// Fallback self-signed cert helper or dummy certificate
	// For production agent, users can supply cert_file and key_file,
	// or let agent generate one with ECDSA P-256.
	return tls.Certificate{}, fmt.Errorf("tls certificates not configured")
}
