package hosts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHostsManager_CRUD(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs_hosts_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	// 1. Initial list should be empty
	list := mgr.List()
	if len(list) != 0 {
		t.Fatalf("expected 0 hosts, got %d", len(list))
	}

	// 2. Save a new host
	h1 := &Host{
		ID:       "host-1",
		Name:     "Alpine VM",
		Host:     "192.168.0.161",
		Port:     22,
		User:     "root",
		AuthType: AuthTypeVault,
		SecretID: "sec-key-1",
		Tags:     []string{"alpine", "test"},
	}

	saved, err := mgr.Save(h1)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}
	if saved.ID != "host-1" || saved.Host != "192.168.0.161" {
		t.Errorf("unexpected saved host: %+v", saved)
	}

	// 3. Get the host
	got, err := mgr.Get("host-1")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.Name != "Alpine VM" || got.IdentityID != "sec-key-1" {
		t.Errorf("unexpected got host: %+v", got)
	}

	// 4. Update the host
	got.Port = 2222
	updated, err := mgr.Save(got)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.Port != 2222 {
		t.Errorf("expected port 2222, got %d", updated.Port)
	}

	// 5. Check persistence by creating a new manager instance
	mgr2, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager re-init failed: %v", err)
	}
	list2 := mgr2.List()
	if len(list2) != 1 || list2[0].Port != 2222 {
		t.Fatalf("persistence failed, list: %+v", list2)
	}

	// 6. Delete
	if err := mgr2.Delete("host-1"); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if _, err := mgr2.Get("host-1"); err != ErrHostNotFound {
		t.Fatalf("expected ErrHostNotFound, got %v", err)
	}
	if len(mgr2.List()) != 0 {
		t.Fatalf("expected 0 hosts after deletion, got %d", len(mgr2.List()))
	}
}

func TestHostsManager_AutoMigrateFromFleet(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs_hosts_migrate_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	yamlContent := `version: "1"
servers:
  - id: localhost
    name: Localhost
  - id: alpine-01
    name: Alpine VM Test
    connection:
      ssh:
        enabled: true
        host: "192.168.0.161"
        port: 22
        user: "root"
        identity: "sec-123"
  - id: debian-01
    name: Debian Production
    connection:
      ssh:
        enabled: true
        host: "192.168.0.110"
        port: 2200
        user: "debian"
`
	yamlPath := filepath.Join(tmpDir, "servers.yaml")
	if err := os.WriteFile(yamlPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write servers.yaml: %v", err)
	}

	mgr, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	hosts := mgr.List()
	if len(hosts) != 2 {
		t.Fatalf("expected 2 migrated hosts, got %d", len(hosts))
	}

	h1, _ := mgr.Get("alpine-01")
	if h1 == nil || h1.Host != "192.168.0.161" || h1.User != "root" || h1.IdentityID != "sec-123" {
		t.Errorf("unexpected migrated alpine host: %+v", h1)
	}

	h2, _ := mgr.Get("debian-01")
	if h2 == nil || h2.Host != "192.168.0.110" || h2.Port != 2200 {
		t.Errorf("unexpected migrated debian host: %+v", h2)
	}
}

func TestOpenSSH_ExportAndParse(t *testing.T) {
	hosts := []*Host{
		{
			ID:          "srv-alpine",
			Name:        "Alpine Server",
			Host:        "10.0.0.15",
			Port:        2222,
			User:        "root",
			Description: "My alpine test",
			Tags:        []string{"vm", "dev"},
		},
		{
			ID:        "srv-debian",
			Name:      "Debian Server",
			Host:      "10.0.0.20",
			Port:      22,
			User:      "admin",
			ProxyJump: "srv-alpine",
		},
	}

	exported := ExportOpenSSH(hosts)
	if !strings.Contains(exported, "Host srv-alpine") || !strings.Contains(exported, "HostName 10.0.0.15") {
		t.Fatalf("export missing host data: %s", exported)
	}

	parsed, err := ParseOpenSSH(exported)
	if err != nil {
		t.Fatalf("ParseOpenSSH failed: %v", err)
	}
	if len(parsed) != 2 {
		t.Fatalf("expected 2 parsed hosts, got %d", len(parsed))
	}

	if parsed[0].Host != "10.0.0.15" || parsed[0].Port != 2222 || parsed[0].User != "root" {
		t.Errorf("parsed[0] mismatch: %+v", parsed[0])
	}
	if parsed[1].Host != "10.0.0.20" || parsed[1].ProxyJump != "srv-alpine" {
		t.Errorf("parsed[1] mismatch: %+v", parsed[1])
	}
}
