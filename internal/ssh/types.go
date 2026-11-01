package ssh

import "time"

// Config defines connection details for an SSH server.
type Config struct {
	Host       string  `json:"host"`
	Port       int     `json:"port"`
	User       string  `json:"user"`
	AuthType   string  `json:"authType"` // "password", "key", "vault"
	Password   string  `json:"password,omitempty"`
	PrivateKey string  `json:"privateKey,omitempty"`
	Passphrase string  `json:"passphrase,omitempty"`
	IdentityID string  `json:"identityId,omitempty"`
	JumpHost   *Config `json:"jumpHost,omitempty"`
	TimeoutSec int     `json:"timeoutSec,omitempty"`
}

// NormalizedTimeout returns connection timeout with a 10s default.
func (c *Config) NormalizedTimeout() time.Duration {
	if c.TimeoutSec <= 0 {
		return 10 * time.Second
	}
	return time.Duration(c.TimeoutSec) * time.Second
}

// NormalizedPort returns port with 22 as default.
func (c *Config) NormalizedPort() int {
	if c.Port <= 0 {
		return 22
	}
	return c.Port
}

// IdentitySecretData represents an Identity stored in the Core Secrets Vault.
type IdentitySecretData struct {
	Type       string `json:"type"` // "key" or "password"
	Password   string `json:"password,omitempty"`
	PrivateKey string `json:"privateKey,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
	PublicKey  string `json:"publicKey,omitempty"`
}

// TestResult represents the result of a connection test.
type TestResult struct {
	Success       bool   `json:"success"`
	ServerVersion string `json:"serverVersion,omitempty"`
	LatencyMs     int64  `json:"latencyMs"`
	Error         string `json:"error,omitempty"`
}

// TerminalInitMessage is sent as the first message over WebSocket to initialize PTY.
type TerminalInitMessage struct {
	Type       string  `json:"type"` // "init"
	Host       string  `json:"host"`
	Port       int     `json:"port"`
	User       string  `json:"user"`
	AuthType   string  `json:"authType"`
	Password   string  `json:"password,omitempty"`
	PrivateKey string  `json:"privateKey,omitempty"`
	Passphrase string  `json:"passphrase,omitempty"`
	IdentityID string  `json:"identityId,omitempty"`
	JumpHost   *Config `json:"jumpHost,omitempty"`
	Cols       int     `json:"cols"`
	Rows       int     `json:"rows"`
	Term       string  `json:"term"`
}

// TerminalControlMessage handles window resize and heartbeat pings.
type TerminalControlMessage struct {
	Type string `json:"type"` // "resize", "ping", "pong"
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// SFTPFileInfo holds file and directory metadata for the SFTP explorer.
type SFTPFileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	IsDir   bool   `json:"isDir"`
	ModTime string `json:"modTime"`
}

// SFTPRequest encapsulates payload for SFTP file operations.
type SFTPRequest struct {
	Host       string  `json:"host"`
	Port       int     `json:"port"`
	User       string  `json:"user"`
	AuthType   string  `json:"authType"`
	Password   string  `json:"password,omitempty"`
	PrivateKey string  `json:"privateKey,omitempty"`
	Passphrase string  `json:"passphrase,omitempty"`
	IdentityID string  `json:"identityId,omitempty"`
	JumpHost   *Config `json:"jumpHost,omitempty"`
	Path       string  `json:"path"`
	Content    string  `json:"content,omitempty"`
	Encoding   string  `json:"encoding,omitempty"` // "utf8" (default) or "base64"
	IsDir      bool    `json:"isDir,omitempty"`
	Mode       uint32  `json:"mode,omitempty"`
	NewPath    string  `json:"newPath,omitempty"`
}
