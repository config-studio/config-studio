package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
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

func makeTestPluginZip(id, name, author string, permissions []string) []byte {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	permsJSON, _ := json.Marshal(permissions)
	manifest := `{
		"id": "` + id + `",
		"name": "` + name + `",
		"version": "1.0.0",
		"author": "` + author + `",
		"entry": "main.js",
		"permissions": ` + string(permsJSON) + `
	}`

	w, _ := zw.Create("plugin.json")
	_, _ = w.Write([]byte(manifest))

	w2, _ := zw.Create("main.js")
	_, _ = w2.Write([]byte("console.log('test');"))

	_ = zw.Close()
	return buf.Bytes()
}

func TestServerPluginInspectAndConfirm(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-server-plugin-test-*")
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

	// 1. Inspect Upload
	zipBytes := makeTestPluginZip("ui-only-plugin", "UI Only Plugin", "Community", []string{"ui.panels"})
	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("plugin", "plugin.zip")
	_, _ = part.Write(zipBytes)
	_ = writer.Close()

	reqInspect := httptest.NewRequest("POST", "/api/plugins/inspect/upload", body)
	reqInspect.Header.Set("Content-Type", writer.FormDataContentType())
	reqInspect.Header.Set("X-ConfigStudio-Web", "1")
	recInspect := httptest.NewRecorder()
	srv.ServeHTTP(recInspect, reqInspect)

	if recInspect.Code != http.StatusOK {
		t.Fatalf("expected 200 on inspect, got %d: %s", recInspect.Code, recInspect.Body.String())
	}

	var inspectResp struct {
		Status  string                `json:"status"`
		Pending plugin.PendingInstall `json:"pending"`
	}
	if err := json.Unmarshal(recInspect.Body.Bytes(), &inspectResp); err != nil {
		t.Fatalf("failed to parse inspect response: %v", err)
	}

	if inspectResp.Pending.TempKey == "" {
		t.Fatalf("expected non-empty tempKey")
	}
	if inspectResp.Pending.Manifest.ID != "ui-only-plugin" {
		t.Fatalf("expected id 'ui-only-plugin', got %s", inspectResp.Pending.Manifest.ID)
	}

	// 2. Confirm Install
	confirmBody, _ := json.Marshal(map[string]string{"tempKey": inspectResp.Pending.TempKey})
	reqConfirm := httptest.NewRequest("POST", "/api/plugins/install/confirm", bytes.NewReader(confirmBody))
	reqConfirm.Header.Set("X-ConfigStudio-Web", "1")
	recConfirm := httptest.NewRecorder()
	srv.ServeHTTP(recConfirm, reqConfirm)

	if recConfirm.Code != http.StatusOK {
		t.Fatalf("expected 200 on confirm, got %d: %s", recConfirm.Code, recConfirm.Body.String())
	}

	// 3. Verify Capability Enforcement: ui-only-plugin lacks 'shell.exec'
	execBody, _ := json.Marshal(map[string]any{
		"pluginId": "ui-only-plugin",
		"command":  "echo",
		"args":     []string{"hello"},
	})
	reqExec := httptest.NewRequest("POST", "/api/plugins/exec", bytes.NewReader(execBody))
	reqExec.Header.Set("X-ConfigStudio-Web", "1")
	recExec := httptest.NewRecorder()
	srv.ServeHTTP(recExec, reqExec)

	if recExec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for plugin without shell.exec capability, got %d: %s", recExec.Code, recExec.Body.String())
	}

	// 4. Verify Bypass Protection: empty or "core" plugin ID is rejected when unrestricted mode is false
	coreExecBody, _ := json.Marshal(map[string]any{
		"pluginId": "core",
		"command":  "echo",
		"args":     []string{"bypass"},
	})
	reqCore := httptest.NewRequest("POST", "/api/plugins/exec", bytes.NewReader(coreExecBody))
	reqCore.Header.Set("X-ConfigStudio-Web", "1")
	recCore := httptest.NewRecorder()
	srv.ServeHTTP(recCore, reqCore)
	if recCore.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when attempting 'core' plugin bypass, got %d", recCore.Code)
	}

	emptyExecBody, _ := json.Marshal(map[string]any{
		"pluginId": "",
		"command":  "echo",
		"args":     []string{"bypass"},
	})
	reqEmpty := httptest.NewRequest("POST", "/api/plugins/exec", bytes.NewReader(emptyExecBody))
	reqEmpty.Header.Set("X-ConfigStudio-Web", "1")
	recEmpty := httptest.NewRecorder()
	srv.ServeHTTP(recEmpty, reqEmpty)
	if recEmpty.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when attempting empty plugin bypass, got %d", recEmpty.Code)
	}
}

func TestStartPluginProcess_CoreBypassForbidden(t *testing.T) {
	tempDir := t.TempDir()
	cfgMgr, err := config.NewManager(tempDir)
	if err != nil {
		t.Fatalf("failed to create config manager: %v", err)
	}
	fsSvc, _ := appfs.NewService(tempDir)
	runner := plugin.NewRunner()
	pluginMgr, _ := plugin.NewManager(tempDir, runner)
	srv := NewServer(Config{}, cfgMgr, fsSvc, pluginMgr, runner, nil, nil)

	// Mode is restricted by default. Attempting to start background process with "core" or "" must be 403.
	cases := []string{"core", ""}
	for _, pid := range cases {
		body, _ := json.Marshal(map[string]any{
			"pluginId": pid,
			"command":  "echo",
			"args":     []string{"background_bypass"},
		})
		req := httptest.NewRequest("POST", "/api/plugin-processes/start", bytes.NewReader(body))
		req.Header.Set("X-ConfigStudio-Web", "1")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for pluginId %q, got %d: %s", pid, rec.Code, rec.Body.String())
		}
	}
}
