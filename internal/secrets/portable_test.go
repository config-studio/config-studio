package secrets

import (
	"os"
	"strings"
	"testing"
)

func TestPortableVault_ExportAndImport(t *testing.T) {
	tmpDir1, err := os.MkdirTemp("", "cs_portable_src_*")
	if err != nil {
		t.Fatalf("failed to create src temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir1)

	srcMgr, err := NewManager(tmpDir1)
	if err != nil {
		t.Fatalf("NewManager src failed: %v", err)
	}

	// 1. Add sample secrets to source manager
	s1 := SecretItem{
		SecretMeta: SecretMeta{
			ID:    "sec-ssh-1",
			Title: "Server Alpha SSH Key",
			Type:  TypeSSHKey,
			Scope: ScopeShared,
		},
		Value: "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key-data\n-----END OPENSSH PRIVATE KEY-----",
	}
	if err := srcMgr.Set(s1); err != nil {
		t.Fatalf("failed to set secret 1: %v", err)
	}

	s2 := SecretItem{
		SecretMeta: SecretMeta{
			ID:    "sec-pwd-1",
			Title: "Database Password",
			Type:  TypePassword,
			Scope: ScopeShared,
		},
		Value: "SuperSecretP@ssword123!",
	}
	if err := srcMgr.Set(s2); err != nil {
		t.Fatalf("failed to set secret 2: %v", err)
	}

	// 2. Export with passphrase
	passphrase := "MyMigrationPassword2026!"
	bundleBytes, err := srcMgr.ExportPortable(passphrase)
	if err != nil {
		t.Fatalf("ExportPortable failed: %v", err)
	}
	if len(bundleBytes) < 100 {
		t.Fatalf("bundle too small: %d bytes", len(bundleBytes))
	}

	// 3. Test wrong passphrase rejection
	tmpDir2, err := os.MkdirTemp("", "cs_portable_dst_*")
	if err != nil {
		t.Fatalf("failed to create dst temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir2)

	dstMgr, err := NewManager(tmpDir2)
	if err != nil {
		t.Fatalf("NewManager dst failed: %v", err)
	}

	_, err = dstMgr.ImportPortable(bundleBytes, "WrongPassword!")
	if err == nil || err != ErrInvalidPassphrase {
		t.Fatalf("expected ErrInvalidPassphrase on wrong password, got: %v", err)
	}

	// 4. Test successful import into completely separate target instance
	res, err := dstMgr.ImportPortable(bundleBytes, passphrase)
	if err != nil {
		t.Fatalf("ImportPortable with correct passphrase failed: %v", err)
	}

	if res.Total != 2 || res.Imported != 2 {
		t.Errorf("unexpected import result: %+v", res)
	}

	// 5. Verify secrets in destination
	val1, err := dstMgr.Get("sec-ssh-1")
	if err != nil {
		t.Fatalf("failed to get sec-ssh-1 in target: %v", err)
	}
	if val1 != "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key-data\n-----END OPENSSH PRIVATE KEY-----" {
		t.Errorf("value mismatch for sec-ssh-1: %s", val1)
	}

	val2, err := dstMgr.Get("sec-pwd-1")
	if err != nil {
		t.Fatalf("failed to get sec-pwd-1 in target: %v", err)
	}
	if val2 != "SuperSecretP@ssword123!" {
		t.Errorf("value mismatch for sec-pwd-1: %s", val2)
	}
}

func TestPortableVault_ExportAbortsOnSecretRetrievalFailure(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs_portable_err_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	// Inject metadata for a secret that does not exist in provider
	mgr.mu.Lock()
	mgr.items["ghost-secret"] = SecretMeta{
		ID:    "ghost-secret",
		Title: "Ghost",
	}
	mgr.mu.Unlock()

	// Export should fail with descriptive error rather than silently omitting it
	_, err = mgr.ExportPortable("test-passphrase")
	if err == nil {
		t.Fatal("expected ExportPortable to fail when a secret is missing from provider, but succeeded")
	}
	if !strings.Contains(err.Error(), "ghost-secret") {
		t.Errorf("expected error to mention failing secret ID, got: %v", err)
	}
}
