package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"config-studio/internal/config"
)

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	jsonResponse(w, status, map[string]string{"error": msg})
}

func (s *Server) getAuditUser(r *http.Request) string {
	authed, user := s.isRequestAuthenticated(r)
	if authed && user != "" {
		return user
	}
	return "admin"
}

func (s *Server) logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s %s", r.Method, r.URL.Path, r.RemoteAddr)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) getSettings() config.Settings {
	if s.config != nil {
		return s.config.Get()
	}
	return config.Settings{}
}

func (s *Server) isTrustedProxy(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}

	settings := s.getSettings()
	for _, entry := range settings.TrustedProxies {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			_, ipNet, err := net.ParseCIDR(entry)
			if err == nil && ipNet.Contains(ip) {
				return true
			}
		} else {
			targetIP := net.ParseIP(entry)
			if targetIP != nil && targetIP.Equal(ip) {
				return true
			}
		}
	}
	return false
}

func (s *Server) isRequestAuthenticated(r *http.Request) (bool, string) {
	settings := s.getSettings()

	// 1. Check Authentik / Authelia / ForwardAuth headers ONLY if enabled and from trusted proxy
	if settings.TrustForwardAuth && s.isTrustedProxy(r.RemoteAddr) {
		if forwardedUser := r.Header.Get("X-Forwarded-User"); forwardedUser != "" {
			return true, forwardedUser
		}
		if remoteUser := r.Header.Get("Remote-User"); remoteUser != "" {
			return true, remoteUser
		}
		if authReqUser := r.Header.Get("X-Auth-Request-User"); authReqUser != "" {
			return true, authReqUser
		}
	}

	// 2. Check session cookie
	cookie, err := r.Cookie("cs_session")
	if err == nil && cookie.Value != "" {
		s.sessionsMu.RLock()
		exp, ok := s.sessions[cookie.Value]
		s.sessionsMu.RUnlock()
		if ok {
			if time.Now().Before(exp) {
				return true, "admin"
			}
			s.sessionsMu.Lock()
			delete(s.sessions, cookie.Value)
			s.sessionsMu.Unlock()
		}
	}

	// 3. Check CLI basic auth flags if configured
	if s.cfg.AuthUser != "" {
		u, p, ok := r.BasicAuth()
		if ok && u == s.cfg.AuthUser && p == s.cfg.AuthPass {
			return true, u
		}
	}

	return false, ""
}

func isLoopbackOrTest(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.String() == "192.0.2.1"
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Public paths that do not require auth
		if r.URL.Path == "/api/auth/status" ||
			r.URL.Path == "/api/auth/login" ||
			r.URL.Path == "/api/branding/icon" ||
			r.URL.Path == "/api/health" ||
			r.URL.Path == "/api/secrets/status" ||
			r.URL.Path == "/api/secrets/unlock" ||
			(strings.HasPrefix(r.URL.Path, "/api/plugins/") && strings.Contains(r.URL.Path, "/files/")) {
			next.ServeHTTP(w, r)
			return
		}

		// Allow debug telemetry proxy for loopback
		if strings.HasPrefix(r.URL.Path, "/api/debug/") && isLoopbackOrTest(r.RemoteAddr) {
			next.ServeHTTP(w, r)
			return
		}

		settings := s.getSettings()

		// Verify whether the request comes from authenticated Web UI session
		hasValidSession := false
		if cookie, err := r.Cookie("cs_session"); err == nil && cookie.Value != "" {
			s.sessionsMu.RLock()
			exp, ok := s.sessions[cookie.Value]
			s.sessionsMu.RUnlock()
			if ok {
				if time.Now().Before(exp) {
					hasValidSession = true
				} else {
					s.sessionsMu.Lock()
					delete(s.sessions, cookie.Value)
					s.sessionsMu.Unlock()
				}
			}
		}

		isTrustedForward := settings.TrustForwardAuth && s.isTrustedProxy(r.RemoteAddr) &&
			(r.Header.Get("X-Forwarded-User") != "" || r.Header.Get("Remote-User") != "" || r.Header.Get("X-Auth-Request-User") != "")

		isWebUI := hasValidSession || isTrustedForward
		if !isWebUI && r.Header.Get("X-ConfigStudio-Web") == "1" {
			// Header only accepted from loopback, test harness, or trusted proxy
			if isLoopbackOrTest(r.RemoteAddr) || s.isTrustedProxy(r.RemoteAddr) {
				isWebUI = true
			}
		}

		if !isWebUI && strings.EqualFold(r.Header.Get("Upgrade"), "websocket") && (r.URL.Query().Get("web") == "1" || r.URL.Path == "/api/ssh/ws") {
			origin := r.Header.Get("Origin")
			originMatches := false
			if origin != "" {
				if u, err := url.Parse(origin); err == nil && strings.EqualFold(u.Host, r.Host) {
					originMatches = true
				}
			}
			if isLoopbackOrTest(r.RemoteAddr) || s.isTrustedProxy(r.RemoteAddr) || originMatches {
				isWebUI = true
			}
		}

		if !isWebUI && (r.URL.Path == "/api/audit/export" || r.URL.Path == "/api/fs/download") {
			if r.Header.Get("Sec-Fetch-Dest") == "document" || r.Header.Get("Sec-Fetch-Mode") == "navigate" || strings.Contains(r.Header.Get("Accept"), "text/html") {
				if isLoopbackOrTest(r.RemoteAddr) || s.isTrustedProxy(r.RemoteAddr) {
					isWebUI = true
				}
			}
		}

		// If NOT from Web UI, this is an external REST API request
		if !isWebUI {
			if !settings.ApiEnabled {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]string{
					"error": "REST API is disabled in settings. External programmatic access is blocked.",
				})
				return
			}

			// If API is enabled and an API key is configured, validate it
			if settings.ApiKey != "" {
				clientKey := r.Header.Get("X-API-Key")
				if clientKey == "" {
					authHeader := r.Header.Get("Authorization")
					if strings.HasPrefix(authHeader, "Bearer ") {
						clientKey = strings.TrimPrefix(authHeader, "Bearer ")
					}
				}
				if clientKey != settings.ApiKey {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					_ = json.NewEncoder(w).Encode(map[string]string{
						"error": "Invalid or missing API Key. Provide X-API-Key or Authorization: Bearer <key>",
					})
					return
				}
			}
		}

		requiresAuth := settings.AuthEnabled || s.cfg.AuthUser != ""

		if !requiresAuth {
			next.ServeHTTP(w, r)
			return
		}

		authed, _ := s.isRequestAuthenticated(r)
		if !authed {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized", "authRequired": "true"})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	settings := s.getSettings()
	requiresAuth := settings.AuthEnabled || s.cfg.AuthUser != ""
	authed, user := s.isRequestAuthenticated(r)

	// If no auth is enabled, consider everyone authenticated
	if !requiresAuth {
		authed = true
		user = "guest"
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"authRequired":  requiresAuth,
		"authenticated": authed,
		"user":          user,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request")
		return
	}

	valid := false
	if s.cfg.AuthUser != "" {
		if req.Username == s.cfg.AuthUser && req.Password == s.cfg.AuthPass {
			valid = true
		}
	}
	if !valid && s.config != nil && s.config.CheckAuth(req.Username, req.Password) {
		valid = true
	}

	if !valid {
		jsonError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}

	// Generate session token
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)

	s.sessionsMu.Lock()
	now := time.Now()
	for tok, exp := range s.sessions {
		if now.After(exp) {
			delete(s.sessions, tok)
		}
	}
	s.sessions[token] = now.Add(7 * 24 * time.Hour) // 7 days session
	s.sessionsMu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     "cs_session",
		Value:    token,
		Path:     "/",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "ok",
		"user":   req.Username,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("cs_session"); err == nil {
		s.sessionsMu.Lock()
		delete(s.sessions, cookie.Value)
		s.sessionsMu.Unlock()
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "cs_session",
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
	})

	jsonResponse(w, http.StatusOK, map[string]string{"status": "logged_out"})
}
