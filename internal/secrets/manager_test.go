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
