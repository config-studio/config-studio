package fleet

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
)

func TestBatchInstallAgents_ValidationAndSkipping(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-batch-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	m, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to initialize fleet manager: %v", err)
	}

	// 1. Test Empty Targets (only localhost in inventory)
	ctx := context.Background()
	res, err := m.BatchInstallAgents(ctx, BatchInstallOptions{}, nil, nil, nil)
	if err != nil {
		t.Fatalf("expected no error for empty targets, got %v", err)
	}
	if res.Total != 0 {
		t.Errorf("expected 0 total targets, got %d", res.Total)
	}

	// 2. Mock a Healthy Agent Server
	healthyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer healthyServer.Close()

	// Add Server A: Already healthy
	srvA := ServerNode{
		ID:   "srv-healthy",
		Name: "Healthy Node",
		Connection: ConnectionConfig{
			SSH: &SSHConnectionConfig{
				Enabled: true,
				Host:    "192.168.1.50",
			},
			Agent: &AgentConnectionConfig{
				Enabled: true,
				URL:     healthyServer.URL,
			},
		},
	}
	_ = m.AddOrUpdateServer(srvA)

	// Add Server B: SSH disabled
	srvB := ServerNode{
		ID:   "srv-no-ssh",
		Name: "No SSH Node",
		Connection: ConnectionConfig{
			SSH: &SSHConnectionConfig{
				Enabled: false,
			},
		},
	}
	_ = m.AddOrUpdateServer(srvB)

	var progressMu sync.Mutex
	progressEvents := make([]BatchHostStatus, 0)
	onProgress := func(st BatchHostStatus) {
		progressMu.Lock()
		defer progressMu.Unlock()
		progressEvents = append(progressEvents, st)
	}

	// Run BatchInstall with SkipHealthy: true
	opts := BatchInstallOptions{
		ServerIDs:   []string{"srv-healthy", "srv-no-ssh"},
		Concurrency: 2,
		SkipHealthy: true,
	}

	result, err := m.BatchInstallAgents(ctx, opts, nil, nil, onProgress)
	if err != nil {
		t.Fatalf("BatchInstallAgents failed: %v", err)
	}

	if result.Total != 2 {
		t.Errorf("expected total 2, got %d", result.Total)
	}
	if result.Skipped != 1 {
		t.Errorf("expected 1 skipped (srv-healthy), got %d", result.Skipped)
	}
	if result.Failed != 1 {
		t.Errorf("expected 1 failed (srv-no-ssh), got %d", result.Failed)
	}

	// Verify statuses
	var foundHealthy, foundNoSSH bool
	for _, st := range result.Statuses {
		if st.ServerID == "srv-healthy" {
			foundHealthy = true
			if st.Status != "skipped" {
				t.Errorf("expected srv-healthy status 'skipped', got %q", st.Status)
			}
		}
		if st.ServerID == "srv-no-ssh" {
			foundNoSSH = true
			if st.Status != "error" {
				t.Errorf("expected srv-no-ssh status 'error', got %q", st.Status)
			}
		}
	}

	if !foundHealthy || !foundNoSSH {
		t.Errorf("did not find both statuses: healthy=%t, noSSH=%t", foundHealthy, foundNoSSH)
	}

	progressMu.Lock()
	numEvents := len(progressEvents)
	progressMu.Unlock()
	if numEvents == 0 {
		t.Errorf("expected progress events to be emitted, got 0")
	}
}

func TestBatchInstallAgents_DynamicHostResolverFallback(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-batch-dynamic-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	m, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to initialize fleet manager: %v", err)
	}

	// Configure HostResolver for core hosts that are NOT yet in servers.yaml
	m.SetHostResolver(func(id string) (*HostInfo, error) {
		if id == "core-host-1" {
			return &HostInfo{
				ID:   "core-host-1",
				Name: "Core Dynamic Node 1",
				Host: "192.168.0.101",
				Port: 22,
				User: "root",
			}, nil
		}
		return nil, os.ErrNotExist
	})

	ctx := context.Background()
	opts := BatchInstallOptions{
		ServerIDs: []string{"core-host-1"},
	}

	res, err := m.BatchInstallAgents(ctx, opts, nil, nil, nil)
	if err != nil {
		t.Fatalf("BatchInstallAgents failed: %v", err)
	}

	if res.Total != 1 {
		t.Fatalf("expected Total 1, got %d", res.Total)
	}
	if len(res.Statuses) != 1 {
		t.Fatalf("expected 1 status, got %d", len(res.Statuses))
	}
	if res.Statuses[0].ServerID != "core-host-1" {
		t.Errorf("expected ServerID 'core-host-1', got %q", res.Statuses[0].ServerID)
	}
	if res.Statuses[0].Host != "192.168.0.101" {
		t.Errorf("expected Host '192.168.0.101', got %q", res.Statuses[0].Host)
	}
}
