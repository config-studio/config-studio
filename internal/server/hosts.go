package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"config-studio/internal/audit"
	"config-studio/internal/hosts"
	"config-studio/internal/ssh"
)

func (s *Server) handleListHosts(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil {
		jsonResponse(w, http.StatusOK, []*hosts.Host{})
		return
	}

	list := s.hosts.List()
	jsonResponse(w, http.StatusOK, list)
}

func (s *Server) handleGetHost(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil {
		jsonError(w, http.StatusNotFound, "hosts subsystem not initialized")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		jsonError(w, http.StatusBadRequest, "host id required")
		return
	}

	h, err := s.hosts.Get(id)
	if err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, h)
}

func (s *Server) handleCreateHost(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil {
		jsonError(w, http.StatusInternalServerError, "hosts subsystem not initialized")
		return
	}

	var h hosts.Host
	if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	saved, err := s.hosts.Save(&h)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to save host: "+err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "hosts.create",
			Severity: audit.SeverityInfo,
			Target:   saved.ID,
			Details:  map[string]any{"name": saved.Name, "host": saved.Host},
		})
	}

	jsonResponse(w, http.StatusCreated, saved)
}

func (s *Server) handleUpdateHost(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil {
		jsonError(w, http.StatusInternalServerError, "hosts subsystem not initialized")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		jsonError(w, http.StatusBadRequest, "host id required")
		return
	}

	var h hosts.Host
	if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	h.ID = id

	saved, err := s.hosts.Save(&h)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to update host: "+err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "hosts.update",
			Severity: audit.SeverityInfo,
			Target:   saved.ID,
			Details:  map[string]any{"name": saved.Name, "host": saved.Host},
		})
	}

	jsonResponse(w, http.StatusOK, saved)
}

func (s *Server) handleDeleteHost(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil {
		jsonError(w, http.StatusInternalServerError, "hosts subsystem not initialized")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		jsonError(w, http.StatusBadRequest, "host id required")
		return
	}

	if err := s.hosts.Delete(id); err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "hosts.delete",
			Severity: audit.SeverityWarn,
			Target:   id,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleTestHost(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil || s.ssh == nil {
		jsonError(w, http.StatusInternalServerError, "subsystems not initialized")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		jsonError(w, http.StatusBadRequest, "host id required")
		return
	}

	h, err := s.hosts.Get(id)
	if err != nil {
		jsonError(w, http.StatusNotFound, "host not found")
		return
	}

	sshCfg := &ssh.Config{
		Host:       h.Host,
		Port:       h.Port,
		User:       h.User,
		AuthType:   string(h.AuthType),
		IdentityID: h.IdentityID,
		Password:   h.Password,
		PrivateKey: h.PrivateKey,
		Passphrase: h.Passphrase,
		TimeoutSec: h.TimeoutSec,
	}
	if h.ProxyJump != "" {
		sshCfg.JumpHost = &ssh.Config{Host: h.ProxyJump}
	}

	res := s.ssh.Test(r.Context(), sshCfg)
	jsonResponse(w, http.StatusOK, res)
}

func (s *Server) handleExportOpenSSH(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil {
		jsonError(w, http.StatusInternalServerError, "hosts subsystem not initialized")
		return
	}

	list := s.hosts.List()
	configText := hosts.ExportOpenSSH(list)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"config\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(configText))
}

type importOpenSSHRequest struct {
	Content string `json:"content"`
}

func (s *Server) handleImportOpenSSH(w http.ResponseWriter, r *http.Request) {
	if s.hosts == nil {
		jsonError(w, http.StatusInternalServerError, "hosts subsystem not initialized")
		return
	}

	var content string
	contentType := r.Header.Get("Content-Type")

	if strings.Contains(contentType, "application/json") {
		var req importOpenSSHRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, http.StatusBadRequest, "invalid json payload: "+err.Error())
			return
		}
		content = req.Content
	} else {
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			jsonError(w, http.StatusBadRequest, "failed to read body: "+err.Error())
			return
		}
		content = string(bodyBytes)
	}

	if strings.TrimSpace(content) == "" {
		jsonError(w, http.StatusBadRequest, "openssh config content cannot be empty")
		return
	}

	parsedHosts, err := hosts.ParseOpenSSH(content)
	if err != nil {
		jsonError(w, http.StatusBadRequest, fmt.Sprintf("failed to parse OpenSSH config: %v", err))
		return
	}

	res, err := s.hosts.ImportBatch(parsedHosts)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to import hosts: "+err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "hosts.import_openssh",
			Severity: audit.SeverityInfo,
			Details:  map[string]any{"imported": res.Imported, "updated": res.Updated, "total": res.TotalParsed},
		})
	}

	jsonResponse(w, http.StatusOK, res)
}
