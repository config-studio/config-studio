package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"config-studio/internal/audit"
	"config-studio/internal/fleet"
	"config-studio/internal/hosts"
)

// handleListServers returns all configured fleet servers.
func (s *Server) handleListServers(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}

	servers := s.fleet.ListServers()

	// Merge with Core Hosts if any host is present in Core but not yet in Fleet
	if s.hosts != nil {
		existingMap := make(map[string]bool)
		for _, srv := range servers {
			existingMap[srv.ID] = true
			if srv.SSHHostRef != "" {
				existingMap[srv.SSHHostRef] = true
			}
			if srv.Connection.SSH != nil && srv.Connection.SSH.Host != "" {
				port := srv.Connection.SSH.Port
				if port <= 0 {
					port = 22
				}
				key := fmt.Sprintf("%s@%s:%d", strings.ToLower(strings.TrimSpace(srv.Connection.SSH.User)), strings.ToLower(strings.TrimSpace(srv.Connection.SSH.Host)), port)
				existingMap[key] = true
			}
		}

		coreHosts := s.hosts.List()
		for _, h := range coreHosts {
			key := fmt.Sprintf("%s@%s:%d", strings.ToLower(strings.TrimSpace(h.User)), strings.ToLower(strings.TrimSpace(h.Host)), h.NormalizedPort())
			if !existingMap[h.ID] && !existingMap[key] && h.ID != "localhost" && h.ID != "local" {
				node := fleet.ServerNode{
					ID:          h.ID,
					Name:        h.Name,
					Description: h.Description,
					Group:       h.Group,
					Tags:        h.Tags,
					Color:       h.Color,
					Icon:        h.Icon,
					SSHHostRef:  h.ID,
				}
				node.Connection.SSH = &fleet.SSHConnectionConfig{
					Enabled:   true,
					Host:      h.Host,
					Port:      h.Port,
					User:      h.User,
					Identity:  h.IdentityID,
					ProxyJump: h.ProxyJump,
				}
				node.Host = h.Host
				node.Port = h.Port
				node.User = h.User
				node.Identity = h.IdentityID
				servers = append(servers, node)
			}
		}
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"servers": servers,
		"count":   len(servers),
	})
}

// handleAddOrUpdateServer inserts or updates a server in servers.yaml.
func (s *Server) handleAddOrUpdateServer(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}

	var srv fleet.ServerNode
	if err := json.NewDecoder(r.Body).Decode(&srv); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if srv.ID == "" {
		jsonError(w, http.StatusBadRequest, "server 'id' is required")
		return
	}

	// Single Source of Truth: if sshHostRef is provided, link with Core Host
	if srv.SSHHostRef != "" && s.hosts != nil {
		if h, err := s.hosts.Get(srv.SSHHostRef); err == nil && h != nil {
			if srv.Name == "" {
				srv.Name = h.Name
			}
		}
	} else if s.hosts != nil && srv.ID != "localhost" && srv.ID != "local" {
		// Mirror SSH config to Core Host Storage and link ref
		if srv.Connection.SSH != nil && srv.Connection.SSH.Enabled && strings.TrimSpace(srv.Connection.SSH.Host) != "" {
			h, _ := s.hosts.Save(&hosts.Host{
				ID:          srv.ID,
				Name:        srv.Name,
				Host:        srv.Connection.SSH.Host,
				Port:        srv.Connection.SSH.Port,
				User:        srv.Connection.SSH.User,
				IdentityID:  srv.Connection.SSH.Identity,
				ProxyJump:   srv.Connection.SSH.ProxyJump,
				Group:       srv.Group,
				Tags:        srv.Tags,
				Color:       srv.Color,
				Icon:        srv.Icon,
				Description: srv.Description,
			})
			if h != nil {
				srv.SSHHostRef = h.ID
			}
		}
	}

	if err := s.fleet.AddOrUpdateServer(srv); err != nil {
		jsonError(w, http.StatusBadRequest, "failed to save server: "+err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "fleet.server.save",
			Severity: audit.SeverityInfo,
			Target:   srv.ID,
			Details: map[string]any{
				"name":  srv.Name,
				"group": srv.Group,
				"tags":  srv.Tags,
			},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"server":  srv,
	})
}

// handleDeleteServer deletes a server from servers.yaml.
func (s *Server) handleDeleteServer(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/servers/")
	}
	if id == "" {
		jsonError(w, http.StatusBadRequest, "server id required")
		return
	}

	if id == "localhost" {
		jsonError(w, http.StatusBadRequest, "cannot delete localhost default node")
		return
	}

	if err := s.fleet.DeleteServer(id); err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}

	if s.hosts != nil && id != "localhost" && id != "local" {
		_ = s.hosts.Delete(id)
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "fleet.server.delete",
			Severity: audit.SeverityWarn,
			Target:   id,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"deleted": id,
	})
}

// handleGetRawServersYAML returns the raw servers.yaml file.
func (s *Server) handleGetRawServersYAML(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}

	raw, err := s.fleet.GetRawYAML()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to read servers.yaml: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(raw))
}

// handleSetRawServersYAML validates and writes raw servers.yaml content.
func (s *Server) handleSetRawServersYAML(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}

	var req struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := s.fleet.SetRawYAML(req.Content); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid servers.yaml syntax or schema: "+err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "fleet.yaml.raw_save",
			Severity: audit.SeverityWarn,
			Target:   "servers.yaml",
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"servers": s.fleet.ListServers(),
	})
}

// handlePingServer checks connectivity to a server node.
func (s *Server) handlePingServer(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/servers/ping/")
	}
	if id == "" {
		jsonError(w, http.StatusBadRequest, "server id required")
		return
	}

	res := s.fleet.Ping(r.Context(), id)
	jsonResponse(w, http.StatusOK, res)
}

// handleInstallAgent installs config-studio-agent daemon to a remote SSH server.
func (s *Server) handleInstallAgent(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}
	if s.ssh == nil {
		jsonError(w, http.StatusInternalServerError, "ssh client manager not initialized")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/servers/install-agent/")
	}
	if id == "" {
		jsonError(w, http.StatusBadRequest, "server id required")
		return
	}

	var opts fleet.InstallAgentOptions
	if r.Body != nil && r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&opts)
	}

	res, err := s.fleet.InstallAgent(r.Context(), id, opts, s.ssh, s.secrets)
	if err != nil {
		if s.audit != nil {
			_ = s.audit.Log(audit.Event{
				User:     s.getAuditUser(r),
				IP:       r.RemoteAddr,
				Action:   "fleet.agent.install_error",
				Severity: audit.SeverityError,
				Target:   id,
				Details:  map[string]any{"error": err.Error(), "port": opts.Port},
			})
		}
		if res == nil {
			res = &fleet.InstallAgentResult{
				Success: false,
				Error:   err.Error(),
				Logs:    []string{err.Error()},
			}
		}
		jsonResponse(w, http.StatusInternalServerError, res)
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "fleet.agent.install",
			Severity: audit.SeverityInfo,
			Target:   id,
			Details:  map[string]any{"port": opts.Port, "agentUrl": res.AgentURL},
		})
	}

	jsonResponse(w, http.StatusOK, res)
}

