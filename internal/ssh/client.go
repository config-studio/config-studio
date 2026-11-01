package ssh

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"config-studio/internal/secrets"

	gossh "golang.org/x/crypto/ssh"
)

// ClientManager handles connection establishment, credential resolution, and bastion jumping.
type ClientManager struct {
	secrets *secrets.Manager
}

// NewClientManager creates a new ClientManager.
func NewClientManager(secMgr *secrets.Manager) *ClientManager {
	return &ClientManager{
		secrets: secMgr,
	}
}

// ResolveCredentials resolves identity credentials from the Core Secrets Vault if IdentityID is specified.
func (m *ClientManager) ResolveCredentials(cfg *Config) error {
	if cfg == nil {
		return errors.New("ssh configuration is nil")
	}

	// If an Identity ID is specified and secrets manager is available, retrieve it from the vault
	if cfg.IdentityID != "" && m.secrets != nil {
		secretVal, err := m.secrets.Get(cfg.IdentityID)
		if err != nil {
			return fmt.Errorf("failed to retrieve identity '%s' from vault: %w", cfg.IdentityID, err)
		}

		trimmed := strings.TrimSpace(secretVal)
		// Check if secret is stored as structured JSON
		if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
			var idData IdentitySecretData
			if err := json.Unmarshal([]byte(trimmed), &idData); err == nil {
				if idData.Password != "" && cfg.Password == "" {
					cfg.Password = idData.Password
				}
				if idData.PrivateKey != "" && cfg.PrivateKey == "" {
					cfg.PrivateKey = idData.PrivateKey
				}
				if idData.Passphrase != "" && cfg.Passphrase == "" {
					cfg.Passphrase = idData.Passphrase
				}
			}
		} else {
			// Plain string secret
			if strings.Contains(trimmed, "PRIVATE KEY") {
				if cfg.PrivateKey == "" {
					cfg.PrivateKey = trimmed
				}
			} else {
				if cfg.Password == "" {
					cfg.Password = trimmed
				}
			}
		}
	}

	// Recursively resolve credentials for JumpHost if configured
	if cfg.JumpHost != nil {
		if err := m.ResolveCredentials(cfg.JumpHost); err != nil {
			return fmt.Errorf("jump host error: %w", err)
		}
	}

	return nil
}

// BuildClientConfig constructs the gossh.ClientConfig with appropriate authentication methods.
func (m *ClientManager) BuildClientConfig(cfg *Config) (*gossh.ClientConfig, error) {
	if err := m.ResolveCredentials(cfg); err != nil {
		return nil, err
	}

	var authMethods []gossh.AuthMethod

	// 1. Private Key Auth
	if cfg.PrivateKey != "" {
		keyBytes := []byte(strings.TrimSpace(cfg.PrivateKey))
		var signer gossh.Signer
		var err error

		if cfg.Passphrase != "" {
			signer, err = gossh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(cfg.Passphrase))
		} else {
			signer, err = gossh.ParsePrivateKey(keyBytes)
		}

		if err != nil {
			return nil, fmt.Errorf("invalid private key: %w", err)
		}
		authMethods = append(authMethods, gossh.PublicKeys(signer))
	}

	// 2. Password Auth
	if cfg.Password != "" {
		pwd := cfg.Password
		authMethods = append(authMethods, gossh.Password(pwd))
		// Also add keyboard-interactive fallback for systems configured with PAM/keyboard-interactive only
		authMethods = append(authMethods, gossh.KeyboardInteractive(
			func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = pwd
				}
				return answers, nil
			},
		))
	}

	if len(authMethods) == 0 {
		return nil, errors.New("no authentication credentials provided (requires password or private key)")
	}

	user := cfg.User
	if user == "" {
		user = "root"
	}

	return &gossh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         cfg.NormalizedTimeout(),
	}, nil
}

// Dial establishes an SSH connection, optionally routing through a Bastion / Jump Host.
func (m *ClientManager) Dial(ctx context.Context, cfg *Config) (*gossh.Client, error) {
	sshConfig, err := m.BuildClientConfig(cfg)
	if err != nil {
		return nil, err
	}

	targetAddr := fmt.Sprintf("%s:%d", cfg.Host, cfg.NormalizedPort())

	// Case 1: Bastion / Jump Host (ProxyJump)
	if cfg.JumpHost != nil && cfg.JumpHost.Host != "" {
		jumpClient, err := m.Dial(ctx, cfg.JumpHost)
		if err != nil {
			return nil, fmt.Errorf("failed to connect to jump host %s:%d: %w", cfg.JumpHost.Host, cfg.JumpHost.NormalizedPort(), err)
		}

		// Dial target via bastion's network channel
		targetConn, err := jumpClient.Dial("tcp", targetAddr)
		if err != nil {
			_ = jumpClient.Close()
			return nil, fmt.Errorf("failed to dial target %s via jump host: %w", targetAddr, err)
		}

		ncc, chans, reqs, err := gossh.NewClientConn(targetConn, targetAddr, sshConfig)
		if err != nil {
			_ = targetConn.Close()
			_ = jumpClient.Close()
			return nil, fmt.Errorf("failed to establish ssh session to %s via jump host: %w", targetAddr, err)
		}

		return gossh.NewClient(ncc, chans, reqs), nil
	}

	// Case 2: Direct Connection
	dialer := &net.Dialer{Timeout: cfg.NormalizedTimeout()}
	conn, err := dialer.DialContext(ctx, "tcp", targetAddr)
	if err != nil {
		return nil, fmt.Errorf("connection failed to %s: %w", targetAddr, err)
	}

	ncc, chans, reqs, err := gossh.NewClientConn(conn, targetAddr, sshConfig)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("handshake failed with %s: %w", targetAddr, err)
	}

	return gossh.NewClient(ncc, chans, reqs), nil
}

// Test checks if an SSH connection can be established successfully and measures latency.
func (m *ClientManager) Test(ctx context.Context, cfg *Config) *TestResult {
	start := time.Now()
	client, err := m.Dial(ctx, cfg)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		return &TestResult{
			Success:   false,
			LatencyMs: latency,
			Error:     err.Error(),
		}
	}
	defer client.Close()

	serverVer := string(client.ServerVersion())
	return &TestResult{
		Success:       true,
		ServerVersion: serverVer,
		LatencyMs:     latency,
	}
}
