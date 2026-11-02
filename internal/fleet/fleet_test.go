package fleet

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFleetManager_Lifecycle(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// 1. Initialize fleet manager
	m, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to initialize fleet manager: %v", err)
	}

	// Verify default localhost node was created
	servers := m.ListServers()
	if len(servers) != 1 {
		t.Fatalf("expected 1 server (localhost), got %d", len(servers))
	}
	if servers[0].ID != "localhost" {
		t.Errorf("expected server ID 'localhost', got %q", servers[0].ID)
	}

	// 2. Add a new hybrid server
	srv1 := ServerNode{
		ID:          "prod-web-01",
		Name:        "Production Ingress 01",
		Group:       "Production / Frontend",
		Tags:        []string{"prod", "web", "nginx"},
		Icon:        "nginx",
		Connection: ConnectionConfig{
			SSH: &SSHConnectionConfig{
				Enabled:  true,
				Host:     "10.0.1.10",
				Port:     22,
				User:     "deploy",
				Identity: "vault:ssh-key",
			},
			Agent: &AgentConnectionConfig{
				Enabled:     true,
				URL:         "http://10.0.1.10:8085",
				VaultSecret: "vault:agent-key",
			},
		},
		Rollout: &RolloutConfig{
			Canary: true,
			Order:  1,
			Hooks: RolloutHooks{
				PreApply: "nginx -t",
			},
		},
	}

	if err := m.AddOrUpdateServer(srv1); err != nil {
		t.Fatalf("failed to add server: %v", err)
	}

	// Verify server was added
	servers = m.ListServers()
	if len(servers) != 2 {
		t.Fatalf("expected 2 servers, got %d", len(servers))
	}

	got, err := m.GetServer("prod-web-01")
	if err != nil {
		t.Fatalf("failed to get server: %v", err)
	}
	if got.Name != "Production Ingress 01" {
		t.Errorf("expected name 'Production Ingress 01', got %q", got.Name)
	}
	if got.Rollout == nil || !got.Rollout.Canary {
		t.Errorf("expected canary=true")
	}

	// 3. Update server
	got.Name = "Updated Ingress"
	if err := m.AddOrUpdateServer(*got); err != nil {
		t.Fatalf("failed to update server: %v", err)
	}
	updated, _ := m.GetServer("prod-web-01")
	if updated.Name != "Updated Ingress" {
		t.Errorf("expected updated name, got %q", updated.Name)
	}

	// 4. Raw YAML operations
	raw, err := m.GetRawYAML()
	if err != nil {
		t.Fatalf("failed to get raw YAML: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("expected non-empty raw YAML")
	}

	customYAML := `version: "1"
servers:
  - id: custom-node
    name: Custom Node
    host: 192.168.1.50
    user: root
`
	if err := m.SetRawYAML(customYAML); err != nil {
		t.Fatalf("failed to set raw YAML: %v", err)
	}

	servers = m.ListServers()
	if len(servers) != 1 || servers[0].ID != "custom-node" {
		t.Fatalf("expected 1 custom server, got %+v", servers)
	}
	if servers[0].Connection.SSH == nil || servers[0].Connection.SSH.Host != "192.168.1.50" {
		t.Errorf("expected normalized SSH host 192.168.1.50")
	}

	// 5. Delete server
	if err := m.DeleteServer("custom-node"); err != nil {
		t.Fatalf("failed to delete server: %v", err)
	}
	if len(m.ListServers()) != 0 {
		t.Errorf("expected 0 servers after delete, got %d", len(m.ListServers()))
	}
}

func TestFleetManager_PingLocalhost(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-ping-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	m, err := NewManager(filepath.Join(tmpDir, "data"))
	if err != nil {
		t.Fatalf("failed to initialize fleet manager: %v", err)
	}

	res := m.Ping(context.Background(), "localhost")
	if res.Status != "online" || res.Protocol != "local" {
		t.Errorf("expected localhost to be online local, got %+v", res)
	}
}
