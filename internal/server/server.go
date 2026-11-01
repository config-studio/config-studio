package server

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	appfs "config-studio/internal/fs"
	"config-studio/internal/guard"
	"config-studio/internal/plugin"
	"config-studio/internal/secrets"
	"config-studio/internal/ssh"
)

type Config struct {
	AuthUser string
	AuthPass string
	WebFS    fs.FS
}

type Server struct {
	cfg          Config
	config       *config.Manager
	fs           *appfs.Service
	plugins      *plugin.Manager
	pluginRunner *plugin.Runner
	audit        *audit.Logger
	secrets      *secrets.Manager
	ssh          *ssh.ClientManager
	handler      http.Handler
	sessionsMu   sync.RWMutex
	sessions     map[string]time.Time
}

func init() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_ = mime.AddExtensionType(".json", "application/json")
	_ = mime.AddExtensionType(".svg", "image/svg+xml")
	_ = mime.AddExtensionType(".js", "application/javascript")
	_ = mime.AddExtensionType(".mjs", "application/javascript")
}

func NewServer(cfg Config, cfgMgr *config.Manager, fsSvc *appfs.Service, pMgr *plugin.Manager, pRunner *plugin.Runner, auditLogger *audit.Logger, secMgr *secrets.Manager) *Server {
	s := &Server{
		cfg:          cfg,
		config:       cfgMgr,
		fs:           fsSvc,
		plugins:      pMgr,
		pluginRunner: pRunner,
		audit:        auditLogger,
		secrets:      secMgr,
		ssh:          ssh.NewClientManager(secMgr),
		sessions:     make(map[string]time.Time),
	}
	s.setupRoutes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func (s *Server) setupRoutes() {
	mux := http.NewServeMux()

	// Auth Endpoints
	mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)

	// Settings & Branding
	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("POST /api/settings", s.handleUpdateSettings)
	mux.HandleFunc("POST /api/settings/icon", s.handleUploadIcon)
	mux.HandleFunc("GET /api/branding/icon", s.handleGetIcon)

	// Workspace APIs (Multi-Root)
	mux.HandleFunc("GET /api/workspaces", s.handleListWorkspaces)
	mux.HandleFunc("POST /api/workspaces", s.handleAddWorkspace)
	mux.HandleFunc("PUT /api/workspaces/{id}", s.handleUpdateWorkspace)
	mux.HandleFunc("DELETE /api/workspaces/{id}", s.handleDeleteWorkspace)
	mux.HandleFunc("POST /api/workspaces/reload", s.handleReloadWorkspaces)

	// Filesystem APIs
	mux.HandleFunc("GET /api/fs/tree", s.handleGetTree)
	mux.HandleFunc("GET /api/fs/file", s.handleGetFile)
	mux.HandleFunc("GET /api/fs/info", s.handleGetFileInfo)
	mux.HandleFunc("POST /api/fs/file", s.handleSaveFile)
	mux.HandleFunc("POST /api/fs/create", s.handleCreateItem)
	mux.HandleFunc("DELETE /api/fs/delete", s.handleDeleteItem)
	mux.HandleFunc("POST /api/fs/rename", s.handleRenameItem)
	mux.HandleFunc("POST /api/fs/upload", s.handleUploadFile)
	mux.HandleFunc("GET /api/fs/download", s.handleDownloadFile)
	mux.HandleFunc("GET /api/fs/search", s.handleSearchFiles)

	// Structure Guard APIs
	mux.HandleFunc("POST /api/guard/validate", s.handleValidateGuard)

	// Plugin APIs
	mux.HandleFunc("GET /api/plugins", s.handleListPlugins)
	mux.HandleFunc("POST /api/plugins/toggle", s.handleTogglePlugin)
	mux.HandleFunc("POST /api/plugins/inspect/upload", s.handleInspectPluginUpload)
	mux.HandleFunc("POST /api/plugins/inspect/url", s.handleInspectPluginURL)
	mux.HandleFunc("POST /api/plugins/install/confirm", s.handleConfirmPluginInstall)
	mux.HandleFunc("POST /api/plugins/install/cancel", s.handleCancelPluginInstall)
	mux.HandleFunc("POST /api/plugins/install/upload", s.handleInstallPluginUpload)
	mux.HandleFunc("POST /api/plugins/install/url", s.handleInstallPluginURL)
	mux.HandleFunc("DELETE /api/plugins/{id}", s.handleDeletePlugin)
	mux.HandleFunc("GET /api/plugins/{id}/files/{path...}", s.handleServePluginFile)
	mux.HandleFunc("GET /api/plugins/{id}/settings", s.handleGetPluginSettings)
	mux.HandleFunc("POST /api/plugins/{id}/settings", s.handleSavePluginSettings)
	mux.HandleFunc("POST /api/plugins/exec", s.handleExecPluginCommand)
	mux.HandleFunc("POST /api/plugin-processes/start", s.handleStartPluginProcess)
	mux.HandleFunc("POST /api/plugin-processes/stop", s.handleStopPluginProcess)
	mux.HandleFunc("GET /api/plugin-processes", s.handleListPluginProcesses)
	mux.HandleFunc("GET /api/plugin-processes/{id}/logs", s.handleGetPluginProcessLogs)

	// Plugin Sources & Catalog APIs
	mux.HandleFunc("GET /api/plugins/sources", s.handleListSources)
	mux.HandleFunc("POST /api/plugins/sources", s.handleAddSource)
	mux.HandleFunc("PUT /api/plugins/sources/{id}", s.handleUpdateSource)
	mux.HandleFunc("DELETE /api/plugins/sources/{id}", s.handleDeleteSource)
	mux.HandleFunc("POST /api/plugins/sources/sync", s.handleSyncSources)
	mux.HandleFunc("GET /api/plugins/catalog", s.handleGetCatalog)

	// Profile Portability APIs
	mux.HandleFunc("GET /api/profile/export", s.handleExportProfile)
	mux.HandleFunc("POST /api/profile/preview", s.handlePreviewProfile)
	mux.HandleFunc("POST /api/profile/import", s.handleImportProfile)

	// Audit Log APIs
	mux.HandleFunc("GET /api/audit/logs", s.handleGetAuditLogs)
	mux.HandleFunc("GET /api/audit/export", s.handleExportAuditLogs)
	mux.HandleFunc("POST /api/audit/ingest", s.handleIngestAuditLogs)

	// Secrets Management APIs
	mux.HandleFunc("GET /api/secrets/status", s.handleGetSecretsStatus)
	mux.HandleFunc("GET /api/secrets", s.handleListSecrets)
	mux.HandleFunc("GET /api/secrets/shared", s.handleListSharedSecrets)
	mux.HandleFunc("POST /api/secrets/unlock", s.handleUnlockSecrets)
	mux.HandleFunc("POST /api/secrets/get", s.handleGetSecret)
	mux.HandleFunc("POST /api/secrets/save", s.handleSaveSecret)
	mux.HandleFunc("DELETE /api/secrets/{id}", s.handleDeleteSecret)

	// SSH & SFTP APIs
	mux.HandleFunc("GET /api/ssh/ws", s.handleSSHWebSocket)
	mux.HandleFunc("POST /api/ssh/test", s.handleSSHTest)
	mux.HandleFunc("POST /api/ssh/keys/generate", s.handleSSHGenerateKey)
	mux.HandleFunc("POST /api/ssh/sftp/list", s.handleSFTPList)
	mux.HandleFunc("POST /api/ssh/sftp/read", s.handleSFTPRead)
	mux.HandleFunc("POST /api/ssh/sftp/write", s.handleSFTPWrite)
	mux.HandleFunc("POST /api/ssh/sftp/stat", s.handleSFTPStat)
	mux.HandleFunc("POST /api/ssh/sftp/mkdir", s.handleSFTPMkdir)
	mux.HandleFunc("POST /api/ssh/sftp/delete", s.handleSFTPDelete)
	mux.HandleFunc("POST /api/ssh/sftp/rename", s.handleSFTPRename)

	// Remote Agent Proxy (bypasses browser mixed-content and CORS restrictions)
	mux.HandleFunc("/api/remote-proxy/{path...}", s.handleRemoteProxy)

	// Health check
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Wrap API with Auth check
	apiHandler := s.authMiddleware(mux)

	// SPA & Static Files
	if s.cfg.WebFS != nil {
		fileServer := http.FileServer(http.FS(s.cfg.WebFS))
		fullMux := http.NewServeMux()
		fullMux.Handle("/api/", apiHandler)
		fullMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			path := strings.TrimPrefix(r.URL.Path, "/")
			if path == "" {
				path = "index.html"
			}

			// Check if file exists in embedded FS
			if _, err := fs.Stat(s.cfg.WebFS, path); err == nil {
				if strings.HasSuffix(path, ".webmanifest") || strings.HasSuffix(path, "manifest.json") {
					w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
					w.Header().Set("Cache-Control", "no-cache")
				} else if path == "sw.js" {
					w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
					w.Header().Set("Service-Worker-Allowed", "/")
					w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				}
				fileServer.ServeHTTP(w, r)
				return
			}

			// Fallback to index.html for SPA
			indexFile, err := s.cfg.WebFS.Open("index.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer indexFile.Close()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.Copy(w, indexFile)
		})
		s.handler = s.gzipMiddleware(s.logMiddleware(fullMux))
	} else {
		s.handler = s.gzipMiddleware(s.logMiddleware(apiHandler))
	}
}

func (s *Server) logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s %s", r.Method, r.URL.Path, r.RemoteAddr)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) isRequestAuthenticated(r *http.Request) (bool, string) {
	// 1. Check Authentik / Authelia / ForwardAuth headers
	if forwardedUser := r.Header.Get("X-Forwarded-User"); forwardedUser != "" {
		return true, forwardedUser
	}
	if remoteUser := r.Header.Get("Remote-User"); remoteUser != "" {
		return true, remoteUser
	}
	if authReqUser := r.Header.Get("X-Auth-Request-User"); authReqUser != "" {
		return true, authReqUser
	}

	// 2. Check session cookie
	cookie, err := r.Cookie("cs_session")
	if err == nil && cookie.Value != "" {
		s.sessionsMu.RLock()
		exp, ok := s.sessions[cookie.Value]
		s.sessionsMu.RUnlock()
		if ok && time.Now().Before(exp) {
			return true, "admin"
		}
	}

	// 3. Check CLI basic auth flags if configured
	if s.cfg.AuthUser != "" {
		u, p, ok := r.BasicAuth()
		if ok && u == s.cfg.AuthUser && p == s.cfg.AuthPass {
			return true, u
		}
	}

	return false, ""
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Public paths that do not require auth
		if r.URL.Path == "/api/auth/status" ||
			r.URL.Path == "/api/auth/login" ||
			r.URL.Path == "/api/branding/icon" ||
			r.URL.Path == "/api/health" ||
			r.URL.Path == "/api/secrets/status" ||
			r.URL.Path == "/api/secrets/unlock" ||
			(strings.HasPrefix(r.URL.Path, "/api/plugins/") && strings.Contains(r.URL.Path, "/files/")) {
			next.ServeHTTP(w, r)
			return
		}

		settings := s.config.Get()

		// Distinguish internal Web UI requests from external REST API requests:
		isWebUI := r.Header.Get("X-ConfigStudio-Web") == "1" ||
			r.URL.Query().Get("web") == "1" ||
			(r.Referer() != "" && (strings.Contains(r.Referer(), r.Host) || strings.Contains(r.Referer(), "localhost") || strings.Contains(r.Referer(), "127.0.0.1")))
		if !isWebUI {
			if cookie, err := r.Cookie("cs_session"); err == nil && cookie.Value != "" {
				s.sessionsMu.RLock()
				exp, ok := s.sessions[cookie.Value]
				s.sessionsMu.RUnlock()
				if ok && time.Now().Before(exp) {
					isWebUI = true
				}
			}
		}

		if !isWebUI && (r.URL.Path == "/api/audit/export" || r.URL.Path == "/api/fs/download") {
			if r.Header.Get("Sec-Fetch-Dest") == "document" || r.Header.Get("Sec-Fetch-Mode") == "navigate" || strings.Contains(r.Header.Get("Accept"), "text/html") {
				isWebUI = true
			}
		}

		// If NOT from Web UI, this is an external REST API request
		if !isWebUI {
			if !settings.ApiEnabled {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]string{
					"error": "REST API is disabled in settings. External programmatic access is blocked.",
				})
				return
			}

			// If API is enabled and an API key is configured, validate it
			if settings.ApiKey != "" {
				clientKey := r.Header.Get("X-API-Key")
				if clientKey == "" {
					authHeader := r.Header.Get("Authorization")
					if strings.HasPrefix(authHeader, "Bearer ") {
						clientKey = strings.TrimPrefix(authHeader, "Bearer ")
					}
				}
				if clientKey != settings.ApiKey {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					_ = json.NewEncoder(w).Encode(map[string]string{
						"error": "Invalid or missing API Key. Provide X-API-Key or Authorization: Bearer <key>",
					})
					return
				}
			}
		}

		requiresAuth := settings.AuthEnabled || s.cfg.AuthUser != ""

		if !requiresAuth {
			next.ServeHTTP(w, r)
			return
		}

		authed, _ := s.isRequestAuthenticated(r)
		if !authed {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized", "authRequired": "true"})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	requiresAuth := settings.AuthEnabled || s.cfg.AuthUser != ""
	authed, user := s.isRequestAuthenticated(r)

	// If no auth is enabled, consider everyone authenticated
	if !requiresAuth {
		authed = true
		user = "guest"
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"authRequired":  requiresAuth,
		"authenticated": authed,
		"user":          user,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request")
		return
	}

	valid := false
	if s.cfg.AuthUser != "" {
		if req.Username == s.cfg.AuthUser && req.Password == s.cfg.AuthPass {
			valid = true
		}
	}
	if !valid && s.config.CheckAuth(req.Username, req.Password) {
		valid = true
	}

	if !valid {
		jsonError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}

	// Generate session token
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)

	s.sessionsMu.Lock()
	s.sessions[token] = time.Now().Add(7 * 24 * time.Hour) // 7 days session
	s.sessionsMu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     "cs_session",
		Value:    token,
		Path:     "/",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "ok",
		"user":   req.Username,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("cs_session"); err == nil {
		s.sessionsMu.Lock()
		delete(s.sessions, cookie.Value)
		s.sessionsMu.Unlock()
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "cs_session",
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
	})

	jsonResponse(w, http.StatusOK, map[string]string{"status": "logged_out"})
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	jsonResponse(w, status, map[string]string{"error": msg})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	jsonResponse(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req config.Settings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := s.config.Update(req); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to update settings: "+err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, s.config.Get())
}

func (s *Server) handleUploadIcon(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MB max
		jsonError(w, http.StatusBadRequest, "failed to parse multipart form")
		return
	}

	file, header, err := r.FormFile("icon")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing icon file: "+err.Error())
		return
	}
	defer file.Close()

	if err := s.config.SaveIcon(file, header.Filename); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save icon: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, s.config.Get())
}

func (s *Server) handleGetIcon(w http.ResponseWriter, r *http.Request) {
	iconPath := s.config.IconPath()
	if _, err := os.Stat(iconPath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	data, err := os.ReadFile(iconPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	mime := s.config.GetIconMime()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleGetTree(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	items, err := s.fs.ListDirRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	if items == nil {
		items = []appfs.FileItem{}
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"root":  rootID,
		"path":  relPath,
		"items": items,
	})
}

func (s *Server) handleGetFile(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	content, err := s.fs.ReadFileRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	_, rootObj, _ := s.fs.SafePathRoot(rootID, relPath)

	cleanRel := strings.TrimPrefix(relPath, "/")
	fullRel := cleanRel
	if rootObj.ID != "" && !strings.Contains(cleanRel, ":") {
		fullRel = rootObj.ID + ":" + cleanRel
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"root":        rootObj.ID,
		"path":        cleanRel,
		"fullRelPath": fullRel,
		"name":        filepath.Base(cleanRel),
		"readOnly":    rootObj.ReadOnly,
		"content":     string(content),
	})
}

func (s *Server) handleGetFileInfo(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	fullPath, rootObj, err := s.fs.SafePathRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	modTime, createTime := appfs.GetFileTimes(info)
	hash := sha256.Sum256(content)
	hashHex := hex.EncodeToString(hash[:])
	lineCount := strings.Count(string(content), "\n") + 1

	cleanRel := strings.TrimPrefix(relPath, "/")
	fullRel := cleanRel
	if rootObj.ID != "" && !strings.Contains(cleanRel, ":") {
		fullRel = rootObj.ID + ":" + cleanRel
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"root":        rootObj.ID,
		"path":        cleanRel,
		"fullRelPath": fullRel,
		"name":        filepath.Base(cleanRel),
		"readOnly":    rootObj.ReadOnly,
		"size":       len(content),
		"lineCount":  lineCount,
		"charCount":  len(string(content)),
		"sha256":     hashHex,
		"modifiedAt": modTime.Format(time.RFC3339),
		"createdAt":  createTime.Format(time.RFC3339),
	})
}

func (s *Server) getAuditUser(r *http.Request) string {
	authed, user := s.isRequestAuthenticated(r)
	if authed && user != "" {
		return user
	}
	return "admin"
}

func (s *Server) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root    string `json:"root"`
		Path    string `json:"path"`
		Content string `json:"content"`
		Backup  bool   `json:"backup"`
		Force   bool   `json:"force"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	settings := s.config.Get()
	if !req.Force && settings.StructureGuardEnabled {
		if guard.IsSensitive(req.Path, settings.CriticalPatterns, nil) {
			valResult := guard.Validate(req.Path, []byte(req.Content))
			if !valResult.Valid {
				var firstCritical guard.GuardIssue
				for _, iss := range valResult.Issues {
					if iss.Severity == guard.SeverityCritical {
						firstCritical = iss
						break
					}
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error":  "Syntax validation failed for sensitive file",
					"guard":  firstCritical,
					"issues": valResult.Issues,
				})
				return
			}
		}
	}

	if err := s.fs.WriteFileRoot(req.Root, req.Path, []byte(req.Content), req.Backup); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if s.audit != nil {
		hash := sha256.Sum256([]byte(req.Content))
		action := audit.ActionFileSave
		severity := audit.SeverityInfo
		details := map[string]any{
			"backup": req.Backup,
			"bytes":  len(req.Content),
			"sha256": hex.EncodeToString(hash[:]),
			"force":  req.Force,
		}
		if req.Force {
			action = audit.ActionFileForceSave
			severity = audit.SeverityWarn
			valResult := guard.Validate(req.Path, []byte(req.Content))
			if !valResult.Valid && len(valResult.Issues) > 0 {
				details["ignored_error"] = valResult.Issues[0].Message
				details["ignored_line"] = valResult.Issues[0].Line
			}
		}

		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   action,
			Severity: severity,
			Target:   req.Path,
			Details:  details,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "saved", "path": req.Path})
}

func (s *Server) handleValidateGuard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	settings := s.config.Get()
	isSens := guard.IsSensitive(req.Path, settings.CriticalPatterns, nil)
	valResult := guard.Validate(req.Path, []byte(req.Content))
	valResult.IsGuarded = isSens

	jsonResponse(w, http.StatusOK, valResult)
}

func (s *Server) handleCreateItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root  string `json:"root"`
		Path  string `json:"path"`
		IsDir bool   `json:"isDir"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	if err := s.fs.CreateItemRoot(req.Root, req.Path, req.IsDir); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "file.create",
			Severity: audit.SeverityInfo,
			Target:   req.Path,
			Details:  map[string]any{"root": req.Root, "isDir": req.IsDir},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "created", "path": req.Path})
}

func (s *Server) handleDeleteItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root string `json:"root"`
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	if err := s.fs.DeleteItemRoot(req.Root, req.Path); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionFileDelete,
			Severity: audit.SeverityWarn,
			Target:   req.Path,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted", "path": req.Path})
}

func (s *Server) handleRenameItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root    string `json:"root"`
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.OldPath == "" || req.NewPath == "" {
		jsonError(w, http.StatusBadRequest, "oldPath and newPath are required")
		return
	}

	if err := s.fs.RenameItemRoot(req.Root, req.OldPath, req.NewPath); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionFileRename,
			Severity: audit.SeverityInfo,
			Target:   req.OldPath,
			Details:  map[string]any{"root": req.Root, "newPath": req.NewPath},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status":  "renamed",
		"oldPath": req.OldPath,
		"newPath": req.NewPath,
	})
}

func (s *Server) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(50 << 20); err != nil { // 50 MB max
		jsonError(w, http.StatusBadRequest, "file too large or invalid multipart")
		return
	}

	rootID := r.FormValue("root")
	dirRel := r.FormValue("path")
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing file form parameter: "+err.Error())
		return
	}
	defer file.Close()

	savedPath, err := s.fs.UploadFileRoot(rootID, dirRel, header.Filename, file)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status": "uploaded",
		"path":   savedPath,
	})
}

func (s *Server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	fullPath, _, err := s.fs.SafePathRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	filename := filepath.Base(fullPath)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, fullPath)
}

func (s *Server) handleSearchFiles(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	q := r.URL.Query().Get("q")
	items, err := s.fs.SearchFilesRoot(rootID, q)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"items": items,
	})
}

func (s *Server) handleGetAuditLogs(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		jsonResponse(w, http.StatusOK, audit.QueryResult{Events: []audit.Event{}, Total: 0})
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 500 {
			limit = l
		}
	}

	offset := 0
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	action := r.URL.Query().Get("action")
	category := r.URL.Query().Get("category")
	source := r.URL.Query().Get("source")
	severity := r.URL.Query().Get("severity")
	search := r.URL.Query().Get("search")

	res := s.audit.Query(audit.QueryFilter{
		Limit:    limit,
		Offset:   offset,
		Action:   action,
		Category: category,
		Source:   source,
		Severity: severity,
		Search:   search,
	})

	jsonResponse(w, http.StatusOK, res)
}

func (s *Server) handleIngestAuditLogs(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		jsonResponse(w, http.StatusOK, map[string]any{"ingested": 0})
		return
	}

	var req struct {
		Events []audit.Event `json:"events"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	ingested := 0
	user := s.getAuditUser(r)
	ip := r.RemoteAddr

	for _, evt := range req.Events {
		if evt.Action == "" {
			continue
		}
		if evt.User == "" {
			evt.User = user
		}
		if evt.IP == "" {
			evt.IP = ip
		}
		if evt.Source == "" {
			evt.Source = "frontend"
		}
		if evt.SourceID == "" {
			evt.SourceID = "core"
		}
		if err := s.audit.Log(evt); err == nil {
			ingested++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"ingested": ingested,
	})
}

func (s *Server) handleExportAuditLogs(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", "attachment; filename=\"config-studio-audit.jsonl\"")
	_ = s.audit.Export(w)
}

// handleRemoteProxy forwards requests from the browser to remote agents.
// This completely avoids Mixed Content errors (HTTPS -> HTTP) and CORS restrictions.
func (s *Server) handleRemoteProxy(w http.ResponseWriter, r *http.Request) {
	targetBase := r.Header.Get("X-Remote-Target")
	if targetBase == "" {
		targetBase = r.URL.Query().Get("target")
	}
	if targetBase == "" {
		jsonError(w, http.StatusBadRequest, "X-Remote-Target header is required")
		return
	}

	targetBase = strings.TrimSpace(targetBase)
	if !strings.HasPrefix(targetBase, "http://") && !strings.HasPrefix(targetBase, "https://") {
		targetBase = "http://" + targetBase
	}
	targetBase = strings.TrimRight(targetBase, "/")
	path := r.PathValue("path")
	cleanPath := strings.TrimLeft(path, "/")

	// If this is an /api/fs/ request with a root parameter, resolve root path from workspaces.yaml
	q := r.URL.Query()
	q.Del("target")

	var wsPath string
	var rootID string
	if strings.HasPrefix(cleanPath, "api/fs/") && s.fs != nil && s.fs.Workspaces != nil {
		rootID = q.Get("root")
		if rootID != "" {
			if ws, ok := s.fs.Workspaces.Get(rootID); ok && ws.Path != "" {
				wsPath = filepath.ToSlash(strings.TrimRight(ws.Path, "/"))
				if wsPath == "" {
					wsPath = "/"
				}
				reqPath := strings.TrimSpace(q.Get("path"))
				if reqPath == "" || reqPath == "." {
					q.Set("path", wsPath)
				} else if strings.HasPrefix(reqPath, "/") {
					q.Set("path", reqPath)
				} else {
					if wsPath == "/" {
						q.Set("path", "/"+strings.TrimLeft(reqPath, "/"))
					} else {
						q.Set("path", wsPath+"/"+strings.TrimLeft(reqPath, "/"))
					}
				}
			}
		}
	}

	targetURL := fmt.Sprintf("%s/%s", targetBase, cleanPath)
	if len(q) > 0 {
		targetURL += "?" + q.Encode()
	}

	var reqBody io.Reader = r.Body
	if strings.HasPrefix(cleanPath, "api/fs/") && r.Body != nil && (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete) {
		bodyBytes, err := io.ReadAll(r.Body)
		if err == nil && len(bodyBytes) > 0 && s.fs != nil && s.fs.Workspaces != nil {
			var bodyMap map[string]any
			if err := json.Unmarshal(bodyBytes, &bodyMap); err == nil {
				rID, _ := bodyMap["root"].(string)
				if rID == "" {
					rID = rootID
				}
				if rID != "" {
					if ws, ok := s.fs.Workspaces.Get(rID); ok && ws.Path != "" {
						wPath := filepath.ToSlash(strings.TrimRight(ws.Path, "/"))
						if wPath == "" {
							wPath = "/"
						}
						resolvePath := func(p string) string {
							p = strings.TrimSpace(p)
							if p == "" || p == "." {
								return wPath
							}
							if strings.HasPrefix(p, "/") {
								return p
							}
							if wPath == "/" {
								return "/" + strings.TrimLeft(p, "/")
							}
							return wPath + "/" + strings.TrimLeft(p, "/")
						}
						if p, ok := bodyMap["path"].(string); ok {
							bodyMap["path"] = resolvePath(p)
						}
						if op, ok := bodyMap["oldPath"].(string); ok {
							bodyMap["oldPath"] = resolvePath(op)
						}
						if np, ok := bodyMap["newPath"].(string); ok {
							bodyMap["newPath"] = resolvePath(np)
						}
						if newJSON, err := json.Marshal(bodyMap); err == nil {
							bodyBytes = newJSON
						}
					}
				}
			}
			reqBody = bytes.NewReader(bodyBytes)
		}
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, reqBody)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to create proxy request: "+err.Error())
		return
	}

	// Forward headers (except Host and X-Remote-Target)
	for k, vv := range r.Header {
		if strings.EqualFold(k, "X-Remote-Target") || strings.EqualFold(k, "Host") {
			continue
		}
		for _, v := range vv {
			proxyReq.Header.Add(k, v)
		}
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	resp, err := client.Do(proxyReq)
	if err != nil {
		jsonError(w, http.StatusBadGateway, "failed to reach remote agent: "+err.Error())
		return
	}
	defer resp.Body.Close()

	// For filesystem tree listings scoped to a workspace, relativize paths so client sees "" at root
	if cleanPath == "api/fs/tree" && resp.StatusCode == http.StatusOK && wsPath != "" {
		respBytes, err := io.ReadAll(resp.Body)
		if err == nil {
			var data map[string]any
			if err := json.Unmarshal(respBytes, &data); err == nil {
				absDirPath, _ := data["path"].(string)
				absDirPath = filepath.ToSlash(strings.TrimRight(strings.TrimSpace(absDirPath), "/"))
				relDirPath := ""
				if absDirPath != wsPath && strings.HasPrefix(absDirPath, wsPath+"/") {
					relDirPath = strings.TrimPrefix(absDirPath, wsPath+"/")
				}
				data["path"] = relDirPath
				data["root"] = rootID

				relativizeItems := func(key string) {
					if rawList, ok := data[key].([]any); ok {
						for _, itemRaw := range rawList {
							if itemMap, ok := itemRaw.(map[string]any); ok {
								itemAbs, _ := itemMap["path"].(string)
								itemAbs = filepath.ToSlash(itemAbs)
								itemRel := itemAbs
								if itemAbs == wsPath {
									itemRel = ""
								} else if strings.HasPrefix(itemAbs, wsPath+"/") {
									itemRel = strings.TrimPrefix(itemAbs, wsPath+"/")
								}
								itemMap["path"] = itemRel
								itemMap["root"] = rootID
								itemMap["fullRelPath"] = rootID + ":" + itemRel
								if _, ok := itemMap["extension"]; !ok {
									name, _ := itemMap["name"].(string)
									isDir, _ := itemMap["isDir"].(bool)
									if !isDir && name != "" {
										itemMap["extension"] = filepath.Ext(name)
									} else {
										itemMap["extension"] = ""
									}
								}
							}
						}
					}
				}
				relativizeItems("items")
				relativizeItems("nodes")

				newRespBytes, err := json.Marshal(data)
				if err == nil {
					for k, vv := range resp.Header {
						if strings.EqualFold(k, "Content-Length") {
							continue
						}
						for _, v := range vv {
							w.Header().Add(k, v)
						}
					}
					w.Header().Set("Content-Length", strconv.Itoa(len(newRespBytes)))
					w.WriteHeader(resp.StatusCode)
					_, _ = w.Write(newRespBytes)
					return
				}
			}
		}
	}

	// For file read responses, ensure path is relative to workspace root
	if cleanPath == "api/fs/file" && r.Method == http.MethodGet && resp.StatusCode == http.StatusOK && wsPath != "" {
		respBytes, err := io.ReadAll(resp.Body)
		if err == nil {
			var data map[string]any
			if err := json.Unmarshal(respBytes, &data); err == nil {
				filePath, _ := data["path"].(string)
				filePath = filepath.ToSlash(filePath)
				relFilePath := filePath
				if strings.HasPrefix(filePath, wsPath+"/") {
					relFilePath = strings.TrimPrefix(filePath, wsPath+"/")
				}
				data["path"] = relFilePath
				data["root"] = rootID
				data["fullRelPath"] = rootID + ":" + relFilePath
				if _, ok := data["name"]; !ok {
					data["name"] = filepath.Base(filePath)
				}
				newRespBytes, err := json.Marshal(data)
				if err == nil {
					for k, vv := range resp.Header {
						if strings.EqualFold(k, "Content-Length") {
							continue
						}
						for _, v := range vv {
							w.Header().Add(k, v)
						}
					}
					w.Header().Set("Content-Length", strconv.Itoa(len(newRespBytes)))
					w.WriteHeader(resp.StatusCode)
					_, _ = w.Write(newRespBytes)
					return
				}
			}
		}
	}

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

