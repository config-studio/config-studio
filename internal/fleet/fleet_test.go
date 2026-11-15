package fleet

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

func TestFleetManager_V2_SingleSourceOfTruth(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-v2-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	m, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to init: %v", err)
	}

	// Mock dynamic core host repository
	mockHosts := map[string]*HostInfo{
		"alpine-01": {
			ID:         "alpine-01",
			Name:       "Alpine Test Server",
			Host:       "192.168.1.100",
			Port:       2222,
			User:       "deployer",
			IdentityID: "vault:ssh-key-1",
			Group:      "Production",
			Tags:       []string{"alpine", "web"},
		},
	}

	m.SetHostResolver(func(id string) (*HostInfo, error) {
		if h, ok := mockHosts[id]; ok {
			return h, nil
		}
		return nil, os.ErrNotExist
	})

	// Add node with ssh_host_ref (ARCH-002)
	node := ServerNode{
		ID:         "alpine-01",
		SSHHostRef: "alpine-01",
		Connection: ConnectionConfig{
			Agent: &AgentConnectionConfig{
				Enabled:   true,
				Port:      8085,
				SecretRef: "vault://agent:alpine-01",
			},
		},
	}

	if err := m.AddOrUpdateServer(node); err != nil {
		t.Fatalf("failed to add server: %v", err)
	}

	// 1. Verify that raw YAML is written in v2 schema and contains NO duplicate IP or credentials
	raw, err := m.GetRawYAML()
	if err != nil {
		t.Fatalf("failed to get raw YAML: %v", err)
	}
	if !strings.Contains(raw, "version: \"2\"") && !strings.Contains(raw, "version: 2") {
		t.Errorf("expected version 2 in YAML, got: %s", raw)
	}
	if !strings.Contains(raw, "nodes:") {
		t.Errorf("expected nodes: list in YAML v2, got: %s", raw)
	}
	if strings.Contains(raw, "192.168.1.100") {
		t.Errorf("expected NO duplicated IP in servers.yaml v2, but found it in: %s", raw)
	}
	if strings.Contains(raw, "deployer") {
		t.Errorf("expected NO duplicated username in servers.yaml v2, but found it in: %s", raw)
	}

	// 2. Verify that GetServer resolves IP and dynamic Agent URL from Core Host dynamically
	srv, err := m.GetServer("alpine-01")
	if err != nil {
		t.Fatalf("failed to get server: %v", err)
	}
	if srv.Host != "192.168.1.100" || srv.Port != 2222 || srv.User != "deployer" {
		t.Errorf("expected resolved SSH info, got host=%q, port=%d, user=%q", srv.Host, srv.Port, srv.User)
	}
	if srv.Connection.Agent == nil || srv.Connection.Agent.URL != "http://192.168.1.100:8085" {
		t.Errorf("expected dynamic agent URL http://192.168.1.100:8085, got %+v", srv.Connection.Agent)
	}

	// 3. Dynamic IP Change in Core Host propagates immediately
	mockHosts["alpine-01"].Host = "10.0.0.55"
	srvUpdated, err := m.GetServer("alpine-01")
	if err != nil {
		t.Fatalf("failed to get updated server: %v", err)
	}
	if srvUpdated.Host != "10.0.0.55" {
		t.Errorf("expected updated IP 10.0.0.55, got %q", srvUpdated.Host)
	}
	if srvUpdated.Connection.Agent.URL != "http://10.0.0.55:8085" {
		t.Errorf("expected dynamic agent URL to update to http://10.0.0.55:8085, got %q", srvUpdated.Connection.Agent.URL)
	}

	// 4. Server exists ONLY in Core Hosts (not yet in servers.yaml)
	mockHosts["debian-core-only"] = &HostInfo{
		ID:         "debian-core-only",
		Name:       "Debian Core Only",
		Host:       "10.0.0.99",
		Port:       22,
		User:       "root",
		IdentityID: "main",
	}
	srvCoreOnly, err := m.GetServer("debian-core-only")
	if err != nil {
		t.Fatalf("expected GetServer to dynamically resolve core host: %v", err)
	}
	if srvCoreOnly.Host != "10.0.0.99" || srvCoreOnly.SSHHostRef != "debian-core-only" {
		t.Errorf("expected resolved core host, got %+v", srvCoreOnly)
	}
}

func TestFleet_GetAgentBinaryStream(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-fleet-stream-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a mock local binary in tmpDir/agents/config-studio-agent-linux-amd64
	agentsDir := filepath.Join(tmpDir, "agents")
	if err := os.MkdirAll(agentsDir, 0755); err != nil {
		t.Fatalf("failed to create agents dir: %v", err)
	}
	mockBinPath := filepath.Join(agentsDir, "config-studio-agent-linux-amd64")
	if err := os.WriteFile(mockBinPath, []byte("mock-agent-binary-content"), 0755); err != nil {
		t.Fatalf("failed to write mock binary: %v", err)
	}

	// Test stream resolution via local fallback
	rc, size, src, err := getAgentBinaryStream(tmpDir, agentsDir, "config-studio-agent-linux-amd64")
	if err != nil {
		t.Fatalf("expected stream resolution to succeed, got %v", err)
	}
	defer rc.Close()

	if size != int64(len("mock-agent-binary-content")) {
		t.Errorf("expected size %d, got %d", len("mock-agent-binary-content"), size)
	}
	if !strings.Contains(src, "config-studio-agent-linux-amd64") {
		t.Errorf("expected source to contain binary name, got %q", src)
	}
}
