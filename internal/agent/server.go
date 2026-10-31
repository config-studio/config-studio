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
	"path/filepath"
	"strings"
	"time"
)

type Server struct {
	cfg     *Config
	auth    *Authenticator
	version string
	srv     *http.Server
}

func NewServer(cfg *Config, version string) *Server {
	auth := NewAuthenticator(cfg.Master, cfg.ScopedTokens)
	s := &Server{
		cfg:     cfg,
		auth:    auth,
		version: version,
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
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CS-Agent-Key, X-CS-Agent-OTP, X-ConfigStudio-Web")
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
	jsonResponse(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"version":   s.version,
		"timestamp": time.Now().Unix(),
		"uptime":    int64(time.Since(agentStartTime).Seconds()),
	})
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
// Handlers: File System
// ============================================================================

type FSNode struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	IsDir     bool      `json:"isDir"`
	Size      int64     `json:"size"`
	ModTime   time.Time `json:"modTime"`
	Extension string    `json:"extension,omitempty"`
}

func (s *Server) handleFSTree(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		if len(s.cfg.Sandbox.AllowedRoots) > 0 {
			dirPath = s.cfg.Sandbox.AllowedRoots[0]
		} else {
			dirPath = "/"
		}
	}

	if !s.auth.CanAccessPath(ctx, dirPath, false) {
		jsonError(w, http.StatusForbidden, "Path access denied by agent sandbox")
		return
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to read directory: "+err.Error())
		return
	}

	var nodes []FSNode
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fullPath := filepath.Join(dirPath, entry.Name())
		ext := ""
		if !entry.IsDir() {
			ext = filepath.Ext(entry.Name())
		}
		nodes = append(nodes, FSNode{
			Name:      entry.Name(),
			Path:      filepath.ToSlash(fullPath),
			IsDir:     entry.IsDir(),
			Size:      info.Size(),
			ModTime:   info.ModTime(),
			Extension: ext,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"path":  filepath.ToSlash(dirPath),
		"nodes": nodes,
		"items": nodes,
	})
}

func (s *Server) handleFSReadFile(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, http.StatusBadRequest, "path query parameter is required")
		return
	}

	if !s.auth.CanAccessPath(ctx, filePath, false) {
		jsonError(w, http.StatusForbidden, "File read access denied")
		return
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Cannot read file: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"name":    filepath.Base(filePath),
		"path":    filepath.ToSlash(filePath),
		"content": string(data),
		"size":    len(data),
	})
}

func (s *Server) handleFSWriteFile(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Write operations require Master RW elevation (TOTP)")
		return
	}

	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	if !s.auth.CanAccessPath(ctx, req.Path, true) {
		jsonError(w, http.StatusForbidden, "Path write access denied by agent sandbox")
		return
	}

	// Create backup if file already exists
	if _, err := os.Stat(req.Path); err == nil {
		_ = os.WriteFile(req.Path+".csbak", []byte(req.Content), 0644)
	}

	dir := filepath.Dir(req.Path)
	_ = os.MkdirAll(dir, 0755)

	if err := os.WriteFile(req.Path, []byte(req.Content), 0644); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to write file: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "saved",
		"path":   filepath.ToSlash(req.Path),
		"size":   len(req.Content),
	})
}

func (s *Server) handleFSDelete(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Delete operations require Master RW elevation (TOTP)")
		return
	}

	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		var req struct {
			Path string `json:"path"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		targetPath = req.Path
	}

	if targetPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	if !s.auth.CanAccessPath(ctx, targetPath, true) {
		jsonError(w, http.StatusForbidden, "Path deletion denied by sandbox")
		return
	}

	if err := os.RemoveAll(targetPath); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to delete: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "deleted",
		"path":   filepath.ToSlash(targetPath),
	})
}

func (s *Server) handleFSRename(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Rename requires Master RW elevation (TOTP)")
		return
	}

	var req struct {
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.OldPath == "" || req.NewPath == "" {
		jsonError(w, http.StatusBadRequest, "oldPath and newPath are required")
		return
	}

	if !s.auth.CanAccessPath(ctx, req.OldPath, true) || !s.auth.CanAccessPath(ctx, req.NewPath, true) {
		jsonError(w, http.StatusForbidden, "Path rename denied by sandbox")
		return
	}

	if err := os.Rename(req.OldPath, req.NewPath); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to rename: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "renamed",
		"oldPath": filepath.ToSlash(req.OldPath),
		"newPath": filepath.ToSlash(req.NewPath),
	})
}

func (s *Server) handleFSCreate(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Creation requires Master RW elevation (TOTP)")
		return
	}

	var req struct {
		Path  string `json:"path"`
		IsDir bool   `json:"isDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if !s.auth.CanAccessPath(ctx, req.Path, true) {
		jsonError(w, http.StatusForbidden, "Path creation denied by sandbox")
		return
	}

	if req.IsDir {
		if err := os.MkdirAll(req.Path, 0755); err != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to create directory: "+err.Error())
			return
		}
	} else {
		dir := filepath.Dir(req.Path)
		_ = os.MkdirAll(dir, 0755)
		if err := os.WriteFile(req.Path, []byte(""), 0644); err != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to create file: "+err.Error())
			return
		}
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "created",
		"path":   filepath.ToSlash(req.Path),
	})
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
// Handlers: Token Management (Master RW only)
// ============================================================================

func (s *Server) handleListTokens(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Token inspection requires Master RW elevation (TOTP)")
		return
	}

	tokens := s.auth.GetScopedTokens()
	jsonResponse(w, http.StatusOK, map[string]any{
		"tokens": tokens,
	})
}

func (s *Server) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Token creation requires Master RW elevation (TOTP)")
		return
	}

	var req struct {
		ID           string   `json:"id"`
		Description  string   `json:"description"`
		Topics       []string `json:"topics"`
		AllowedRoots []string `json:"allowedRoots"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	tok, err := s.cfg.AddScopedToken(req.ID, req.Description, req.Topics, req.AllowedRoots)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.auth.UpdateTokens(s.cfg.ScopedTokens)

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "created",
		"token":  tok,
	})
}

func (s *Server) handleDeleteToken(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Token deletion requires Master RW elevation (TOTP)")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		jsonError(w, http.StatusBadRequest, "token id is required")
		return
	}

	if err := s.cfg.DeleteScopedToken(id); err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}

	s.auth.UpdateTokens(s.cfg.ScopedTokens)

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "deleted",
		"tokenId": id,
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
