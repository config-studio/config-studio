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
	"config-studio/internal/fleet"
	appfs "config-studio/internal/fs"
	"config-studio/internal/hosts"
	"config-studio/internal/plugin"
	"config-studio/internal/secrets"
)

func TestFleetServerEndpoints(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	cfgMgr, _ := config.NewManager(tmpDir)
	wsMgr, _ := appfs.NewWorkspaceManager(tmpDir, tmpDir)
	fsSvc, _ := appfs.NewServiceWithManager(wsMgr)
	runner := plugin.NewRunner()
	pMgr, _ := plugin.NewManager(tmpDir, runner)
	auditLogger, _ := audit.NewLogger(tmpDir)
	secMgr, _ := secrets.NewManager(tmpDir)
	fleetMgr, _ := fleet.NewManager(tmpDir)

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr, fleetMgr)

	// 1. GET /api/servers (should return localhost by default)
	req := httptest.NewRequest("GET", "/api/servers", nil)
	req.Header.Set("X-ConfigStudio-Web", "1")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on GET /api/servers, got %d: %s", rec.Code, rec.Body.String())
	}

	var listRes struct {
		Servers []fleet.ServerNode `json:"servers"`
		Count   int                `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listRes); err != nil {
		t.Fatalf("failed to unmarshal servers response: %v", err)
	}
	if listRes.Count != 1 || listRes.Servers[0].ID != "localhost" {
		t.Fatalf("expected 1 localhost server, got: %+v", listRes.Servers)
	}

	// 2. POST /api/servers (Add new server)
	newNode := fleet.ServerNode{
		ID:    "prod-web-01",
		Name:  "Production Web 01",
		Group: "production/frontend",
		Tags:  []string{"prod", "web"},
		Connection: fleet.ConnectionConfig{
			SSH: &fleet.SSHConnectionConfig{
				Enabled: true,
				Host:    "10.0.1.10",
				Port:    22,
				User:    "root",
			},
			Agent: &fleet.AgentConnectionConfig{
				Enabled: true,
				URL:     "http://10.0.1.10:8080",
			},
		},
	}
	body, _ := json.Marshal(newNode)
	reqAdd := httptest.NewRequest("POST", "/api/servers", bytes.NewReader(body))
	reqAdd.Header.Set("Content-Type", "application/json")
	reqAdd.Header.Set("X-ConfigStudio-Web", "1")
	recAdd := httptest.NewRecorder()
	srv.ServeHTTP(recAdd, reqAdd)

	if recAdd.Code != http.StatusOK {
		t.Fatalf("expected 200 on POST /api/servers, got %d: %s", recAdd.Code, recAdd.Body.String())
	}

	// 3. GET /api/servers (Verify count is 2)
	req2 := httptest.NewRequest("GET", "/api/servers", nil)
	req2.Header.Set("X-ConfigStudio-Web", "1")
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req2)
	_ = json.Unmarshal(rec2.Body.Bytes(), &listRes)
	if listRes.Count != 2 {
		t.Fatalf("expected 2 servers after add, got %d", listRes.Count)
	}

	// 4. GET /api/servers/raw
	reqRaw := httptest.NewRequest("GET", "/api/servers/raw", nil)
	reqRaw.Header.Set("X-ConfigStudio-Web", "1")
	recRaw := httptest.NewRecorder()
	srv.ServeHTTP(recRaw, reqRaw)
	if recRaw.Code != http.StatusOK {
		t.Fatalf("expected 200 on GET /api/servers/raw, got %d", recRaw.Code)
	}
	if !bytes.Contains(recRaw.Body.Bytes(), []byte("prod-web-01")) {
		t.Fatalf("expected raw YAML to contain 'prod-web-01', got: %s", recRaw.Body.String())
	}

	// 5. DELETE /api/servers/prod-web-01
	reqDel := httptest.NewRequest("DELETE", "/api/servers/prod-web-01", nil)
	reqDel.Header.Set("X-ConfigStudio-Web", "1")
	recDel := httptest.NewRecorder()
	srv.ServeHTTP(recDel, reqDel)
	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 on DELETE /api/servers/prod-web-01, got %d: %s", recDel.Code, recDel.Body.String())
	}

	// 6. DELETE localhost (Should fail with 400)
	reqDelLocal := httptest.NewRequest("DELETE", "/api/servers/localhost", nil)
	reqDelLocal.Header.Set("X-ConfigStudio-Web", "1")
	recDelLocal := httptest.NewRecorder()
	srv.ServeHTTP(recDelLocal, reqDelLocal)
	if recDelLocal.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on deleting localhost, got %d", recDelLocal.Code)
	}

	// 7. POST /api/servers/install-agent/localhost (Should fail because localhost cannot be remote-installed)
	reqInstall := httptest.NewRequest("POST", "/api/servers/install-agent/localhost", bytes.NewReader([]byte(`{"port":9090}`)))
	reqInstall.Header.Set("Content-Type", "application/json")
	reqInstall.Header.Set("X-ConfigStudio-Web", "1")
	recInstall := httptest.NewRecorder()
	srv.ServeHTTP(recInstall, reqInstall)
	if recInstall.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 when installing agent on localhost, got %d", recInstall.Code)
	}

	// 8. POST /api/servers/batch-install (Empty targets test)
	reqBatch := httptest.NewRequest("POST", "/api/servers/batch-install", bytes.NewReader([]byte(`{"serverIds":[]}`)))
	reqBatch.Header.Set("Content-Type", "application/json")
	reqBatch.Header.Set("X-ConfigStudio-Web", "1")
	recBatch := httptest.NewRecorder()
	srv.ServeHTTP(recBatch, reqBatch)
	if recBatch.Code != http.StatusOK {
		t.Fatalf("expected 200 for empty batch install, got %d: %s", recBatch.Code, recBatch.Body.String())
	}
	var batchRes fleet.BatchInstallResult
	if err := json.Unmarshal(recBatch.Body.Bytes(), &batchRes); err != nil {
		t.Fatalf("failed to decode batch install result: %v", err)
	}
	if batchRes.Total != 0 {
		t.Errorf("expected 0 total, got %d", batchRes.Total)
	}

	// 9. POST /api/servers/batch-install with SSE stream
	reqBatchSSE := httptest.NewRequest("POST", "/api/servers/batch-install?stream=true", bytes.NewReader([]byte(`{"serverIds":[]}`)))
	reqBatchSSE.Header.Set("Content-Type", "application/json")
	reqBatchSSE.Header.Set("Accept", "text/event-stream")
	reqBatchSSE.Header.Set("X-ConfigStudio-Web", "1")
	recBatchSSE := httptest.NewRecorder()
	srv.ServeHTTP(recBatchSSE, reqBatchSSE)
	if recBatchSSE.Code != http.StatusOK {
		t.Fatalf("expected 200 for SSE batch install, got %d", recBatchSSE.Code)
	}
	if !strings.Contains(recBatchSSE.Body.String(), "event: done") {
		t.Errorf("expected SSE event: done, got: %s", recBatchSSE.Body.String())
	}

	// 10. GET /api/servers/batch-install/stream with query params
	reqBatchGetSSE := httptest.NewRequest("GET", "/api/servers/batch-install/stream?ids=none&skipHealthy=true", nil)
	reqBatchGetSSE.Header.Set("X-ConfigStudio-Web", "1")
	recBatchGetSSE := httptest.NewRecorder()
	srv.ServeHTTP(recBatchGetSSE, reqBatchGetSSE)
	if recBatchGetSSE.Code != http.StatusOK {
		t.Fatalf("expected 200 for GET SSE batch install, got %d", recBatchGetSSE.Code)
	}
	if !strings.Contains(recBatchGetSSE.Body.String(), "event: done") {
		t.Errorf("expected SSE event: done for GET, got: %s", recBatchGetSSE.Body.String())
	}
}

func TestDeleteServer_PreservesSSHHost(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-del-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	cfgMgr, _ := config.NewManager(tmpDir)
	wsMgr, _ := appfs.NewWorkspaceManager(tmpDir, tmpDir)
	fsSvc, _ := appfs.NewServiceWithManager(wsMgr)
	runner := plugin.NewRunner()
	pMgr, _ := plugin.NewManager(tmpDir, runner)
	auditLogger, _ := audit.NewLogger(tmpDir)
	secMgr, _ := secrets.NewManager(tmpDir)
	fleetMgr, _ := fleet.NewManager(tmpDir)

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr, fleetMgr)

	// Create an SSH host in Core Hosts database
	hostID := "host-production-vps"
	_, err = srv.hosts.Save(&hosts.Host{
		ID:   hostID,
		Name: "Production VPS",
		Host: "192.168.0.50",
		Port: 22,
		User: "root",
	})
	if err != nil {
		t.Fatalf("failed to save SSH host: %v", err)
	}

	// Add node to fleet with same ID or linked to that host
	err = fleetMgr.AddOrUpdateServer(fleet.ServerNode{
		ID:         hostID,
		Name:       "Production VPS Fleet Node",
		SSHHostRef: hostID,
	})
	if err != nil {
		t.Fatalf("failed to add server to fleet: %v", err)
	}

	// Now delete server from fleet via DELETE /api/servers/{id}
	reqDel := httptest.NewRequest("DELETE", "/api/servers/"+hostID, nil)
	reqDel.Header.Set("X-ConfigStudio-Web", "1")
	recDel := httptest.NewRecorder()
	srv.ServeHTTP(recDel, reqDel)
	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 on DELETE /api/servers, got %d: %s", recDel.Code, recDel.Body.String())
	}

	// Verify server node is deleted from servers.yaml
	raw, err := fleetMgr.GetRawYAML()
	if err != nil {
		t.Fatalf("failed to read raw servers.yaml: %v", err)
	}
	if strings.Contains(raw, hostID) {
		t.Errorf("expected server %q to be deleted from servers.yaml, got raw: %s", hostID, raw)
	}

	// CRITICAL: Verify SSH host STILL EXISTS in Core Hosts!
	sshHost, err := srv.hosts.Get(hostID)
	if err != nil || sshHost == nil {
		t.Fatalf("CRITICAL REGRESSION: SSH host was deleted from hosts.json when deleting server from fleet!")
	}
	if sshHost.Host != "192.168.0.50" {
		t.Errorf("expected SSH host IP 192.168.0.50, got %s", sshHost.Host)
	}
}
