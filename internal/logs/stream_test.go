package logs

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStreamSSE_LocalCommand(t *testing.T) {
	service := NewStreamService()
	rec := httptest.NewRecorder()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := "echo Line1 && echo Line2"
	opts := &StreamOptions{
		Source: "test-app",
		Cmd:    cmd,
	}

	err := service.StreamSSE(ctx, rec, nil, nil, opts)
	if err != nil {
		t.Fatalf("StreamSSE returned error: %v", err)
	}

	body := rec.Body.String()

	if !strings.Contains(body, "event: ready") {
		t.Errorf("expected 'event: ready' in response, got:\n%s", body)
	}
	if !strings.Contains(body, "event: log") {
		t.Errorf("expected 'event: log' in response, got:\n%s", body)
	}
	if !strings.Contains(body, "Line1") || !strings.Contains(body, "Line2") {
		t.Errorf("expected output lines in response, got:\n%s", body)
	}
	if !strings.Contains(body, "event: end") {
		t.Errorf("expected 'event: end' in response, got:\n%s", body)
	}
}

func TestStreamSSE_ContextCancellation(t *testing.T) {
	service := NewStreamService()
	rec := httptest.NewRecorder()

	ctx, cancel := context.WithCancel(context.Background())

	// Command that would sleep longer
	opts := &StreamOptions{
		Source: "sleep-app",
		Cmd:    "echo Started && ping -n 5 127.0.0.1 >nul 2>&1 || sleep 5",
	}

	// Cancel context after 300ms
	go func() {
		time.Sleep(300 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_ = service.StreamSSE(ctx, rec, nil, nil, opts)
	duration := time.Since(start)

	if duration > 3*time.Second {
		t.Errorf("stream should have been cancelled quickly, but took %v", duration)
	}
}
