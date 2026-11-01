package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"config-studio/internal/audit"
	"config-studio/internal/secrets"
)

func (s *Server) getSessionToken(r *http.Request) string {
	cookie, err := r.Cookie("cs_session")
	if err == nil && cookie.Value != "" {
		return cookie.Value
	}
	return ""
}

func (s *Server) handleGetSecretsStatus(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	token := s.getSessionToken(r)

	status := s.secrets.Status(settings.AuthEnabled, token)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(status)
}

func (s *Server) handleListSecrets(w http.ResponseWriter, r *http.Request) {
	list := s.secrets.List()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(list)
}

func (s *Server) handleListSharedSecrets(w http.ResponseWriter, r *http.Request) {
	list := s.secrets.ListShared()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(list)
}

type unlockSecretsRequest struct {
	Password string `json:"password"`
}

func (s *Server) handleUnlockSecrets(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	if !settings.AuthEnabled && s.cfg.AuthPass == "" {
		http.Error(w, `{"error":"Please enable password authentication in Settings to manage secrets"}`, http.StatusBadRequest)
		return
	}

	var req unlockSecretsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	valid := false
	if s.cfg.AuthPass != "" && req.Password == s.cfg.AuthPass {
		valid = true
	} else if s.config.CheckPass(req.Password) {
		valid = true
	}

	if !valid {
		http.Error(w, `{"error":"Invalid password"}`, http.StatusUnauthorized)
		return
	}

	// Retrieve or set session cookie
	token := s.getSessionToken(r)
	if token == "" {
		b := make([]byte, 24)
		_, _ = rand.Read(b)
		token = hex.EncodeToString(b)

		s.sessionsMu.Lock()
		s.sessions[token] = time.Now().Add(24 * time.Hour)
		s.sessionsMu.Unlock()

		http.SetCookie(w, &http.Cookie{
			Name:     "cs_session",
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Expires:  time.Now().Add(24 * time.Hour),
		})
	}

	s.secrets.UnlockSession(token, 15*time.Minute)

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "secret.unlock",
			Severity: audit.SeverityInfo,
			Target:   "secrets",
			Details:  map[string]any{"duration": "15m"},
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success":   true,
		"expiresIn": 900,
	})
}

type getSecretRequest struct {
	ID string `json:"id"`
}

func (s *Server) handleGetSecret(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	token := s.getSessionToken(r)

	var req getSecretRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	cleanID := strings.TrimSpace(req.ID)
	meta, exists := s.secrets.GetMeta(cleanID)
	if !exists {
		http.Error(w, `{"error":"secret '`+cleanID+`' not found"}`, http.StatusNotFound)
		return
	}

	// Privileged check: only require privileged unlock for shared secrets when auth is enabled.
	// Plugin-scoped secrets (ScopePlugin) or requests when Auth is disabled are accessible to Web UI/plugins.
	if settings.AuthEnabled && meta.Scope == secrets.ScopeShared && !s.secrets.IsPrivileged(token) {
		http.Error(w, `{"error":"Privileged mode required to access secret value"}`, http.StatusForbidden)
		return
	}

	val, err := s.secrets.Get(cleanID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusNotFound)
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "secret.reveal",
			Severity: audit.SeverityInfo,
			Target:   cleanID,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"id":    cleanID,
		"value": val,
	})
}

func (s *Server) handleSaveSecret(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	token := s.getSessionToken(r)

	var item secrets.SecretItem
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	if item.ID == "" {
		http.Error(w, `{"error":"Secret ID is required"}`, http.StatusBadRequest)
		return
	}

	if item.Scope == "" {
		if item.PluginID != "" {
			item.Scope = secrets.ScopePlugin
		} else {
			item.Scope = secrets.ScopeShared
		}
	}

	// Privileged check: only require privileged unlock for shared secrets when auth is enabled.
	// Plugin-scoped secrets can be saved directly by plugins and Web UI.
	if settings.AuthEnabled && item.Scope == secrets.ScopeShared && !s.secrets.IsPrivileged(token) {
		http.Error(w, `{"error":"Privileged mode required to save or edit shared secrets"}`, http.StatusForbidden)
		return
	}

	if err := s.secrets.Set(item); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "secret.save",
			Severity: audit.SeverityInfo,
			Target:   item.ID,
			Details: map[string]any{
				"title": item.Title,
				"type":  item.Type,
				"scope": item.Scope,
			},
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "saved",
		"id":     item.ID,
	})
}

func (s *Server) handleDeleteSecret(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	token := s.getSessionToken(r)

	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		http.Error(w, `{"error":"Secret ID is required"}`, http.StatusBadRequest)
		return
	}

	meta, exists := s.secrets.GetMeta(id)
	if exists && settings.AuthEnabled && meta.Scope == secrets.ScopeShared && !s.secrets.IsPrivileged(token) {
		http.Error(w, `{"error":"Privileged mode required to delete shared secrets"}`, http.StatusForbidden)
		return
	}

	if err := s.secrets.Delete(id); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "secret.delete",
			Severity: audit.SeverityWarn,
			Target:   id,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "deleted",
		"id":     id,
	})
}
