package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"config-studio/internal/config"
	appfs "config-studio/internal/fs"
	"config-studio/internal/plugin"
)

func setupTestServerForLogs(t *testing.T) (*Server, func()) {
	t.Helper()
	tempDir := t.TempDir()

	cfgMgr, err := config.NewManager(tempDir)
	if err != nil {
		t.Fatalf("failed to create config manager: %v", err)
	}

	fsSvc, err := appfs.NewService(tempDir)
	if err != nil {
		t.Fatalf("failed to create fs service: %v", err)
	}
	runner := plugin.NewRunner()
	pluginMgr, _ := plugin.NewManager(tempDir, runner)

	s := NewServer(Config{}, cfgMgr, fsSvc, pluginMgr, runner, nil, nil)

	return s, func() {}
}

func TestLogsStream_EmptyCmd(t *testing.T) {
	s, cleanup := setupTestServerForLogs(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/logs/stream", nil)
	req.Header.Set("X-ConfigStudio-Web", "1")
	rec := httptest.NewRecorder()

	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for empty cmd, got %d", rec.Code)
	}
}

func TestLogsStream_GET_Success(t *testing.T) {
	s, cleanup := setupTestServerForLogs(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/logs/stream?cmd=echo+hello_streaming_logs&source=tester", nil).WithContext(ctx)
	req.Header.Set("X-ConfigStudio-Web", "1")
	rec := httptest.NewRecorder()

	s.ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, "event: ready") {
		t.Errorf("expected 'event: ready' in stream, got:\n%s", body)
	}
	if !strings.Contains(body, "hello_streaming_logs") {
		t.Errorf("expected command output in stream, got:\n%s", body)
	}
	if !strings.Contains(body, "event: end") {
		t.Errorf("expected 'event: end' in stream, got:\n%s", body)
	}
}

func TestLogsStream_POST_Success(t *testing.T) {
	s, cleanup := setupTestServerForLogs(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	bodyJSON := `{"cmd":"echo post_stream_line","source":"post-test"}`
	req := httptest.NewRequest(http.MethodPost, "/api/logs/stream", strings.NewReader(bodyJSON)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ConfigStudio-Web", "1")
	rec := httptest.NewRecorder()

	s.ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, "post_stream_line") {
		t.Errorf("expected post command output in stream, got:\n%s", body)
	}
}
