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
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	res := s.ssh.Test(r.Context(), &cfg)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func (s *Server) handleSSHExec(w http.ResponseWriter, r *http.Request) {
	var req ssh.ExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Cmd == "" {
		jsonError(w, http.StatusBadRequest, "cmd cannot be empty")
		return
	}

	// Resolve Config from Core Hosts or Fleet if HostID is provided and Config is nil
	if req.Config == nil && req.HostID != "" {
		if req.HostID != "localhost" && req.HostID != "local" {
			if s.hosts != nil {
				if h, err := s.hosts.Get(req.HostID); err == nil && h != nil {
					req.Config = &ssh.Config{
						Host:       h.Host,
						Port:       h.Port,
						User:       h.User,
						IdentityID: h.IdentityID,
					}
				}
			}
			if req.Config == nil && s.fleet != nil {
				node, err := s.fleet.GetServer(req.HostID)
				if err == nil && node != nil {
					node.Normalize()
					if node.Connection.SSH != nil && node.Connection.SSH.Enabled {
						req.Config = &ssh.Config{
							Host:       node.Connection.SSH.Host,
							Port:       node.Connection.SSH.Port,
							User:       node.Connection.SSH.User,
							IdentityID: node.Connection.SSH.Identity,
						}
					}
				}
			}
		}
	}

	res, err := s.ssh.ExecuteCommand(r.Context(), req.Config, &req)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "execution error: "+err.Error())
		return
	}

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
		jsonError(w, http.StatusInternalServerError, "failed to generate key pair: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(kp)
}

func (s *Server) handleSFTPList(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	entries, err := s.ssh.ListDirectory(r.Context(), &req)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
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
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	data, err := s.ssh.ReadFile(r.Context(), &req)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
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
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	n, err := s.ssh.WriteFile(r.Context(), &req)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
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
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	fi, err := s.ssh.StatFile(r.Context(), &req)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(fi)
}

func (s *Server) handleSFTPMkdir(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := s.ssh.MakeDirectory(r.Context(), &req); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
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
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := s.ssh.DeleteItem(r.Context(), &req); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
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
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := s.ssh.RenameItem(r.Context(), &req); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"oldPath": req.Path,
		"newPath": req.NewPath,
	})
}

func (s *Server) handleSFTPBatchRead(w http.ResponseWriter, r *http.Request) {
	var req ssh.SFTPBatchReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	res, err := s.ssh.BatchReadFile(r.Context(), &req)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}
