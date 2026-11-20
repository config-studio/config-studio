package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParsePortString(t *testing.T) {
	cases := []struct {
		input    string
		fallback int
		expected int
	}{
		{"8085", 8085, 8085},
		{"", 8085, 8085},
		{"   ", 8085, 8085},
		{"9090", 8085, 9090},
		{"invalid", 8085, 8085},
		{"-1", 8085, 8085},
		{"70000", 8085, 8085},
	}

	for _, tc := range cases {
		got := parsePortString(tc.input, tc.fallback)
		if got != tc.expected {
			t.Errorf("parsePortString(%q, %d) = %d; want %d", tc.input, tc.fallback, got, tc.expected)
		}
	}
}

func TestParseRootsString(t *testing.T) {
	// Custom roots
	roots := parseRootsString("/opt/projects, /var/www, /etc/nginx")
	if len(roots) != 3 {
		t.Fatalf("expected 3 roots, got %d: %+v", len(roots), roots)
	}
	if roots[0] != "/opt/projects" || roots[1] != "/var/www" || roots[2] != "/etc/nginx" {
		t.Errorf("unexpected parsed roots: %+v", roots)
	}

	// Empty roots fallback
	emptyRoots := parseRootsString("")
	if len(emptyRoots) == 0 {
		t.Fatalf("expected fallback roots, got empty")
	}
}

func TestGenerateOrUpdateAgentConfig_CreationAndPreservation(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-agent-cfg-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfgPath := filepath.Join(tempDir, "agent.yaml")

	// 1. Initial creation
	initialRoots := []string{"/opt/app", "/var/log/app"}
	cfg, err := GenerateOrUpdateAgentConfig(cfgPath, 8090, initialRoots, "", "", false)
	if err != nil {
		t.Fatalf("GenerateOrUpdateAgentConfig failed on create: %v", err)
	}

	if cfg.Port != 8090 {
		t.Errorf("expected port 8090, got %d", cfg.Port)
	}
	if !strings.HasPrefix(cfg.Master.KeyID, "cs_key_") {
		t.Errorf("expected KeyID to start with 'cs_key_', got %s", cfg.Master.KeyID)
	}
	if len(cfg.Master.KeyID) < 32 {
		t.Errorf("expected KeyID to be 32+ chars, got %d", len(cfg.Master.KeyID))
	}
	if len(cfg.Master.Secret) < 20 {
		t.Errorf("expected Secret to be 20+ chars Base32, got %d", len(cfg.Master.Secret))
	}
	if len(cfg.Sandbox.AllowedRoots) != 2 || cfg.Sandbox.AllowedRoots[0] != "/opt/app" {
		t.Errorf("unexpected allowed roots: %+v", cfg.Sandbox.AllowedRoots)
	}

	originalKeyID := cfg.Master.KeyID
	originalSecret := cfg.Master.Secret

	// 2. Re-running install/update with different port and roots must PRESERVE existing credentials!
	newRoots := []string{"/opt/app", "/data"}
	updatedCfg, err := GenerateOrUpdateAgentConfig(cfgPath, 9095, newRoots, "", "", true)
	if err != nil {
		t.Fatalf("GenerateOrUpdateAgentConfig failed on update: %v", err)
	}

	if updatedCfg.Port != 9095 {
		t.Errorf("expected updated port 9095, got %d", updatedCfg.Port)
	}
	if !updatedCfg.TLS.Enabled {
		t.Errorf("expected TLS to be enabled")
	}
	if len(updatedCfg.Sandbox.AllowedRoots) != 2 || updatedCfg.Sandbox.AllowedRoots[1] != "/data" {
		t.Errorf("unexpected updated roots: %+v", updatedCfg.Sandbox.AllowedRoots)
	}

	// Crucial check: Keys must NOT be re-generated or lost!
	if updatedCfg.Master.KeyID != originalKeyID {
		t.Fatalf("credentials loss: expected KeyID %s, got %s", originalKeyID, updatedCfg.Master.KeyID)
	}
	if updatedCfg.Master.Secret != originalSecret {
		t.Fatalf("credentials loss: expected Secret %s, got %s", originalSecret, updatedCfg.Master.Secret)
	}

	// 3. Re-running install/update with port = 0 (omitted -port flag) must preserve existing custom port 9095!
	preservedPortCfg, err := GenerateOrUpdateAgentConfig(cfgPath, 0, nil, "", "", false)
	if err != nil {
		t.Fatalf("GenerateOrUpdateAgentConfig failed on preserve update: %v", err)
	}
	if preservedPortCfg.Port != 9095 {
		t.Fatalf("expected preserved port 9095, got %d", preservedPortCfg.Port)
	}
}

func TestSelectAvailablePort_AutonomousFallback(t *testing.T) {
	// 1. Pick a high test port from the curated list or custom port
	// We dynamically bind one port to simulate conflict
	preferred := 28085
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", preferred))
	if err != nil {
		t.Skipf("port %d already occupied by environment, skipping mock listen", preferred)
		return
	}
	defer ln.Close()

	// 2. SelectAvailablePort on the occupied port must detect conflict and pick another available candidate
	chosen, wasFallback := SelectAvailablePort(preferred)
	if !wasFallback {
		t.Fatalf("expected wasFallback=true for occupied port %d, got chosen=%d wasFallback=false", preferred, chosen)
	}
	if chosen == preferred {
		t.Fatalf("expected different fallback port than occupied %d, got %d", preferred, chosen)
	}
	if chosen <= 0 || chosen > 65535 {
		t.Fatalf("invalid port chosen: %d", chosen)
	}

	// 3. Testing with a known free port must pick that exact port with wasFallback=false
	lnFree, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatalf("failed to allocate free port: %v", err)
	}
	freePort := lnFree.Addr().(*net.TCPAddr).Port
	_ = lnFree.Close() // Release it immediately

	chosenFree, wasFallbackFree := SelectAvailablePort(freePort)
	if wasFallbackFree {
		t.Fatalf("expected wasFallback=false for free port %d, got chosen=%d", freePort, chosenFree)
	}
	if chosenFree != freePort {
		t.Fatalf("expected port %d, got %d", freePort, chosenFree)
	}
}
