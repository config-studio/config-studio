package server

import (
	"encoding/json"
	"net/http"

	"config-studio/internal/ssh"
)

func (s *Server) handleSSHWebSocket(w http.ResponseWriter, r *http.Request) {
	s.ssh.HandleWebSocket(w, r)
}

func (s *Server) handleSSHTest(w http.ResponseWriter, r *http.Request) {
	var cfg ssh.Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	res := s.ssh.Test(r.Context(), &cfg)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func (s *Server) handleSSHGenerateKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Comment string `json:"comment"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	kp, err := ssh.GenerateEd25519KeyPair(req.Comment)
	if err != nil {
		http.Error(w, "failed to generate key pair: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(kp)
}

func (s *Server) handleSFTPList(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	entries, err := s.ssh.ListDirectory(r.Context(), &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"path":    req.Path,
		"entries": entries,
	})
}

func (s *Server) handleSFTPRead(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	data, err := s.ssh.ReadFile(r.Context(), &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if r.Header.Get("Accept") == "application/octet-stream" {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(data)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"path":    req.Path,
		"content": string(data),
		"size":    len(data),
	})
}

func (s *Server) handleSFTPWrite(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	n, err := s.ssh.WriteFile(r.Context(), &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success":      true,
		"path":         req.Path,
		"bytesWritten": n,
	})
}

func (s *Server) handleSFTPStat(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	fi, err := s.ssh.StatFile(r.Context(), &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(fi)
}

func (s *Server) handleSFTPMkdir(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.ssh.MakeDirectory(r.Context(), &req); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"path":    req.Path,
	})
}

func (s *Server) handleSFTPDelete(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.ssh.DeleteItem(r.Context(), &req); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"path":    req.Path,
	})
}

func (s *Server) handleSFTPRename(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.ssh.RenameItem(r.Context(), &req); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"oldPath": req.Path,
		"newPath": req.NewPath,
	})
}
