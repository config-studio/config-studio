package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	"config-studio/internal/fleet"
	appfs "config-studio/internal/fs"
	"config-studio/internal/plugin"
	"config-studio/internal/secrets"
)

func TestForwardAuthAndTrustedProxy(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-server-auth-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfgMgr, _ := config.NewManager(tempDir)
	fsSvc, _ := appfs.NewService(tempDir)
	runner := plugin.NewRunner()
	pMgr, _ := plugin.NewManager(tempDir, runner)
	auditLogger, _ := audit.NewLogger(tempDir)
	secMgr, _ := secrets.NewManager(tempDir)
	fleetMgr, _ := fleet.NewManager(tempDir)

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr, fleetMgr)

	// 1. By default, TrustForwardAuth is false:
	// A request with X-Forwarded-User must NOT be authenticated if AuthEnabled is true
	_ = cfgMgr.Update(config.Settings{
		AuthEnabled:      true,
		AuthUser:         "admin",
		AuthPass:         "admin",
		TrustForwardAuth: false,
		TrustedProxies:   []string{"127.0.0.1/32", "10.0.0.0/8"},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/sysinfo", nil)
	req.RemoteAddr = "10.1.2.3:5555"
	req.Header.Set("X-Forwarded-User", "hacker")
	authed, user := srv.isRequestAuthenticated(req)
	if authed || user != "" {
		t.Fatalf("expected request to NOT be authenticated when TrustForwardAuth is false, got authed=%v user=%q", authed, user)
	}

	// 2. Enable TrustForwardAuth, but send from untrusted remote IP (e.g. 192.168.1.50)
	_ = cfgMgr.Update(config.Settings{
		AuthEnabled:      true,
		AuthUser:         "admin",
		AuthPass:         "admin",
		TrustForwardAuth: true,
		TrustedProxies:   []string{"127.0.0.1/32", "10.0.0.0/8"},
	})

	reqUntrusted := httptest.NewRequest(http.MethodGet, "/api/sysinfo", nil)
	reqUntrusted.RemoteAddr = "192.168.1.50:4444"
	reqUntrusted.Header.Set("X-Forwarded-User", "untrusted-actor")
	authed, user = srv.isRequestAuthenticated(reqUntrusted)
	if authed || user != "" {
		t.Fatalf("expected untrusted proxy IP to be rejected, got authed=%v user=%q", authed, user)
	}

	// 3. Request from trusted CIDR proxy (10.1.2.3 is in 10.0.0.0/8)
	reqTrusted := httptest.NewRequest(http.MethodGet, "/api/sysinfo", nil)
	reqTrusted.RemoteAddr = "10.1.2.3:5555"
	reqTrusted.Header.Set("X-Forwarded-User", "corporate-sso-user")
	authed, user = srv.isRequestAuthenticated(reqTrusted)
	if !authed || user != "corporate-sso-user" {
		t.Fatalf("expected trusted proxy to authenticate user, got authed=%v user=%q", authed, user)
	}
}

func TestSelfUpdate_RejectsUntrustedURL(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-server-update-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfgMgr, _ := config.NewManager(tempDir)
	fsSvc, _ := appfs.NewService(tempDir)
	runner := plugin.NewRunner()
	pMgr, _ := plugin.NewManager(tempDir, runner)
	auditLogger, _ := audit.NewLogger(tempDir)
	secMgr, _ := secrets.NewManager(tempDir)
	fleetMgr, _ := fleet.NewManager(tempDir)

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr, fleetMgr)

	w := httptest.NewRecorder()
	body := `{"downloadUrl": "http://malicious-site.com/payload.exe"}`
	req := httptest.NewRequest(http.MethodPost, "/api/system/self-update", strings.NewReader(body))
	req.Header.Set("X-ConfigStudio-Web", "1")
	srv.handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for untrusted download URL, got %d", w.Code)
	}
}

func TestTrustedProxy_CommaSeparatedEntries(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-proxy-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfgMgr, _ := config.NewManager(tempDir)
	fsSvc, _ := appfs.NewService(tempDir)
	runner := plugin.NewRunner()
	pMgr, _ := plugin.NewManager(tempDir, runner)
	auditLogger, _ := audit.NewLogger(tempDir)
	secMgr, _ := secrets.NewManager(tempDir)
	fleetMgr, _ := fleet.NewManager(tempDir)

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr, fleetMgr)

	// User configured single string with comma: "192.168.0.0/24, 192.168.10.9"
	_ = cfgMgr.Update(config.Settings{
		TrustedProxies: []string{"192.168.0.0/24, 192.168.10.9"},
	})

	if !srv.isTrustedProxy("192.168.10.9:54321") {
		t.Fatalf("expected 192.168.10.9 to be recognized as trusted proxy even if entered comma-separated")
	}
	if !srv.isTrustedProxy("192.168.0.50:12345") {
		t.Fatalf("expected 192.168.0.50 to be recognized in 192.168.0.0/24 subnet even if entered comma-separated")
	}
	if srv.isTrustedProxy("10.1.2.3:12345") {
		t.Fatalf("did not expect 10.1.2.3 to be trusted")
	}
}

func TestDebugProxy_TrustedProxyBypass(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-proxy-debug-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	cfgMgr, _ := config.NewManager(tempDir)
	fsSvc, _ := appfs.NewService(tempDir)
	runner := plugin.NewRunner()
	pMgr, _ := plugin.NewManager(tempDir, runner)
	auditLogger, _ := audit.NewLogger(tempDir)
	secMgr, _ := secrets.NewManager(tempDir)
	fleetMgr, _ := fleet.NewManager(tempDir)

	srv := NewServer(Config{AuthUser: "admin", AuthPass: "secret"}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr, fleetMgr)

	_ = cfgMgr.Update(config.Settings{
		AuthEnabled:    true,
		ApiEnabled:     false, // REST API disabled!
		TrustedProxies: []string{"192.168.10.9"},
	})

	// 1. Untrusted IP -> should be blocked by auth/REST gate
	untrustedW := httptest.NewRecorder()
	untrustedReq := httptest.NewRequest(http.MethodPost, "/api/debug/events", strings.NewReader(`{"kind":"USER_ACTION"}`))
	untrustedReq.RemoteAddr = "10.1.2.3:5555"
	srv.handler.ServeHTTP(untrustedW, untrustedReq)
	if untrustedW.Code != http.StatusForbidden && untrustedW.Code != http.StatusUnauthorized {
		t.Fatalf("expected untrusted debug request to be rejected, got %d", untrustedW.Code)
	}

	// 2. Trusted Proxy IP -> must NOT be rejected by auth / REST gate (should reach proxy handler: 200 or 502)
	trustedW := httptest.NewRecorder()
	trustedReq := httptest.NewRequest(http.MethodPost, "/api/debug/events", strings.NewReader(`{"kind":"USER_ACTION"}`))
	trustedReq.RemoteAddr = "192.168.10.9:57804"
	srv.handler.ServeHTTP(trustedW, trustedReq)
	if trustedW.Code == http.StatusForbidden || trustedW.Code == http.StatusUnauthorized {
		t.Fatalf("expected trusted proxy debug request to bypass auth/rest gate, but got %d", trustedW.Code)
	}
}

