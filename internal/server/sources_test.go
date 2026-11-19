package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	appfs "config-studio/internal/fs"
	"config-studio/internal/plugin"
	"config-studio/internal/secrets"
)

func TestServerSourcesAndCatalog(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-server-sources-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	cfgMgr, err := config.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create config manager: %v", err)
	}

	workDir, err := os.MkdirTemp("", "cs-workdir-*")
	if err != nil {
		t.Fatalf("failed to create work dir: %v", err)
	}
	defer os.RemoveAll(workDir)

	fsSvc, err := appfs.NewService(workDir)
	if err != nil {
		t.Fatalf("failed to create fs service: %v", err)
	}

	runner := plugin.NewRunner()
	defer runner.Shutdown()

	pMgr, err := plugin.NewManager(tmpDir, runner)
	if err != nil {
		t.Fatalf("failed to create plugin manager: %v", err)
	}

	auditLogger, err := audit.NewLogger(tmpDir)
	if err != nil {
		t.Fatalf("failed to create audit logger: %v", err)
	}
	defer auditLogger.Close()

	secMgr, err := secrets.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create secrets manager: %v", err)
	}

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr)

	// 1. GET /api/plugins/catalog
	reqCat := httptest.NewRequest("GET", "/api/plugins/catalog", nil)
	reqCat.Header.Set("X-ConfigStudio-Web", "1")
	recCat := httptest.NewRecorder()
	srv.ServeHTTP(recCat, reqCat)

	if recCat.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/plugins/catalog, got %d: %s", recCat.Code, recCat.Body.String())
	}

	var catResp struct {
		Catalog []plugin.CatalogItem `json:"catalog"`
	}
	if err := json.Unmarshal(recCat.Body.Bytes(), &catResp); err != nil {
		t.Fatalf("failed to unmarshal catalog response: %v", err)
	}

	// 2. GET /api/plugins/catalog?refresh=1
	reqRefresh := httptest.NewRequest("GET", "/api/plugins/catalog?refresh=1", nil)
	reqRefresh.Header.Set("X-ConfigStudio-Web", "1")
	recRefresh := httptest.NewRecorder()
	srv.ServeHTTP(recRefresh, reqRefresh)

	if recRefresh.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/plugins/catalog?refresh=1, got %d: %s", recRefresh.Code, recRefresh.Body.String())
	}

	// 3. POST /api/plugins/sources/sync
	reqSync := httptest.NewRequest("POST", "/api/plugins/sources/sync", nil)
	reqSync.Header.Set("X-ConfigStudio-Web", "1")
	recSync := httptest.NewRecorder()
	srv.ServeHTTP(recSync, reqSync)

	if recSync.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/plugins/sources/sync, got %d: %s", recSync.Code, recSync.Body.String())
	}

	var syncResp struct {
		Status  string               `json:"status"`
		Items   []plugin.CatalogItem `json:"items"`
		Sources []plugin.Source      `json:"sources"`
	}
	if err := json.Unmarshal(recSync.Body.Bytes(), &syncResp); err != nil {
		t.Fatalf("failed to unmarshal sync response: %v", err)
	}
	if syncResp.Status != "ok" {
		t.Errorf("expected status 'ok', got %q", syncResp.Status)
	}
}
