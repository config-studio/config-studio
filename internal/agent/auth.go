package agent

import (
	"crypto/hmac"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type AccessLevel int

const (
	AccessNone AccessLevel = iota
	AccessReadOnly
	AccessReadWrite
)

func (a AccessLevel) String() string {
	switch a {
	case AccessReadOnly:
		return "read_only"
	case AccessReadWrite:
		return "read_write"
	default:
		return "none"
	}
}

// ScopedToken represents a restricted token for telemetry or specific paths.
type ScopedToken struct {
	ID           string   `yaml:"id" json:"id"`
	Token        string   `yaml:"token" json:"token"`
	Description  string   `yaml:"description" json:"description"`
	Topics       []string `yaml:"topics" json:"topics"`             // e.g. ["metrics", "health", "logs:/var/log/nginx"]
	AllowedRoots []string `yaml:"allowed_roots" json:"allowedRoots"` // Optional path restrictions
	CreatedAt    string   `yaml:"created_at" json:"createdAt"`
}

// MasterAuth holds credentials for full host management.
type MasterAuth struct {
	KeyID  string `yaml:"key_id" json:"keyId"`
	Secret string `yaml:"secret" json:"secret"` // Base32 TOTP secret
}

// AuthContext holds evaluated permissions for an incoming request.
type AuthContext struct {
	Level        AccessLevel
	KeyID        string
	IsMaster     bool
	AllowedTopics []string
	AllowedRoots []string
}

// ReplayCache tracks used TOTP steps to prevent packet replay.
type ReplayCache struct {
	mu       sync.Mutex
	used     map[string]time.Time // key: "keyID:step" -> expiration
	cleanup  time.Duration
	stopChan chan struct{}
}

func NewReplayCache() *ReplayCache {
	rc := &ReplayCache{
		used:     make(map[string]time.Time),
		cleanup:  90 * time.Second,
		stopChan: make(chan struct{}),
	}
	// Background cleanup routine
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				rc.purgeOld()
			case <-rc.stopChan:
				return
			}
		}
	}()
	return rc
}

func (rc *ReplayCache) Stop() {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	select {
	case <-rc.stopChan:
	default:
		close(rc.stopChan)
	}
}

func (rc *ReplayCache) purgeOld() {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	now := time.Now()
	for k, exp := range rc.used {
		if now.After(exp) {
			delete(rc.used, k)
		}
	}
}

// CheckAndRecord verifies that the given step/nonce hasn't been used yet.
func (rc *ReplayCache) CheckAndRecord(keyID string, step int64, nonce string) bool {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	key := fmt.Sprintf("%s:%d:%s", keyID, step, nonce)
	now := time.Now()
	if exp, exists := rc.used[key]; exists && now.Before(exp) {
		return false // Replay detected!
	}
	rc.used[key] = now.Add(90 * time.Second)
	return true
}

// Authenticator evaluates requests against master auth and scoped tokens.
type Authenticator struct {
	master       MasterAuth
	scopedTokens []ScopedToken
	replayCache  *ReplayCache
	mu           sync.RWMutex
}

func NewAuthenticator(master MasterAuth, tokens []ScopedToken) *Authenticator {
	return &Authenticator{
		master:       master,
		scopedTokens: tokens,
		replayCache:  NewReplayCache(),
	}
}

func (a *Authenticator) UpdateTokens(tokens []ScopedToken) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.scopedTokens = tokens
}

func (a *Authenticator) GetScopedTokens() []ScopedToken {
	a.mu.RLock()
	defer a.mu.RUnlock()
	result := make([]ScopedToken, len(a.scopedTokens))
	copy(result, a.scopedTokens)
	return result
}

// AuthenticateRequest extracts and verifies credentials from request headers.
func (a *Authenticator) AuthenticateRequest(r *http.Request) (*AuthContext, error) {
	keyID, otp := extractCredentials(r)
	if keyID == "" {
		return nil, errors.New("missing authorization credentials")
	}

	a.mu.RLock()
	defer a.mu.RUnlock()

	// 1. Check Master Key
	if a.master.KeyID != "" && secureCompare(keyID, a.master.KeyID) {
		// Master Key without OTP gives ReadOnly
		if otp == "" {
			return &AuthContext{
				Level:    AccessReadOnly,
				KeyID:    a.master.KeyID,
				IsMaster: true,
			}, nil
		}

		// Master Key with OTP elevates to ReadWrite
		now := time.Now()
		valid, step := ValidateTOTP(a.master.Secret, otp, now, 1, DefaultDigits)
		if !valid {
			return nil, fmt.Errorf("invalid or expired TOTP code")
		}

		nonce := r.Header.Get("X-Nonce")
		if nonce == "" {
			nonce = r.Header.Get("X-Request-ID")
		}

		if nonce != "" && !a.replayCache.CheckAndRecord(a.master.KeyID, step, nonce) {
			return nil, fmt.Errorf("replay detected: this request/nonce was already executed")
		}

		return &AuthContext{
			Level:    AccessReadWrite,
			KeyID:    a.master.KeyID,
			IsMaster: true,
		}, nil
	}

	// 2. Check Scoped Tokens (Strictly ReadOnly, restricted to topics)
	for _, st := range a.scopedTokens {
		if secureCompare(keyID, st.Token) {
			return &AuthContext{
				Level:         AccessReadOnly,
				KeyID:         st.ID,
				IsMaster:      false,
				AllowedTopics: st.Topics,
				AllowedRoots:  st.AllowedRoots,
			}, nil
		}
	}

	return nil, errors.New("invalid credentials")
}

// CanAccessTopic checks if the authenticated context has permission for a topic.
func (a *Authenticator) CanAccessTopic(ctx *AuthContext, topic string) bool {
	if ctx == nil || ctx.Level == AccessNone {
		return false
	}
	if ctx.IsMaster {
		return true // Master has access to all topics
	}
	for _, t := range ctx.AllowedTopics {
		if t == "*" || t == topic {
			return true
		}
		// Prefix matching for e.g. "logs:/var/log/nginx" or "configs:/etc/nginx"
		if strings.HasSuffix(t, "*") && strings.HasPrefix(topic, strings.TrimSuffix(t, "*")) {
			return true
		}
		if t == strings.Split(topic, ":")[0] {
			return true
		}
	}
	return false
}

// CanAccessPath verifies filesystem path access.
func (a *Authenticator) CanAccessPath(ctx *AuthContext, targetPath string, isWrite bool) bool {
	if ctx == nil || ctx.Level == AccessNone {
		return false
	}
	if isWrite && ctx.Level < AccessReadWrite {
		return false // Writing requires ReadWrite
	}
	if ctx.IsMaster && len(ctx.AllowedRoots) == 0 {
		return true
	}

	cleanTarget := filepath.Clean(targetPath)
	roots := ctx.AllowedRoots
	if len(roots) == 0 && !ctx.IsMaster {
		// If scoped token didn't specify roots, infer from topic rules
		for _, top := range ctx.AllowedTopics {
			if strings.HasPrefix(top, "configs:") {
				roots = append(roots, strings.TrimPrefix(top, "configs:"))
			} else if strings.HasPrefix(top, "logs:") {
				roots = append(roots, strings.TrimPrefix(top, "logs:"))
			}
		}
	}

	for _, root := range roots {
		cleanRoot := filepath.Clean(root)
		if cleanRoot == "/" || cleanTarget == cleanRoot || strings.HasPrefix(cleanTarget, cleanRoot+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func extractCredentials(r *http.Request) (string, string) {
	// 1. Try explicit headers
	headerKey := r.Header.Get("X-CS-Agent-Key")
	headerOTP := r.Header.Get("X-CS-Agent-OTP")
	if headerKey != "" {
		return headerKey, headerOTP
	}

	// 2. Try Authorization: Bearer <key> or Bearer <key>:<otp>
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if idx := strings.LastIndex(token, ":"); idx != -1 {
			// Check if suffix looks like a 6-digit TOTP
			possibleOTP := token[idx+1:]
			if len(possibleOTP) == 6 && isDigitsOnly(possibleOTP) {
				return token[:idx], possibleOTP
			}
		}
		return token, ""
	}

	return "", ""
}

func isDigitsOnly(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func secureCompare(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

// GenerateRandomToken generates a cryptographically secure hex token with a prefix.
func GenerateRandomToken(prefix string) string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic("crypto/rand failure: " + err.Error())
	}
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(bytes))
}
