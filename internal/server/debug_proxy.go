package server

import (
	"io"
	"net/http"
	"time"
)

// handleDebugProxy proxies debug telemetry requests to the local debug server (:9998).
func (s *Server) handleDebugProxy(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	targetURL := "http://127.0.0.1:9998/" + action
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		jsonError(w, http.StatusBadGateway, "failed to create debug proxy request")
		return
	}
	if ct := r.Header.Get("Content-Type"); ct != "" {
		proxyReq.Header.Set("Content-Type", ct)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(proxyReq)
	if err != nil {
		jsonError(w, http.StatusBadGateway, "debug server :9998 unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
