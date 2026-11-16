package agent

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMasterAuthentication(t *testing.T) {
	master := MasterAuth{
		KeyID:  "cs_master_test",
		Secret: "JBSWY3DPEHPK3PXP",
	}
	auth := NewAuthenticator(master, nil)

	// 1. Request without auth
	req := httptest.NewRequest(http.MethodGet, "/api/fs/tree", nil)
	ctx, err := auth.AuthenticateRequest(req)
	if err == nil || ctx != nil {
		t.Fatalf("Expected error on missing credentials, got ctx: %v", ctx)
	}

	// 2. Request with Master Key only (Read-Only)
	req = httptest.NewRequest("GET", "/api/fs/tree", nil)
	req.Header.Set("Authorization", "Bearer cs_master_test")
	ctx, err = auth.AuthenticateRequest(req)
	if err != nil {
		t.Fatalf("Unexpected error for master RO: %v", err)
	}
	if ctx.Level != AccessReadOnly {
		t.Errorf("Expected AccessReadOnly, got %v", ctx.Level)
	}
	if !ctx.IsMaster {
		t.Errorf("Expected IsMaster = true")
	}

	// 3. Request with Master Key + Valid TOTP (Read-Write)
	now := time.Now()
	otp, _ := GenerateTOTP(master.Secret, now, 6)
	req = httptest.NewRequest("POST", "/api/fs/file", nil)
	req.Header.Set("Authorization", "Bearer cs_master_test:"+otp)
	ctx, err = auth.AuthenticateRequest(req)
	if err != nil {
		t.Fatalf("Unexpected error for master RW: %v", err)
	}
	if ctx.Level != AccessReadWrite {
		t.Errorf("Expected AccessReadWrite, got %v", ctx.Level)
	}

	// 4. Replay test: Attempting to use the SAME OTP step again must fail
	reqReplay := httptest.NewRequest("POST", "/api/fs/file", nil)
	reqReplay.Header.Set("Authorization", "Bearer cs_master_test:"+otp)
	_, err = auth.AuthenticateRequest(reqReplay)
	if err == nil {
		t.Fatalf("Expected replay detection error for reused OTP, but succeeded!")
	}

	// 5. Invalid TOTP
	reqBad := httptest.NewRequest("POST", "/api/fs/file", nil)
	reqBad.Header.Set("Authorization", "Bearer cs_master_test:000000")
	_, err = auth.AuthenticateRequest(reqBad)
	if err == nil {
		t.Fatalf("Expected error for invalid OTP, but succeeded")
	}
}

func TestScopedTokens(t *testing.T) {
	master := MasterAuth{KeyID: "master", Secret: "JBSWY3DPEHPK3PXP"}
	scoped := []ScopedToken{
		{
			ID:          "prom",
			Token:       "cs_ro_prom_12345",
			Description: "Prometheus",
			Topics:      []string{"metrics", "health"},
		},
		{
			ID:          "nginx",
			Token:       "cs_ro_nginx_67890",
			Description: "Nginx Auditor",
			Topics:      []string{"configs:/etc/nginx", "logs:/var/log/nginx"},
		},
	}
	auth := NewAuthenticator(master, scoped)

	// Test Prometheus token
	req := httptest.NewRequest("GET", "/api/metrics", nil)
	req.Header.Set("Authorization", "Bearer cs_ro_prom_12345")
	ctx, err := auth.AuthenticateRequest(req)
	if err != nil {
		t.Fatalf("Auth failed: %v", err)
	}
	if ctx.Level != AccessReadOnly {
		t.Errorf("Expected AccessReadOnly, got %v", ctx.Level)
	}
	if !auth.CanAccessTopic(ctx, "metrics") {
		t.Errorf("Expected permission for topic 'metrics'")
	}
	if auth.CanAccessTopic(ctx, "configs:/etc/nginx") {
		t.Errorf("Prometheus token should NOT have access to configs")
	}

	// Test Nginx token path checking
	req = httptest.NewRequest("GET", "/api/fs/file", nil)
	req.Header.Set("Authorization", "Bearer cs_ro_nginx_67890")
	ctxNginx, err := auth.AuthenticateRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	if !auth.CanAccessPath(ctxNginx, "/etc/nginx/nginx.conf", false) {
		t.Errorf("Nginx token should have read access to /etc/nginx/nginx.conf")
	}
	if auth.CanAccessPath(ctxNginx, "/etc/nginx/nginx.conf", true) {
		t.Errorf("Nginx token should NEVER have write access")
	}
	if auth.CanAccessPath(ctxNginx, "/etc/shadow", false) {
		t.Errorf("Nginx token should NOT have read access to /etc/shadow")
	}
}

func TestGenerateRandomToken_EntropyAndUniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 500; i++ {
		tok := GenerateRandomToken("cs_key")
		if !strings.HasPrefix(tok, "cs_key_") {
			t.Fatalf("expected token to start with cs_key_, got %s", tok)
		}
		parts := strings.Split(tok, "_")
		if len(parts) != 3 || len(parts[2]) != 32 {
			t.Fatalf("expected format cs_key_<32hex>, got %s", tok)
		}
		if parts[2] == "00000000000000000000000000000000" {
			t.Fatalf("zero-entropy token detected: %s", tok)
		}
		if seen[tok] {
			t.Fatalf("duplicate token generated: %s", tok)
		}
		seen[tok] = true
	}
}
