package secrets

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSecretsManager(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-secrets-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	mgr, err := NewManager(tempDir)
	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	// 1. Initial status
	st := mgr.Status(true, "test-sess")
	if st.Count != 0 {
		t.Fatalf("Expected 0 secrets, got %d", st.Count)
	}
	if st.PrivilegedActive {
		t.Fatalf("Expected privileged mode to be inactive initially")
	}

	// 2. Add shared secret
	err = mgr.Set(SecretItem{
		SecretMeta: SecretMeta{
			ID:    "shared:prod-cluster",
			Title: "Prod Cluster Root Password",
			Type:  TypePassword,
			Scope: ScopeShared,
		},
		Value: "SuperSecretP@ss123!",
	})
	if err != nil {
		t.Fatalf("Failed to set secret: %v", err)
	}

	// 3. Verify Has & Get
	if !mgr.Has("shared:prod-cluster") {
		t.Fatalf("Expected secret to exist")
	}

	val, err := mgr.Get("shared:prod-cluster")
	if err != nil {
		t.Fatalf("Failed to get secret: %v", err)
	}
	if val != "SuperSecretP@ss123!" {
		t.Fatalf("Expected value 'SuperSecretP@ss123!', got '%s'", val)
	}

	// 4. Verify that metadata file does NOT contain the secret value (Zero-Leak)
	metaData, err := os.ReadFile(filepath.Join(tempDir, "secrets_metadata.json"))
	if err != nil {
		t.Fatalf("Failed to read metadata file: %v", err)
	}
	if string(metaData) == "" {
		t.Fatalf("Metadata file is empty")
	}
	if bytesContains(metaData, []byte("SuperSecretP@ss123!")) {
		t.Fatalf("CRITICAL SECURITY FLAW: Secret plaintext found in metadata file!")
	}

	// 5. Update / Edit secret value
	err = mgr.Set(SecretItem{
		SecretMeta: SecretMeta{
			ID:    "shared:prod-cluster",
			Title: "Prod Cluster Root Password (Rotated)",
			Type:  TypePassword,
			Scope: ScopeShared,
		},
		Value: "NewRotatedP@ss456#",
	})
	if err != nil {
		t.Fatalf("Failed to update secret: %v", err)
	}

	valUpdated, err := mgr.Get("shared:prod-cluster")
	if err != nil {
		t.Fatalf("Failed to get updated secret: %v", err)
	}
	if valUpdated != "NewRotatedP@ss456#" {
		t.Fatalf("Expected updated value 'NewRotatedP@ss456#', got '%s'", valUpdated)
	}

	// 6. Test Privileged Mode
	sessID := "admin-session-xyz"
	if mgr.IsPrivileged(sessID) {
		t.Fatalf("Session should not be privileged yet")
	}
	mgr.UnlockSession(sessID, 100*time.Millisecond)
	if !mgr.IsPrivileged(sessID) {
		t.Fatalf("Session should now be privileged")
	}
	time.Sleep(150 * time.Millisecond)
	if mgr.IsPrivileged(sessID) {
		t.Fatalf("Session should have expired from privileged mode")
	}

	// 7. Delete secret
	err = mgr.Delete("shared:prod-cluster")
	if err != nil {
		t.Fatalf("Failed to delete secret: %v", err)
	}
	if mgr.Has("shared:prod-cluster") {
		t.Fatalf("Secret should have been deleted")
	}
	_, err = mgr.Get("shared:prod-cluster")
	if err == nil {
		t.Fatalf("Expected error getting deleted secret, got nil")
	}

	// 8. Test Multiple Secret Types (Password, SSH Key, Token, Certificate, Env, Other)
	typesToTest := []struct {
		id    string
		title string
		sType SecretType
		val   string
	}{
		{"sec:ssh", "Production Bastion Key", TypeSSHKey, "-----BEGIN OPENSSH PRIVATE KEY-----\nMOCK..."},
		{"sec:token", "GitHub CI Token", TypeToken, "ghp_MockToken123456789"},
		{"sec:cert", "Wildcard TLS Cert", TypeCertificate, "-----BEGIN CERTIFICATE-----\nMOCK..."},
		{"sec:env", "App Secret Env", TypeEnv, "DATABASE_URL=postgres://..."},
		{"sec:agent", "Agent Credentials (alpine-01)", TypeAgentCredentials, `{"keyId":"cs_master_1","secret":"ABC"}`},
		{"sec:other", "Hardware Security PIN", TypeOther, "9988"},
	}

	for _, tc := range typesToTest {
		if err := mgr.Set(SecretItem{
			SecretMeta: SecretMeta{
				ID:    tc.id,
				Title: tc.title,
				Type:  tc.sType,
				Scope: ScopeShared,
			},
			Value: tc.val,
		}); err != nil {
			t.Fatalf("Failed to set secret %s (%s): %v", tc.id, tc.sType, err)
		}

		meta, exists := mgr.GetMeta(tc.id)
		if !exists || meta.Type != tc.sType {
			t.Fatalf("Expected secret %s to have type %s, got %s", tc.id, tc.sType, meta.Type)
		}

		val, err := mgr.Get(tc.id)
		if err != nil || val != tc.val {
			t.Fatalf("Expected secret %s value %s, got %s (err: %v)", tc.id, tc.val, val, err)
		}
	}

	if mgr.Status(false, "").Count != len(typesToTest) {
		t.Fatalf("Expected %d secrets in status, got %d", len(typesToTest), mgr.Status(false, "").Count)
	}
}

func bytesContains(b, sub []byte) bool {
	if len(sub) == 0 {
		return true
	}
	for i := 0; i <= len(b)-len(sub); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			if b[i+j] != sub[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func TestSecretsManager_AgentMigration(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-secrets-migration-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Pre-seed metadata with legacy "password" agent credential
	legacyJSON := `[
		{
			"id": "agent:alpine-01",
			"title": "Agent Credentials (Alpine VM Test)",
			"type": "password",
			"scope": "shared",
			"pluginId": "servers"
		}
	]`
	if err := os.WriteFile(filepath.Join(tempDir, "secrets_metadata.json"), []byte(legacyJSON), 0644); err != nil {
		t.Fatalf("Failed to write legacy metadata: %v", err)
	}

	mgr, err := NewManager(tempDir)
	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	meta, exists := mgr.GetMeta("agent:alpine-01")
	if !exists {
		t.Fatalf("Expected agent:alpine-01 to exist")
	}
	if meta.Type != TypeAgentCredentials {
		t.Fatalf("Expected auto-migrated type to be %s, got %s", TypeAgentCredentials, meta.Type)
	}
}

func TestVault_NoDataLossOnReadError(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-vault-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	v, err := NewEncryptedVaultProvider(tempDir)
	if err != nil {
		t.Fatal(err)
	}

	if err := v.Set("k1", "v1"); err != nil {
		t.Fatal(err)
	}

	// Corrupt vault file
	if err := os.WriteFile(v.filePath, []byte("corrupt-garbage-bytes"), 0600); err != nil {
		t.Fatal(err)
	}

	// Calling Set with corrupted vault must return an error and NOT overwrite with only {"k2": "v2"}
	err = v.Set("k2", "v2")
	if err == nil {
		t.Fatalf("expected error from Set() when vault is corrupt, got nil")
	}
}

func TestManager_NoMetadataOverwriteOnLoadFailure(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-meta-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	metaFile := filepath.Join(tempDir, "secrets_metadata.json")
	if err := os.WriteFile(metaFile, []byte("{invalid-json}"), 0600); err != nil {
		t.Fatal(err)
	}

	_, err = NewManager(tempDir)
	if err == nil {
		t.Fatalf("expected NewManager to fail on corrupt metadata JSON, got nil")
	}

	// Verify original file was not overwritten with empty metadata
	content, _ := os.ReadFile(metaFile)
	if string(content) != "{invalid-json}" {
		t.Fatalf("corrupt metadata file was unexpectedly overwritten: %s", string(content))
	}
}
