package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	"config-studio/internal/fleet"
	appfs "config-studio/internal/fs"
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
}
