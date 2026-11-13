package hosts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"config-studio/internal/secrets"
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

func TestHostsManager_Deduplication(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs_hosts_dedup_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	// 1. Save alpine-01 from fleet
	_, err = mgr.Save(&Host{
		ID:       "alpine-01",
		Name:     "Alpine VM Test",
		Host:     "192.168.0.161",
		Port:     22,
		User:     "root",
		AuthType: AuthTypeVault,
		SecretID: "id_123",
	})
	if err != nil {
		t.Fatalf("first save failed: %v", err)
	}

	// 2. Save host-alpine-01 from localStorage (different ID, but same user@host:port)
	_, err = mgr.Save(&Host{
		ID:          "host-alpine-01",
		Name:        "Alpine VM Test",
		Host:        "192.168.0.161",
		Port:        22,
		User:        "root",
		AuthType:    AuthTypeVault,
		SecretID:    "id_123",
		DefaultPath: "/etc",
	})
	if err != nil {
		t.Fatalf("second save failed: %v", err)
	}

	// List should only have 1 host, not 2!
	list := mgr.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 host after saving duplicate endpoint, got %d: %+v", len(list), list)
	}
	if list[0].DefaultPath != "/etc" {
		t.Errorf("expected merged DefaultPath /etc, got %q", list[0].DefaultPath)
	}

	// 3. Test deduplication on load of an existing duplicate file
	dupJSON := `{
		"version": 1,
		"hosts": [
			{"id": "h1", "name": "Debian", "host": "192.168.0.110", "port": 22, "user": "root"},
			{"id": "host-h1", "name": "Debian Prod", "host": "192.168.0.110", "port": 22, "user": "root", "defaultPath": "/var/log"}
		]
	}`
	dupFile := filepath.Join(tmpDir, "hosts.json")
	if err := os.WriteFile(dupFile, []byte(dupJSON), 0644); err != nil {
		t.Fatalf("failed to write duplicate json: %v", err)
	}

	mgr2, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager with dup file failed: %v", err)
	}
	list2 := mgr2.List()
	if len(list2) != 1 {
		t.Fatalf("expected load() to clean duplicates to 1 host, got %d", len(list2))
	}
	if list2[0].DefaultPath != "/var/log" {
		t.Errorf("expected load() to preserve DefaultPath /var/log, got %q", list2[0].DefaultPath)
	}
}

func TestHostsManager_AutoVaultCredentials(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs_hosts_vault_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	secMgr, err := secrets.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create secrets manager: %v", err)
	}

	mgr, err := NewManager(tmpDir, secMgr)
	if err != nil {
		t.Fatalf("failed to create hosts manager: %v", err)
	}

	// 1. Save host with plaintext password
	h1 := &Host{
		Name:     "Test Password Host",
		Host:     "192.168.1.50",
		User:     "root",
		Password: "super-secret-password-123",
	}

	saved, err := mgr.Save(h1)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Plaintext password should be wiped from host object
	if saved.Password != "" {
		t.Errorf("expected saved.Password to be empty, got %q", saved.Password)
	}
	if saved.AuthType != AuthTypeVault {
		t.Errorf("expected AuthType %q, got %q", AuthTypeVault, saved.AuthType)
	}
	if saved.SecretID == "" {
		t.Fatalf("expected non-empty SecretID")
	}

	// Secret must exist and be decryptable from Vault
	val, err := secMgr.Get(saved.SecretID)
	if err != nil {
		t.Fatalf("failed to retrieve secret from vault: %v", err)
	}
	if val != "super-secret-password-123" {
		t.Errorf("expected vault secret to be 'super-secret-password-123', got %q", val)
	}

	// 2. Save host with plaintext private key
	pemKey := "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key\n-----END OPENSSH PRIVATE KEY-----"
	h2 := &Host{
		Name:       "Test Key Host",
		Host:       "192.168.1.60",
		User:       "admin",
		PrivateKey: pemKey,
	}

	saved2, err := mgr.Save(h2)
	if err != nil {
		t.Fatalf("Save key host failed: %v", err)
	}
	if saved2.PrivateKey != "" {
		t.Errorf("expected saved2.PrivateKey to be empty, got %q", saved2.PrivateKey)
	}
	if saved2.AuthType != AuthTypeVault {
		t.Errorf("expected AuthType %q, got %q", AuthTypeVault, saved2.AuthType)
	}

	val2, err := secMgr.Get(saved2.SecretID)
	if err != nil {
		t.Fatalf("failed to retrieve key from vault: %v", err)
	}
	if val2 != pemKey {
		t.Errorf("expected vault key to match original, got %q", val2)
	}

	// 3. Test startup migration of existing legacy plaintext hosts
	legacyJSON := `{
		"version": 1,
		"hosts": [
			{"id": "legacy-1", "name": "Legacy Plain", "host": "10.0.0.1", "port": 22, "user": "ubuntu", "password": "legacy-plain-password"}
		]
	}`
	legacyFile := filepath.Join(tmpDir, "hosts.json")
	if err := os.WriteFile(legacyFile, []byte(legacyJSON), 0644); err != nil {
		t.Fatalf("failed to write legacy json: %v", err)
	}

	mgrMigrated, err := NewManager(tmpDir, secMgr)
	if err != nil {
		t.Fatalf("NewManager with legacy file failed: %v", err)
	}

	migratedHost, err := mgrMigrated.Get("legacy-1")
	if err != nil {
		t.Fatalf("Get legacy host failed: %v", err)
	}
	if migratedHost.Password != "" {
		t.Errorf("expected migratedHost.Password to be wiped, got %q", migratedHost.Password)
	}
	if migratedHost.AuthType != AuthTypeVault || migratedHost.SecretID == "" {
		t.Errorf("expected migratedHost to have AuthTypeVault and SecretID, got %+v", migratedHost)
	}

	migratedVal, err := secMgr.Get(migratedHost.SecretID)
	if err != nil {
		t.Fatalf("failed to retrieve migrated secret: %v", err)
	}
	if migratedVal != "legacy-plain-password" {
		t.Errorf("expected migratedVal to be 'legacy-plain-password', got %q", migratedVal)
	}
}
