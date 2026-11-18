package server

import (
	"encoding/json"
	"net/http"
)

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
	mux.HandleFunc("GET /api/fs/upload", s.handleUploadFile)
	mux.HandleFunc("POST /api/fs/upload", s.handleUploadFile)
	mux.HandleFunc("GET /api/fs/download", s.handleDownloadFile)
	mux.HandleFunc("GET /api/fs/search", s.handleSearchFiles)
	mux.HandleFunc("POST /api/fs/batch-read", s.handleFSBatchRead)

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
	mux.HandleFunc("POST /api/ssh/exec", s.handleSSHExec)
	mux.HandleFunc("POST /api/ssh/keys/generate", s.handleSSHGenerateKey)
	mux.HandleFunc("POST /api/ssh/sftp/list", s.handleSFTPList)
	mux.HandleFunc("POST /api/ssh/sftp/read", s.handleSFTPRead)
	mux.HandleFunc("POST /api/ssh/sftp/write", s.handleSFTPWrite)
	mux.HandleFunc("POST /api/ssh/sftp/stat", s.handleSFTPStat)
	mux.HandleFunc("POST /api/ssh/sftp/mkdir", s.handleSFTPMkdir)
	mux.HandleFunc("POST /api/ssh/sftp/delete", s.handleSFTPDelete)
	mux.HandleFunc("POST /api/ssh/sftp/rename", s.handleSFTPRename)
	mux.HandleFunc("POST /api/ssh/sftp/batch-read", s.handleSFTPBatchRead)
	mux.HandleFunc("POST /api/sftp/batch-read", s.handleSFTPBatchRead)

	// Log Streaming Service (v2.3.5)
	mux.HandleFunc("GET /api/logs/stream", s.handleLogsStream)
	mux.HandleFunc("POST /api/logs/stream", s.handleLogsStream)

	// Goja Code Mode Sandbox API (v2.3.7)
	mux.HandleFunc("POST /api/sandbox/eval", s.handleSandboxEval)

	// Fleet Inventory APIs
	mux.HandleFunc("GET /api/servers", s.handleListServers)
	mux.HandleFunc("POST /api/servers", s.handleAddOrUpdateServer)
	mux.HandleFunc("DELETE /api/servers/{id}", s.handleDeleteServer)
	mux.HandleFunc("GET /api/servers/raw", s.handleGetRawServersYAML)
	mux.HandleFunc("PUT /api/servers/raw", s.handleSetRawServersYAML)
	mux.HandleFunc("POST /api/servers/ping/{id}", s.handlePingServer)
	mux.HandleFunc("POST /api/servers/install-agent/{id}", s.handleInstallAgent)
	mux.HandleFunc("GET /api/servers/batch-install/stream", s.handleBatchInstallAgents)
	mux.HandleFunc("POST /api/servers/batch-install", s.handleBatchInstallAgents)
	mux.HandleFunc("GET /api/servers/{id}/sysinfo", s.handleServerSysInfo)

	// Core Host Inventory & OpenSSH Interoperability
	mux.HandleFunc("GET /api/hosts", s.handleListHosts)
	mux.HandleFunc("POST /api/hosts", s.handleCreateHost)
	mux.HandleFunc("GET /api/hosts/{id}", s.handleGetHost)
	mux.HandleFunc("PUT /api/hosts/{id}", s.handleUpdateHost)
	mux.HandleFunc("DELETE /api/hosts/{id}", s.handleDeleteHost)
	mux.HandleFunc("POST /api/hosts/{id}/test", s.handleTestHost)
	mux.HandleFunc("GET /api/hosts/export/openssh", s.handleExportOpenSSH)
	mux.HandleFunc("POST /api/hosts/import/openssh", s.handleImportOpenSSH)

	// Portable Secrets Vault & Full Migration
	mux.HandleFunc("POST /api/secrets/export-portable", s.handleExportPortableSecrets)
	mux.HandleFunc("POST /api/secrets/import-portable", s.handleImportPortableSecrets)
	mux.HandleFunc("POST /api/migration/export-full", s.handleExportFullMigration)

	// SysInfo & Hardware Telemetry (Localhost & Fleet Nodes)
	mux.HandleFunc("GET /api/sysinfo", s.handleSysInfo)

	// System Update & Self-Updater (CORE-001)
	mux.HandleFunc("GET /api/system/check-update", s.handleCheckSystemUpdate)
	mux.HandleFunc("POST /api/system/self-update", s.handleSelfUpdate)
	mux.HandleFunc("POST /api/system/restart", s.handleSystemRestart)

	// Remote Agent Proxy (bypasses browser mixed-content and CORS restrictions)
	mux.HandleFunc("/api/remote-proxy/{path...}", s.handleRemoteProxy)

	// Debug Telemetry Proxy to local debug server (:9998)
	mux.HandleFunc("/api/debug/{action...}", s.handleDebugProxy)

	// Health check
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Wrap API with Auth check
	apiHandler := s.authMiddleware(mux)

	// SPA & Static Files
	if s.cfg.WebFS != nil {
		fullMux := http.NewServeMux()
		fullMux.Handle("/api/", apiHandler)
		fullMux.HandleFunc("/", s.spaHandler)
		s.handler = s.gzipMiddleware(s.logMiddleware(fullMux))
	} else {
		s.handler = s.gzipMiddleware(s.logMiddleware(apiHandler))
	}
}
