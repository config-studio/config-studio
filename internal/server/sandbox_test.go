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
	"config-studio/internal/plugin"
	"config-studio/internal/sandbox"
	"config-studio/internal/secrets"
)

func TestServer_SandboxEvalEndpoint(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-server-sandbox-test-*")
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

	// 1. Success evaluation
	payload1 := sandbox.EvalRequest{
		Code: `
			console.log("Hello from sandbox");
			const servers = cs.servers.list();
			({ status: "ok", count: servers.length, node: servers[0].id });
		`,
	}
	body1, _ := json.Marshal(payload1)
	req1 := httptest.NewRequest("POST", "/api/sandbox/eval", bytes.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("X-ConfigStudio-Web", "1")
	rec1 := httptest.NewRecorder()
	srv.ServeHTTP(rec1, req1)

	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 on POST /api/sandbox/eval, got %d: %s", rec1.Code, rec1.Body.String())
	}

	var res1 sandbox.EvalResult
	if err := json.Unmarshal(rec1.Body.Bytes(), &res1); err != nil {
		t.Fatalf("failed to unmarshal eval result: %v", err)
	}
	if !res1.Success {
		t.Fatalf("expected eval success, got error: %s", res1.Error)
	}
	if len(res1.Logs) != 1 || !strings.Contains(res1.Logs[0], "Hello from sandbox") {
		t.Errorf("unexpected logs: %+v", res1.Logs)
	}

	valMap, ok := res1.Value.(map[string]any)
	if !ok {
		t.Fatalf("expected value to be map, got %T: %v", res1.Value, res1.Value)
	}
	if valMap["node"] != "localhost" {
		t.Errorf("expected node to be localhost, got %v", valMap["node"])
	}

	// 2. Syntax / runtime error evaluation
	payload2 := sandbox.EvalRequest{
		Code: `unknownVariable.triggerError()`,
	}
	body2, _ := json.Marshal(payload2)
	req2 := httptest.NewRequest("POST", "/api/sandbox/eval", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-ConfigStudio-Web", "1")
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 with error payload, got %d", rec2.Code)
	}
	var res2 sandbox.EvalResult
	_ = json.Unmarshal(rec2.Body.Bytes(), &res2)
	if res2.Success {
		t.Errorf("expected script to fail with ReferenceError")
	}
	if !strings.Contains(res2.Error, "ReferenceError") {
		t.Errorf("expected ReferenceError in result error, got: %s", res2.Error)
	}

	// 3. Timeout evaluation
	payload3 := sandbox.EvalRequest{
		Code:      `while(true) {}`,
		TimeoutMs: 50,
	}
	body3, _ := json.Marshal(payload3)
	req3 := httptest.NewRequest("POST", "/api/sandbox/eval", bytes.NewReader(body3))
	req3.Header.Set("Content-Type", "application/json")
	req3.Header.Set("X-ConfigStudio-Web", "1")
	rec3 := httptest.NewRecorder()
	srv.ServeHTTP(rec3, req3)

	var res3 sandbox.EvalResult
	_ = json.Unmarshal(rec3.Body.Bytes(), &res3)
	if res3.Success {
		t.Errorf("expected timeout failure")
	}
	if !strings.Contains(res3.Error, "timeout") {
		t.Errorf("expected timeout error message, got: %s", res3.Error)
	}

	// 4. Oversized payload rejected by MaxBytesReader (> 2MB)
	hugeCode := strings.Repeat("// filler\n", 250000) // ~2.2 MB
	payloadHuge := sandbox.EvalRequest{
		Code: hugeCode + "1 + 1;",
	}
	bodyHuge, _ := json.Marshal(payloadHuge)
	reqHuge := httptest.NewRequest("POST", "/api/sandbox/eval", bytes.NewReader(bodyHuge))
	reqHuge.Header.Set("Content-Type", "application/json")
	reqHuge.Header.Set("X-ConfigStudio-Web", "1")
	recHuge := httptest.NewRecorder()
	srv.ServeHTTP(recHuge, reqHuge)

	if recHuge.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for payload exceeding 2MB, got %d: %s", recHuge.Code, recHuge.Body.String())
	}

	// 5. Audit log check
	events := auditLogger.Query(audit.QueryFilter{Action: "sandbox.eval"})
	if len(events.Events) == 0 {
		t.Errorf("expected audit events for sandbox.eval, got 0")
	}
}
