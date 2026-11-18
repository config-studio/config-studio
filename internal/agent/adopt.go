package agent

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

// handleAdopt performs a one-time pairing handshake with Config Studio host.
// Once adopted, it sets adopted: true, persists configuration, and permanently locks the endpoint.
func (s *Server) handleAdopt(w http.ResponseWriter, r *http.Request) {
	s.cfg.mu.Lock()
	if s.cfg.Adopted {
		s.cfg.mu.Unlock()
		jsonError(w, http.StatusForbidden, "Agent is already adopted")
		return
	}

	if s.cfg.AdoptToken != "" {
		token := r.Header.Get("X-CS-Adopt-Token")
		if token != s.cfg.AdoptToken {
			s.cfg.mu.Unlock()
			jsonError(w, http.StatusUnauthorized, "invalid or missing X-CS-Adopt-Token header")
			return
		}
	}

	hostname, _ := os.Hostname()
	res := map[string]any{
		"status":   "adopted",
		"hostname": hostname,
		"keyId":    s.cfg.Master.KeyID,
		"secret":   s.cfg.Master.Secret,
	}

	s.cfg.Adopted = true
	s.cfg.mu.Unlock()

	if err := s.cfg.Save(); err != nil {
		log.Printf("[Agent] Failed to save adopted status: %v", err)
	}
	log.Printf("[Agent] Successfully adopted by Config Studio Host! Hostname: %s", hostname)

	jsonResponse(w, http.StatusOK, res)
}

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
