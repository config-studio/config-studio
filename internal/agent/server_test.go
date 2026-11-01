package agent

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func setupTestServer(t *testing.T) (*Server, *Config, string) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "agent.yaml")

	cfg := DefaultConfig(cfgPath)
	cfg.Sandbox.AllowedRoots = []string{tmpDir}
	_ = cfg.Save()

	srv := NewServer(cfg, "2.0.0-test")
	return srv, cfg, tmpDir
}

func TestServerHealthAndStatus(t *testing.T) {
	srv, cfg, _ := setupTestServer(t)

	// 1. Health check (no auth needed)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on /health, got %d", w.Code)
	}

	// 2. Status with Master Key RO
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+cfg.Master.KeyID)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on /api/status RO, got %d", w.Code)
	}
	var res map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res["accessLevel"] != "read_only" {
		t.Errorf("Expected read_only, got %v", res["accessLevel"])
	}

	// 3. Status with Master Key + TOTP (RW)
	otp, _ := GenerateTOTP(cfg.Master.Secret, time.Now(), 6)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+cfg.Master.KeyID+":"+otp)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on /api/status RW, got %d", w.Code)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res["accessLevel"] != "read_write" {
		t.Errorf("Expected read_write, got %v", res["accessLevel"])
	}
}

func TestServerFSPermissions(t *testing.T) {
	srv, cfg, tmpDir := setupTestServer(t)
	testFile := filepath.Join(tmpDir, "test.conf")

	// 1. Write file with Master RO -> MUST FAIL (403 Forbidden)
	writeBody := []byte(`{"path": "` + filepath.ToSlash(testFile) + `", "content": "hello world"}`)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/fs/file", bytes.NewReader(writeBody))
	req.Header.Set("Authorization", "Bearer "+cfg.Master.KeyID)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("Expected 403 on write with Master RO, got %d", w.Code)
	}

	// 2. Write file with Master RW (Valid TOTP) -> MUST SUCCEED (200 OK)
	otp, _ := GenerateTOTP(cfg.Master.Secret, time.Now(), 6)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/fs/file", bytes.NewReader(writeBody))
	req.Header.Set("Authorization", "Bearer "+cfg.Master.KeyID+":"+otp)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on write with Master RW, got %d", w.Code)
	}

	// 3. Read file with Master RO -> MUST SUCCEED (200 OK)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/fs/file?path="+filepath.ToSlash(testFile), nil)
	req.Header.Set("Authorization", "Bearer "+cfg.Master.KeyID)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on read file, got %d", w.Code)
	}
	var readRes map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &readRes)
	if readRes["content"] != "hello world" {
		t.Errorf("Content mismatch: %v", readRes["content"])
	}
}

func TestServerMetricsPrometheus(t *testing.T) {
	srv, cfg, _ := setupTestServer(t)

	// Add prometheus token
	tok, _ := cfg.AddScopedToken("prom", "Prometheus", []string{"metrics"}, nil)
	srv.auth.UpdateTokens(cfg.ScopedTokens)

	// Request Prometheus text format
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+tok.Token)
	req.Header.Set("Accept", "text/plain")
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on /api/metrics, got %d", w.Code)
	}
	bodyStr := w.Body.String()
	if !bytes.Contains([]byte(bodyStr), []byte("cs_agent_cpu_cores")) {
		t.Errorf("Expected Prometheus metrics to contain cs_agent_cpu_cores")
	}
}

func TestServerAdopt(t *testing.T) {
	srv, cfg, _ := setupTestServer(t)

	// Verify health check returns adopted: false
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on /health, got %d", w.Code)
	}
	var healthRes map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &healthRes)
	if healthRes["adopted"] != false {
		t.Fatalf("Expected adopted: false, got %v", healthRes["adopted"])
	}

	// 1. First adopt call -> MUST SUCCEED (200 OK)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/adopt", nil)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 on /api/adopt, got %d", w.Code)
	}
	var adoptRes map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &adoptRes)
	if adoptRes["keyId"] != cfg.Master.KeyID || adoptRes["secret"] != cfg.Master.Secret {
		t.Errorf("Credentials mismatch in adopt response: %v", adoptRes)
	}
	if !cfg.Adopted {
		t.Errorf("Expected cfg.Adopted to be true")
	}

	// 2. Second adopt call -> MUST FAIL (403 Forbidden)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/adopt", nil)
	srv.srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("Expected 403 on second adopt call, got %d", w.Code)
	}
}
