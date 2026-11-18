package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestServer() *Server {
	return NewServer(Config{}, nil, nil, nil, nil, nil, nil)
}

func TestHealthEndpoint(t *testing.T) {
	s := newTestServer()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	s.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var res map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if res["status"] != "ok" {
		t.Fatalf("expected status 'ok', got %v", res["status"])
	}
}

func TestAuthStatusGuestWhenNoAuth(t *testing.T) {
	s := newTestServer()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/status", nil)
	s.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var res map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if res["authRequired"] != false {
		t.Fatalf("expected authRequired false, got %v", res["authRequired"])
	}
	if res["user"] != "guest" {
		t.Fatalf("expected user 'guest', got %v", res["user"])
	}
}

func TestAuthStatusRequiredWhenAuthSet(t *testing.T) {
	s := NewServer(Config{AuthUser: "admin", AuthPass: "secret"}, nil, nil, nil, nil, nil, nil)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/status", nil)
	s.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var res map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if res["authRequired"] != true {
		t.Fatalf("expected authRequired true, got %v", res["authRequired"])
	}
}

func TestLoginAndSessionValidation(t *testing.T) {
	s := NewServer(Config{AuthUser: "admin", AuthPass: "secret123"}, nil, nil, nil, nil, nil, nil)

	// 1. Invalid credentials should fail with 401
	badLoginPayload := []byte(`{"username":"admin","password":"wrong"}`)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(badLoginPayload))
	s.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on bad credentials, got %d", w.Code)
	}

	// 2. Valid credentials should succeed and return session cookie
	loginPayload := []byte(`{"username":"admin","password":"secret123"}`)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginPayload))
	s.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on login, got %d", w.Code)
	}

	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "cs_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil || sessionCookie.Value == "" {
		t.Fatalf("expected cs_session cookie to be set")
	}

	// 3. Request without cookie should be rejected
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	s.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden && w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 403 or 401 for unauthenticated access to /api/workspaces, got %d", w.Code)
	}

	// 4. Request with session cookie should be accepted (not rejected with 403 or 401)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.AddCookie(sessionCookie)
	s.ServeHTTP(w, req)
	if w.Code == http.StatusForbidden || w.Code == http.StatusUnauthorized {
		t.Fatalf("expected session cookie to allow access to /api/workspaces, but got %d", w.Code)
	}
}

func TestDebugLoopbackBypass(t *testing.T) {
	s := NewServer(Config{AuthUser: "admin", AuthPass: "secret"}, nil, nil, nil, nil, nil, nil)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/debug/ping", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	s.ServeHTTP(w, req)

	// Should not be 401 Unauthorized because loopback debug is bypassed
	if w.Code == http.StatusUnauthorized {
		t.Fatalf("expected loopback debug request to bypass auth, but got 401")
	}
}

func TestRemoteProxy_RejectsSSRF(t *testing.T) {
	s := NewServer(Config{}, nil, nil, nil, nil, nil, nil)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/remote-proxy/api/health?target=http://169.254.169.254", nil)
	req.Header.Set("X-ConfigStudio-Web", "1")
	req.RemoteAddr = "127.0.0.1:12345"
	s.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden on SSRF target, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGzip_SkipsNoContentAndNotModified(t *testing.T) {
	s := NewServer(Config{}, nil, nil, nil, nil, nil, nil)

	handler204 := s.gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/test", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	handler204.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content, got %d", w.Code)
	}
	if w.Header().Get("Content-Encoding") == "gzip" {
		t.Errorf("Content-Encoding: gzip must not be set for 204 No Content")
	}
	if len(w.Body.Bytes()) != 0 {
		t.Errorf("expected empty body for 204 No Content, got %d bytes: %v", len(w.Body.Bytes()), w.Body.Bytes())
	}
}
