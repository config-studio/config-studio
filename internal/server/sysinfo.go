package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"config-studio/internal/sysinfo"
)

const coreSysInfoVersion = "2.0.0"

// handleSysInfo returns system metrics for Localhost or an active/requested server node.
func (s *Server) handleSysInfo(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server")
	if serverID == "" {
		serverID = r.URL.Query().Get("node")
	}
	targetURL := r.URL.Query().Get("target")

	// If no remote target or server requested, return local host metrics
	if (serverID == "" && targetURL == "") || serverID == "local" || serverID == "localhost" {
		metrics := sysinfo.Collect(coreSysInfoVersion)
		jsonResponse(w, http.StatusOK, metrics)
		return
	}

	// Remote target specified: either server ID from fleet or direct target URL
	s.fetchRemoteSysInfo(w, r, serverID, targetURL)
}

// handleServerSysInfo returns system metrics for a specific server in the fleet.
func (s *Server) handleServerSysInfo(w http.ResponseWriter, r *http.Request) {
	serverID := r.PathValue("id")
	if serverID == "" || serverID == "local" || serverID == "localhost" {
		metrics := sysinfo.Collect(coreSysInfoVersion)
		jsonResponse(w, http.StatusOK, metrics)
		return
	}

	s.fetchRemoteSysInfo(w, r, serverID, "")
}

func (s *Server) fetchRemoteSysInfo(w http.ResponseWriter, r *http.Request, serverID, targetURL string) {
	var agentURL string
	var token string

	if serverID != "" && s.fleet != nil {
		srv, err := s.fleet.GetServer(serverID)
		if err != nil || srv == nil {
			jsonError(w, http.StatusNotFound, fmt.Sprintf("server '%s' not found in fleet", serverID))
			return
		}

		if srv.Connection.Agent == nil || !srv.Connection.Agent.Enabled {
			jsonError(w, http.StatusBadGateway, fmt.Sprintf("remote agent is not enabled for server '%s'", serverID))
			return
		}

		agentURL = srv.Connection.Agent.URL
		if srv.Connection.Agent.VaultSecret != "" && s.secrets != nil {
			val, err := s.secrets.Get(srv.Connection.Agent.VaultSecret)
			if err == nil && val != "" {
				token = val
			}
		}
	} else if targetURL != "" {
		agentURL = targetURL
	}

	if agentURL == "" {
		jsonError(w, http.StatusBadRequest, "no target or agent URL could be resolved")
		return
	}

	agentURL = strings.TrimRight(agentURL, "/")
	if !strings.HasPrefix(agentURL, "http://") && !strings.HasPrefix(agentURL, "https://") {
		agentURL = "http://" + agentURL
	}

	reqURL := agentURL + "/api/sysinfo"
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), "GET", reqURL, nil)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to create proxy request: "+err.Error())
		return
	}

	// Forward client auth token if available, or use resolved vault token
	clientAuth := r.Header.Get("Authorization")
	if clientAuth != "" {
		req.Header.Set("Authorization", clientAuth)
	} else if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		jsonError(w, http.StatusBadGateway, fmt.Sprintf("failed to reach remote agent at %s: %s", agentURL, err.Error()))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to read remote response: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}
