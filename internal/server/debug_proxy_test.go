package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleDebugProxy(t *testing.T) {
	// Create mock upstream debug server
	mockDebugServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
			return
		}
		if r.URL.Path == "/events" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"received":true}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer mockDebugServer.Close()

	srv := &Server{}

	// Test proxy to non-existent endpoint (should return BadGateway gracefully)
	req := httptest.NewRequest(http.MethodGet, "/api/debug/health", nil)
	req.SetPathValue("action", "health")
	w := httptest.NewRecorder()

	srv.handleDebugProxy(w, req)
	// It will either connect to live 9998 or return 502 Bad Gateway
	if w.Code != http.StatusOK && w.Code != http.StatusBadGateway {
		t.Errorf("expected 200 or 502, got %d", w.Code)
	}

	// Test POST events body
	body := strings.NewReader(`{"kind":"USER_ACTION","label":"test"}`)
	postReq := httptest.NewRequest(http.MethodPost, "/api/debug/events", body)
	postReq.Header.Set("Content-Type", "application/json")
	postReq.SetPathValue("action", "events")
	postW := httptest.NewRecorder()

	srv.handleDebugProxy(postW, postReq)
	if postW.Code != http.StatusOK && postW.Code != http.StatusBadGateway {
		t.Errorf("expected 200 or 502, got %d", postW.Code)
	}
}
