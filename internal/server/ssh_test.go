package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	appfs "config-studio/internal/fs"
	"config-studio/internal/plugin"
	"config-studio/internal/secrets"
	"config-studio/internal/ssh"
)

func createTestServerWithSSH(t *testing.T) (*Server, func()) {
	tmpDir, err := os.MkdirTemp("", "cs-server-ssh-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}

	workDir, err := os.MkdirTemp("", "cs-workdir-*")
	if err != nil {
		t.Fatalf("Failed to create work dir: %v", err)
	}

	cfgMgr, _ := config.NewManager(tmpDir)
	fsSvc, _ := appfs.NewService(workDir)
	runner := plugin.NewRunner()
	pMgr, _ := plugin.NewManager(tmpDir, runner)
	auditLogger, _ := audit.NewLogger(tmpDir)
	secMgr, _ := secrets.NewManager(tmpDir)

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr)

	cleanup := func() {
		runner.Shutdown()
		_ = auditLogger.Close()
		_ = os.RemoveAll(tmpDir)
		_ = os.RemoveAll(workDir)
	}

	return srv, cleanup
}

func TestServerSSHGenerateKey(t *testing.T) {
	srv, cleanup := createTestServerWithSSH(t)
	defer cleanup()

	body, _ := json.Marshal(map[string]string{"comment": "test-key-endpoint"})
	req := httptest.NewRequest("POST", "/api/ssh/keys/generate?web=1", bytes.NewReader(body))
	req.Header.Set("X-ConfigStudio-Web", "1")
	w := httptest.NewRecorder()

	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK, got: %d (%s)", w.Code, w.Body.String())
	}

	var kp ssh.KeyPair
	if err := json.NewDecoder(w.Body).Decode(&kp); err != nil {
		t.Fatalf("Failed to decode KeyPair: %v", err)
	}

	if !strings.Contains(kp.PrivateKeyPEM, "BEGIN OPENSSH PRIVATE KEY") {
		t.Errorf("Expected OpenSSH PEM, got: %s", kp.PrivateKeyPEM)
	}
	if !strings.HasPrefix(kp.PublicKeyAuth, "ssh-ed25519 ") {
		t.Errorf("Expected ssh-ed25519 prefix, got: %s", kp.PublicKeyAuth)
	}
}

func TestServerSSHTestEndpoint(t *testing.T) {
	srv, cleanup := createTestServerWithSSH(t)
	defer cleanup()

	// Testing with unreachable host should return 200 OK with success=false in JSON
	cfg := ssh.Config{
		Host:       "127.0.0.1",
		Port:       54321, // non-listening port
		User:       "nobody",
		Password:   "nopass",
		TimeoutSec: 1,
	}

	body, _ := json.Marshal(cfg)
	req := httptest.NewRequest("POST", "/api/ssh/test?web=1", bytes.NewReader(body))
	req.Header.Set("X-ConfigStudio-Web", "1")
	w := httptest.NewRecorder()

	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK, got: %d", w.Code)
	}

	var res ssh.TestResult
	if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
		t.Fatalf("Failed to decode TestResult: %v", err)
	}

	if res.Success {
		t.Errorf("Expected connection to fail, but succeeded")
	}
	if res.Error == "" {
		t.Errorf("Expected error message, got empty string")
	}
}
