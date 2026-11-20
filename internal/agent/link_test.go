package agent

import (
	"strings"
	"testing"
)

func TestConnectionLinkGenerationAndParsing(t *testing.T) {
	cfg := &Config{
		Host: "0.0.0.0",
		Port: 8085,
		TLS:  TLSConfig{Enabled: false},
		Master: MasterAuth{
			KeyID:  "cs_key_56643d5586e39415ec34721cfc1b31b6",
			Secret: "JBSWY3DPEHPK3PXP",
		},
		Sandbox: SandboxConfig{
			AllowedRoots: []string{"/opt/projects", "/var/www"},
		},
	}

	link := cfg.GenerateConnectionLink("192.168.1.50", "prod-vps", nil)
	if !strings.HasPrefix(link, "cs-agent://cs_key_56643d5586e39415ec34721cfc1b31b6:JBSWY3DPEHPK3PXP@192.168.1.50:8085/") {
		t.Fatalf("unexpected link prefix: %s", link)
	}
	if !strings.Contains(link, "roots=%2Fopt%2Fprojects%2C%2Fvar%2Fwww") && !strings.Contains(link, "roots=/opt/projects,/var/www") {
		t.Fatalf("link missing encoded roots: %s", link)
	}
	if !strings.HasSuffix(link, "#prod-vps") {
		t.Fatalf("link missing node name fragment: %s", link)
	}

	// Parse back
	parsed, err := ParseConnectionLink(link)
	if err != nil {
		t.Fatalf("ParseConnectionLink failed: %v", err)
	}

	if parsed.KeyID != "cs_key_56643d5586e39415ec34721cfc1b31b6" {
		t.Errorf("expected KeyID 'cs_key_56643d5586e39415ec34721cfc1b31b6', got %q", parsed.KeyID)
	}
	if parsed.Secret != "JBSWY3DPEHPK3PXP" {
		t.Errorf("expected Secret 'JBSWY3DPEHPK3PXP', got %q", parsed.Secret)
	}
	if parsed.Host != "192.168.1.50" {
		t.Errorf("expected Host '192.168.1.50', got %q", parsed.Host)
	}
	if parsed.Port != 8085 {
		t.Errorf("expected Port 8085, got %d", parsed.Port)
	}
	if parsed.NodeName != "prod-vps" {
		t.Errorf("expected NodeName 'prod-vps', got %q", parsed.NodeName)
	}
	if len(parsed.Roots) != 2 {
		t.Errorf("expected 2 roots, got %d: %+v", len(parsed.Roots), parsed.Roots)
	}
}

func TestParseConnectionLinkVariants(t *testing.T) {
	// With csagent:// scheme - testing explicit token key matching (this_token_key_not_id)
	link1 := "csagent://this_token_key_not_id:SECRETBASE32@vpn.example.com:9998/?roots=/home/deploy&tls=1#staging"
	parsed1, err := ParseConnectionLink(link1)
	if err != nil {
		t.Fatalf("failed to parse csagent:// link: %v", err)
	}
	if parsed1.KeyID != "this_token_key_not_id" {
		t.Errorf("expected KeyID 'this_token_key_not_id', got %q", parsed1.KeyID)
	}
	if parsed1.Port != 9998 || !parsed1.TLS || parsed1.NodeName != "staging" {
		t.Errorf("parsed fields mismatch: %+v", parsed1)
	}

	// Invalid link
	_, err = ParseConnectionLink("http://some-site.com")
	if err == nil {
		t.Errorf("expected error for invalid scheme")
	}
}

func TestParseConnectionLink_PreservesPosixRootsOnWindows(t *testing.T) {
	link := "cs-agent://cs_key_56643d5586e39415ec34721cfc1b31b6:JBSWY3DPEHPK3PXP@192.168.1.50:8085/?roots=/opt/projects,/var/www#prod-vps"
	parsed, err := ParseConnectionLink(link)
	if err != nil {
		t.Fatalf("ParseConnectionLink failed: %v", err)
	}
	if len(parsed.Roots) != 2 || parsed.Roots[0] != "/opt/projects" || parsed.Roots[1] != "/var/www" {
		t.Fatalf("roots corrupted by filepath.Clean: %+v", parsed.Roots)
	}
}

