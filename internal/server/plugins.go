package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"config-studio/internal/audit"
	"config-studio/internal/plugin"
)

func (s *Server) handleListPlugins(w http.ResponseWriter, r *http.Request) {
	plugins, err := s.plugins.ListPlugins()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to list plugins: "+err.Error())
		return
	}
	if plugins == nil {
		plugins = []plugin.Plugin{}
	}
	jsonResponse(w, http.StatusOK, map[string]any{"plugins": plugins})
}

func (s *Server) handleTogglePlugin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ID == "" {
		jsonError(w, http.StatusBadRequest, "plugin id is required")
		return
	}

	if err := s.plugins.TogglePlugin(req.ID, req.Enabled); err != nil {
		var depErr *plugin.DependencyInUseError
		if errors.As(err, &depErr) {
			jsonResponse(w, http.StatusConflict, map[string]any{
				"error":      "dependency_in_use",
				"message":    err.Error(),
				"pluginId":   depErr.PluginID,
				"dependents": depErr.Dependents,
			})
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionPluginToggle,
			Severity: audit.SeverityInfo,
			Target:   req.ID,
			Details:  map[string]any{"enabled": req.Enabled},
		})
	}

	p, err := s.plugins.GetPlugin(req.ID)
	if err != nil {
		jsonResponse(w, http.StatusOK, map[string]any{"status": "ok", "id": req.ID, "enabled": req.Enabled})
		return
	}
	jsonResponse(w, http.StatusOK, p)
}

func (s *Server) handleInspectPluginUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(50 << 20); err != nil { // 50MB max
		jsonError(w, http.StatusBadRequest, "file too large or invalid multipart form")
		return
	}

	file, header, err := r.FormFile("plugin")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing 'plugin' file parameter: "+err.Error())
		return
	}
	defer file.Close()

	filename := strings.ToLower(header.Filename)
	if !strings.HasSuffix(filename, ".zip") && !strings.HasSuffix(filename, ".cspkg") {
		jsonError(w, http.StatusBadRequest, "only .zip archives or .cspkg packages are supported for plugin inspection")
		return
	}

	pending, err := s.plugins.InspectZip(file, header.Size, "")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to inspect plugin: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "inspected",
		"pending": pending,
	})
}

func (s *Server) handleInspectPluginURL(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.URL == "" {
		jsonError(w, http.StatusBadRequest, "url is required")
		return
	}

	pending, err := s.plugins.InspectURL(req.URL)
	if err != nil {
		if s.audit != nil {
			_ = s.audit.Log(audit.Event{
				User:     s.getAuditUser(r),
				IP:       r.RemoteAddr,
				Category: audit.CategoryNetwork,
				Action:   audit.ActionNetError,
				Severity: audit.SeverityError,
				Target:   req.URL,
				Details:  map[string]any{"error": err.Error(), "operation": "inspect_url"},
			})
		}
		jsonError(w, http.StatusBadRequest, "failed to inspect plugin from URL: "+err.Error())
		return
	}

	if s.audit != nil && pending != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Category: audit.CategoryNetwork,
			Action:   audit.ActionNetDownload,
			Severity: audit.SeverityInfo,
			Target:   req.URL,
			Details:  map[string]any{"operation": "inspect_url", "pluginId": pending.Manifest.ID, "version": pending.Manifest.Version},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "inspected",
		"pending": pending,
	})
}

func (s *Server) handleConfirmPluginInstall(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TempKey string `json:"tempKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.TempKey == "" {
		jsonError(w, http.StatusBadRequest, "tempKey is required")
		return
	}

	installed, err := s.plugins.ConfirmInstall(req.TempKey)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to confirm plugin installation: "+err.Error())
		return
	}

	if s.audit != nil && installed != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionPluginInstall,
			Severity: audit.SeverityInfo,
			Target:   installed.ID,
			Details: map[string]any{
				"name":        installed.Name,
				"version":     installed.Version,
				"permissions": installed.Permissions,
			},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "installed",
		"plugin": installed,
	})
}

func (s *Server) handleCancelPluginInstall(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TempKey string `json:"tempKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.TempKey != "" {
		_ = s.plugins.CancelInstall(req.TempKey)
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "canceled"})
}

func (s *Server) handleInstallPluginUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(50 << 20); err != nil { // 50MB max
		jsonError(w, http.StatusBadRequest, "file too large or invalid multipart form")
		return
	}

	file, header, err := r.FormFile("plugin")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing 'plugin' file parameter: "+err.Error())
		return
	}
	defer file.Close()

	if !strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		jsonError(w, http.StatusBadRequest, "only .zip archives are supported for plugin installation")
		return
	}

	installed, err := s.plugins.InstallFromZip(file, header.Size)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to install plugin: "+err.Error())
		return
	}

	if s.audit != nil && installed != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionPluginInstall,
			Severity: audit.SeverityInfo,
			Target:   installed.ID,
			Details:  map[string]any{"name": installed.Name, "version": installed.Version, "source": "zip"},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "installed",
		"plugin": installed,
	})
}

func (s *Server) handleInstallPluginURL(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.URL == "" {
		jsonError(w, http.StatusBadRequest, "url is required")
		return
	}

	installed, err := s.plugins.InstallFromURL(req.URL)
	if err != nil {
		if s.audit != nil {
			_ = s.audit.Log(audit.Event{
				User:     s.getAuditUser(r),
				IP:       r.RemoteAddr,
				Category: audit.CategoryNetwork,
				Action:   audit.ActionNetError,
				Severity: audit.SeverityError,
				Target:   req.URL,
				Details:  map[string]any{"error": err.Error(), "operation": "install_url"},
			})
		}
		jsonError(w, http.StatusBadRequest, "failed to install plugin from URL: "+err.Error())
		return
	}

	if s.audit != nil && installed != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionPluginInstall,
			Severity: audit.SeverityInfo,
			Target:   installed.ID,
			Details:  map[string]any{"name": installed.Name, "version": installed.Version, "url": req.URL, "source": "url"},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "installed",
		"plugin": installed,
	})
}

func (s *Server) handleDeletePlugin(w http.ResponseWriter, r *http.Request) {
	pluginID := r.PathValue("id")
	if pluginID == "" {
		jsonError(w, http.StatusBadRequest, "plugin id is required")
		return
	}

	if err := s.plugins.DeletePlugin(pluginID); err != nil {
		var depErr *plugin.DependencyInUseError
		if errors.As(err, &depErr) {
			jsonResponse(w, http.StatusConflict, map[string]any{
				"error":      "dependency_in_use",
				"message":    err.Error(),
				"pluginId":   depErr.PluginID,
				"dependents": depErr.Dependents,
			})
			return
		}
		jsonError(w, http.StatusInternalServerError, "failed to delete plugin: "+err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionPluginDelete,
			Severity: audit.SeverityWarn,
			Target:   pluginID,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted", "id": pluginID})
}

func (s *Server) handleServePluginFile(w http.ResponseWriter, r *http.Request) {
	pluginID := r.PathValue("id")
	relPath := r.PathValue("path")
	if pluginID == "" || relPath == "" {
		http.NotFound(w, r)
		return
	}

	s.plugins.ServeFile(w, r, pluginID, relPath)
}

func hasPluginPermission(permissions []string, required string) bool {
	for _, p := range permissions {
		if p == required || p == "*" {
			return true
		}
		if (p == "terminal.exec" || p == "shell.exec") && (required == "shell.exec" || required == "terminal.exec") {
			return true
		}
	}
	return false
}

func (s *Server) handleExecPluginCommand(w http.ResponseWriter, r *http.Request) {
	var req plugin.ExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Command == "" {
		jsonError(w, http.StatusBadRequest, "command is required")
		return
	}

	settings := s.config.Get()
	unrestricted := settings.PluginExecUnrestricted

	// Capability check: if plugin is specified, verify it has shell.exec or terminal.exec capability.
	// Empty or "core" plugin IDs cannot bypass permission check unless unrestricted mode is enabled.
	if req.PluginID == "" || req.PluginID == "core" {
		if !unrestricted {
			jsonError(w, http.StatusForbidden, "unrestricted execution is disabled; command requires a valid plugin with 'shell.exec' or 'terminal.exec' capability")
			return
		}
	} else {
		p, err := s.plugins.GetPlugin(req.PluginID)
		if err != nil {
			jsonError(w, http.StatusNotFound, fmt.Sprintf("plugin %q not found", req.PluginID))
			return
		}
		if !hasPluginPermission(p.Permissions, "shell.exec") && !hasPluginPermission(p.Permissions, "terminal.exec") {
			jsonError(w, http.StatusForbidden, fmt.Sprintf("plugin %q lacks required 'shell.exec' or 'terminal.exec' capability", req.PluginID))
			return
		}
	}

	// If no cwd specified, default to workdir
	if req.Cwd == "" {
		req.Cwd = s.fs.WorkDir
	}

	resp, err := s.pluginRunner.ExecCommand(r.Context(), req, unrestricted)
	if err != nil && resp == nil {
		jsonError(w, http.StatusForbidden, err.Error())
		return
	}

	if s.audit != nil && resp != nil {
		sev := audit.SeverityInfo
		if resp.ExitCode != 0 {
			sev = audit.SeverityWarn
		}
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionShellExec,
			Severity: sev,
			Target:   req.PluginID,
			Details: map[string]any{
				"command":    req.Command,
				"args":       req.Args,
				"exitCode":   resp.ExitCode,
				"durationMs": resp.DurationMs,
			},
		})
	}

	jsonResponse(w, http.StatusOK, resp)
}

func (s *Server) handleStartPluginProcess(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PluginID  string   `json:"pluginId"`
		Command   string   `json:"command"`
		Args      []string `json:"args"`
		Cwd       string   `json:"cwd"`
		Port      int      `json:"port"`
		Confirmed bool     `json:"confirmed"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Command == "" {
		jsonError(w, http.StatusBadRequest, "command is required")
		return
	}

	settings := s.config.Get()
	unrestricted := settings.PluginExecUnrestricted

	// Capability check: if plugin is specified, verify it has shell.exec or terminal.exec capability
	if req.PluginID == "" || req.PluginID == "core" {
		if !unrestricted {
			jsonError(w, http.StatusForbidden, "execution with core/empty pluginId requires unrestricted plugin execution to be enabled")
			return
		}
	} else {
		p, err := s.plugins.GetPlugin(req.PluginID)
		if err != nil {
			jsonError(w, http.StatusNotFound, fmt.Sprintf("plugin %q not found", req.PluginID))
			return
		}
		if !hasPluginPermission(p.Permissions, "shell.exec") && !hasPluginPermission(p.Permissions, "terminal.exec") {
			jsonError(w, http.StatusForbidden, fmt.Sprintf("plugin %q lacks required 'shell.exec' or 'terminal.exec' capability", req.PluginID))
			return
		}
	}

	if req.Cwd == "" {
		req.Cwd = s.fs.WorkDir
	}

	info, err := s.pluginRunner.StartProcess(req.PluginID, req.Command, req.Args, req.Cwd, req.Port, unrestricted, req.Confirmed)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to start process: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, info)
}

func (s *Server) handleStopPluginProcess(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProcessID string `json:"processId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ProcessID == "" {
		jsonError(w, http.StatusBadRequest, "processId is required")
		return
	}

	if err := s.pluginRunner.StopProcess(req.ProcessID); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "stopped", "processId": req.ProcessID})
}

func (s *Server) handleListPluginProcesses(w http.ResponseWriter, r *http.Request) {
	procs := s.pluginRunner.ListProcesses()
	jsonResponse(w, http.StatusOK, map[string]any{"processes": procs})
}

func (s *Server) handleGetPluginProcessLogs(w http.ResponseWriter, r *http.Request) {
	procID := r.PathValue("id")
	if procID == "" {
		jsonError(w, http.StatusBadRequest, "process id is required")
		return
	}

	logs, err := s.pluginRunner.GetProcessLogs(procID)
	if err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"processId": procID, "logs": logs})
}

func (s *Server) handleGetPluginSettings(w http.ResponseWriter, r *http.Request) {
	pluginID := r.PathValue("id")
	if pluginID == "" {
		jsonError(w, http.StatusBadRequest, "plugin id is required")
		return
	}

	settings, err := s.plugins.GetPluginSettings(pluginID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to get plugin settings: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{"id": pluginID, "settings": settings})
}

func (s *Server) handleSavePluginSettings(w http.ResponseWriter, r *http.Request) {
	pluginID := r.PathValue("id")
	if pluginID == "" {
		jsonError(w, http.StatusBadRequest, "plugin id is required")
		return
	}

	var req struct {
		Settings map[string]any `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := s.plugins.SavePluginSettings(pluginID, req.Settings); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save plugin settings: "+err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Category: audit.CategoryPlugin,
			Action:   "plugin.settings.save",
			Severity: audit.SeverityInfo,
			Target:   pluginID,
			Details:  map[string]any{"pluginId": pluginID, "keysCount": len(req.Settings)},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{"status": "saved", "id": pluginID, "settings": req.Settings})
}
