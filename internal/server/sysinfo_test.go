package server

import (
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
	"config-studio/internal/sysinfo"
)

func TestHandleSysInfoLocal(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-sysinfo-test-*")
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

	req := httptest.NewRequest(http.MethodGet, "/api/sysinfo", nil)
	req.Header.Set("X-ConfigStudio-Web", "1")
	w := httptest.NewRecorder()
	srv.handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var metrics sysinfo.SystemMetrics
	if err := json.NewDecoder(w.Body).Decode(&metrics); err != nil {
		t.Fatalf("failed to parse JSON response: %v", err)
	}

	if metrics.Hostname == "" {
		t.Errorf("expected non-empty hostname")
	}
	if metrics.NumCPU <= 0 {
		t.Errorf("expected NumCPU > 0, got %d", metrics.NumCPU)
	}
	if metrics.Memory.TotalBytes == 0 {
		t.Errorf("expected non-zero Memory.TotalBytes")
	}
}
