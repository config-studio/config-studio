package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"config-studio/internal/config"
	"config-studio/internal/hosts"
	"config-studio/internal/secrets"
)

func TestServer_HostsAPI(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs_server_hosts_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	secMgr, err := secrets.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager secrets failed: %v", err)
	}

	cfgMgr, err := config.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager config failed: %v", err)
	}

	hostsMgr, err := hosts.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager hosts failed: %v", err)
	}

	s := &Server{
		config:  cfgMgr,
		secrets: secMgr,
		hosts:   hostsMgr,
	}
	s.setupRoutes()

	// 1. GET /api/hosts (initial empty)
	req1 := httptest.NewRequest("GET", "/api/hosts", nil)
	req1.Header.Set("X-ConfigStudio-Web", "1")
	w1 := httptest.NewRecorder()
	s.ServeHTTP(w1, req1)

	if w1.Code != http.StatusOK {
		t.Fatalf("GET /api/hosts returned %d, body: %s", w1.Code, w1.Body.String())
	}

	// 2. POST /api/hosts (create new host)
	newHost := hosts.Host{
		ID:       "host-srv-1",
		Name:     "Alpine VM 1",
		Host:     "192.168.0.100",
		Port:     22,
		User:     "root",
		AuthType: hosts.AuthTypeVault,
		SecretID: "sec-ssh-1",
		Tags:     []string{"alpine", "production"},
	}
	payload, _ := json.Marshal(newHost)
	req2 := httptest.NewRequest("POST", "/api/hosts", bytes.NewReader(payload))
	req2.Header.Set("X-ConfigStudio-Web", "1")
	w2 := httptest.NewRecorder()
	s.ServeHTTP(w2, req2)

	if w2.Code != http.StatusCreated {
		t.Fatalf("POST /api/hosts returned %d, body: %s", w2.Code, w2.Body.String())
	}

	// 3. GET /api/hosts/{id}
	req3 := httptest.NewRequest("GET", "/api/hosts/host-srv-1", nil)
	req3.Header.Set("X-ConfigStudio-Web", "1")
	w3 := httptest.NewRecorder()
	s.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Fatalf("GET /api/hosts/host-srv-1 returned %d", w3.Code)
	}
	var fetched hosts.Host
	_ = json.Unmarshal(w3.Body.Bytes(), &fetched)
	if fetched.Name != "Alpine VM 1" || fetched.Host != "192.168.0.100" {
		t.Errorf("fetched host mismatch: %+v", fetched)
	}

	// 4. GET /api/hosts/export/openssh
	req4 := httptest.NewRequest("GET", "/api/hosts/export/openssh", nil)
	req4.Header.Set("X-ConfigStudio-Web", "1")
	w4 := httptest.NewRecorder()
	s.ServeHTTP(w4, req4)

	if w4.Code != http.StatusOK {
		t.Fatalf("GET /api/hosts/export/openssh returned %d", w4.Code)
	}
	sshConfigText := w4.Body.String()
	if !strings.Contains(sshConfigText, "Host host-srv-1") || !strings.Contains(sshConfigText, "HostName 192.168.0.100") {
		t.Errorf("export missing host data:\n%s", sshConfigText)
	}

	// 5. POST /api/hosts/import/openssh
	importBody := `Host debian-vps
    HostName 10.20.30.40
    User admin
    Port 2222
`
	req5 := httptest.NewRequest("POST", "/api/hosts/import/openssh", strings.NewReader(importBody))
	req5.Header.Set("Content-Type", "text/plain")
	req5.Header.Set("X-ConfigStudio-Web", "1")
	w5 := httptest.NewRecorder()
	s.ServeHTTP(w5, req5)

	if w5.Code != http.StatusOK {
		t.Fatalf("POST /api/hosts/import/openssh returned %d, body: %s", w5.Code, w5.Body.String())
	}

	var importRes hosts.OpenSSHImportResult
	_ = json.Unmarshal(w5.Body.Bytes(), &importRes)
	if importRes.Imported != 1 {
		t.Errorf("expected 1 imported host, got: %+v", importRes)
	}

	// Verify imported host exists
	req6 := httptest.NewRequest("GET", "/api/hosts/debian-vps", nil)
	req6.Header.Set("X-ConfigStudio-Web", "1")
	w6 := httptest.NewRecorder()
	s.ServeHTTP(w6, req6)
	if w6.Code != http.StatusOK {
		t.Fatalf("failed to find imported debian-vps host")
	}

	// 6. DELETE /api/hosts/{id}
	req7 := httptest.NewRequest("DELETE", "/api/hosts/host-srv-1", nil)
	req7.Header.Set("X-ConfigStudio-Web", "1")
	w7 := httptest.NewRecorder()
	s.ServeHTTP(w7, req7)
	if w7.Code != http.StatusOK {
		t.Fatalf("DELETE /api/hosts/host-srv-1 returned %d", w7.Code)
	}
}

func TestServer_PortableSecretsAPI(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs_server_portable_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	secMgr, err := secrets.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager secrets failed: %v", err)
	}

	_ = secMgr.Set(secrets.SecretItem{
		SecretMeta: secrets.SecretMeta{
			ID:    "sec-test-1",
			Title: "Test Secret",
			Type:  secrets.TypePassword,
			Scope: secrets.ScopeShared,
		},
		Value: "SecretPassword123",
	})

	cfgMgr, _ := config.NewManager(tmpDir)
	s := &Server{
		config:  cfgMgr,
		secrets: secMgr,
	}
	s.setupRoutes()

	// 1. Export Portable Secrets
	exportReq := map[string]string{"passphrase": "MyExportPassword123"}
	body, _ := json.Marshal(exportReq)
	req1 := httptest.NewRequest("POST", "/api/secrets/export-portable", bytes.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("X-ConfigStudio-Web", "1")
	w1 := httptest.NewRecorder()
	s.ServeHTTP(w1, req1)

	if w1.Code != http.StatusOK {
		t.Fatalf("export returned %d: %s", w1.Code, w1.Body.String())
	}
	bundleBytes := w1.Body.Bytes()

	// 2. Import into a new instance
	tmpDir2, _ := os.MkdirTemp("", "cs_server_portable_dst_*")
	defer os.RemoveAll(tmpDir2)

	secMgr2, _ := secrets.NewManager(tmpDir2)
	cfgMgr2, _ := config.NewManager(tmpDir2)
	s2 := &Server{
		config:  cfgMgr2,
		secrets: secMgr2,
	}
	s2.setupRoutes()

	req2 := httptest.NewRequest("POST", "/api/secrets/import-portable", bytes.NewReader(bundleBytes))
	req2.Header.Set("Content-Type", "application/octet-stream")
	req2.Header.Set("X-Passphrase", "MyExportPassword123")
	req2.Header.Set("X-ConfigStudio-Web", "1")
	w2 := httptest.NewRecorder()
	s2.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("import returned %d: %s", w2.Code, w2.Body.String())
	}

	val, err := secMgr2.Get("sec-test-1")
	if err != nil || val != "SecretPassword123" {
		t.Errorf("imported value mismatch: val=%s, err=%v", val, err)
	}
}
