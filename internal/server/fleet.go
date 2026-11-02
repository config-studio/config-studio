package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"config-studio/internal/audit"
	"config-studio/internal/fleet"
)

// handleListServers returns all configured fleet servers.
func (s *Server) handleListServers(w http.ResponseWriter, r *http.Request) {
	if s.fleet == nil {
		jsonError(w, http.StatusInternalServerError, "fleet manager not initialized")
		return
	}

	servers := s.fleet.ListServers()
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
