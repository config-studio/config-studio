package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigInitAndTokens(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "agent.yaml")

	// 1. Initial load should create default config with generated secrets
	cfg, isNew, err := LoadOrInitConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadOrInitConfig failed: %v", err)
	}
	if !isNew {
		t.Errorf("Expected isNew = true on fresh file")
	}
	if cfg.Master.KeyID == "" || cfg.Master.Secret == "" {
		t.Errorf("Master credentials should not be empty")
	}
	if !strings.HasPrefix(cfg.Master.KeyID, "cs_key_") {
		t.Errorf("Expected Master.KeyID to start with 'cs_key_', got %s", cfg.Master.KeyID)
	}
	if len(cfg.Master.KeyID) < 32 {
		t.Errorf("Expected Master.KeyID to be a cryptographically secure random token, got length %d", len(cfg.Master.KeyID))
	}

	// 2. Add scoped token
	tok, err := cfg.AddScopedToken("prom", "Prometheus scraper", []string{"metrics", "health"}, nil)
	if err != nil {
		t.Fatalf("AddScopedToken failed: %v", err)
	}
	if tok.Token == "" || tok.ID != "prom" {
		t.Errorf("Unexpected token structure: %v", tok)
	}

	// 3. Re-read from disk to ensure persistence
	cfgReloaded, isNew2, err := LoadOrInitConfig(cfgPath)
	if err != nil {
		t.Fatalf("Reload failed: %v", err)
	}
	if isNew2 {
		t.Errorf("Expected isNew = false on existing file")
	}
	if len(cfgReloaded.ScopedTokens) != 1 {
		t.Fatalf("Expected 1 scoped token, got %d", len(cfgReloaded.ScopedTokens))
	}
	if cfgReloaded.ScopedTokens[0].ID != "prom" {
		t.Errorf("Token ID mismatch")
	}

	// 4. Delete scoped token
	if err := cfgReloaded.DeleteScopedToken("prom"); err != nil {
		t.Fatalf("DeleteScopedToken failed: %v", err)
	}
	if len(cfgReloaded.ScopedTokens) != 0 {
		t.Errorf("Expected 0 tokens after delete")
	}

	_ = os.RemoveAll(tmpDir)
}
