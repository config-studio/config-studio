package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"config-studio/internal/config"
	appfs "config-studio/internal/fs"
	"config-studio/internal/plugin"
)

func TestFSBatchReadEndpoint(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-srv-batch-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dataDir := filepath.Join(tmpDir, "data")
	defaultDir := filepath.Join(tmpDir, "configs")
	_ = os.MkdirAll(filepath.Join(defaultDir, "rules"), 0755)
	_ = os.WriteFile(filepath.Join(defaultDir, "rules", "mw-auth.yml"), []byte("auth: middleware"), 0644)
	_ = os.WriteFile(filepath.Join(defaultDir, "rules", "routers.yml"), []byte("routers: main"), 0644)

	cfgMgr, err := config.NewManager(dataDir)
	if err != nil {
		t.Fatalf("failed to init config manager: %v", err)
	}
	wm, err := appfs.NewWorkspaceManager(dataDir, defaultDir)
	if err != nil {
		t.Fatalf("failed to init workspace manager: %v", err)
	}
	fsSvc, err := appfs.NewServiceWithManager(wm)
	if err != nil {
		t.Fatalf("failed to init fs service: %v", err)
	}
	runner := plugin.NewRunner()
	pluginMgr, _ := plugin.NewManager(dataDir, runner)
	srv := NewServer(Config{}, cfgMgr, fsSvc, pluginMgr, runner, nil, nil)
	handler := srv.handler

	// 1. Test POST /api/fs/batch-read with pattern
	reqBody, _ := json.Marshal(map[string]any{
		"pattern": "rules/*.yml",
	})
	req := httptest.NewRequest("POST", "/api/fs/batch-read", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ConfigStudio-Web", "1")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var res struct {
		Files map[string]string `json:"files"`
		Count int               `json:"count"`
	}
	if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if res.Count != 2 || len(res.Files) != 2 {
		t.Fatalf("expected 2 files, got count=%d, files=%v", res.Count, res.Files)
	}
	if res.Files["rules/mw-auth.yml"] != "auth: middleware" {
		t.Errorf("unexpected content: %s", res.Files["rules/mw-auth.yml"])
	}

	// 2. Test explicit paths
	pathsBody, _ := json.Marshal(map[string]any{
		"paths": []string{"rules/routers.yml"},
	})
	req = httptest.NewRequest("POST", "/api/fs/batch-read", bytes.NewReader(pathsBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ConfigStudio-Web", "1")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}
	var pathsRes struct {
		Files map[string]string `json:"files"`
		Count int               `json:"count"`
	}
	_ = json.NewDecoder(w.Body).Decode(&pathsRes)
	if pathsRes.Count != 1 || pathsRes.Files["rules/routers.yml"] != "routers: main" {
		t.Errorf("unexpected paths result: %v", pathsRes)
	}
}
