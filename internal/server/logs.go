package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"config-studio/internal/logs"
	"config-studio/internal/ssh"
)

func (s *Server) handleLogsStream(w http.ResponseWriter, r *http.Request) {
	var opts logs.StreamOptions

	if r.Method == http.MethodPost {
		// Read from JSON body
		if err := json.NewDecoder(r.Body).Decode(&opts); err != nil {
			jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
			return
		}
	} else {
		// Read from query parameters (Standard for browser EventSource GET)
		q := r.URL.Query()
		opts.Cmd = q.Get("cmd")
		opts.HostID = q.Get("hostId")
		opts.Source = q.Get("source")
		if tailStr := q.Get("tail"); tailStr != "" {
			opts.Tail, _ = strconv.Atoi(tailStr)
		}
		if sudoStr := q.Get("sudo"); sudoStr == "true" || sudoStr == "1" {
			opts.Sudo = true
		}
	}

	cleanCmd := strings.TrimSpace(opts.Cmd)
	if cleanCmd == "" {
		jsonError(w, http.StatusBadRequest, "cmd parameter cannot be empty")
		return
	}

	var sshCfg *ssh.Config

	// Resolve host configuration if HostID is provided and not local
	if opts.HostID != "" && opts.HostID != "localhost" && opts.HostID != "local" {
		if s.hosts != nil {
			if h, err := s.hosts.Get(opts.HostID); err == nil && h != nil {
				sshCfg = &ssh.Config{
					Host:       h.Host,
					Port:       h.Port,
					User:       h.User,
					IdentityID: h.IdentityID,
				}
			}
		}
		if sshCfg == nil && s.fleet != nil {
			node, err := s.fleet.GetServer(opts.HostID)
			if err == nil && node != nil {
				node.Normalize()
				if node.Connection.SSH != nil && node.Connection.SSH.Enabled {
					sshCfg = &ssh.Config{
						Host:       node.Connection.SSH.Host,
						Port:       node.Connection.SSH.Port,
						User:       node.Connection.SSH.User,
						IdentityID: node.Connection.SSH.Identity,
					}
				}
			}
		}
	}

	if err := s.logs.StreamSSE(r.Context(), w, s.ssh, sshCfg, &opts); err != nil {
		// Note: headers might already be written by StreamSSE if streaming began.
		// Only write an error if response has not started.
		return
	}
}
