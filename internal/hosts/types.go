package hosts

import "time"

// AuthType represents the authentication method for an SSH connection.
type AuthType string

const (
	AuthTypeVault      AuthType = "vault"
	AuthTypePassword   AuthType = "password"
	AuthTypePrivateKey AuthType = "private_key"
	AuthTypeAgent      AuthType = "agent"
	AuthTypeNone       AuthType = "none"
)

// Host represents a core server host configuration.
type Host struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Host        string    `json:"host"`                  // IP address or hostname
	Address     string    `json:"address,omitempty"`     // Alias for Host for backwards compatibility
	Port        int       `json:"port"`                  // Port (default 22)
	User        string    `json:"user"`                  // Username
	Username    string    `json:"username,omitempty"` // Alias for User
	AuthType    AuthType  `json:"authType"`
	IdentityID  string    `json:"identityId,omitempty"` // ID of the secret in Core Secrets Vault
	SecretID    string    `json:"secretId,omitempty"`   // Alias for IdentityID
	Password    string    `json:"password,omitempty"`   // Direct password if not using vault
	PrivateKey  string    `json:"privateKey,omitempty"` // Direct private key if not using vault
	Passphrase  string    `json:"passphrase,omitempty"`
	JumpHostID  string    `json:"jumpHostId,omitempty"`
	ProxyJump   string    `json:"proxyJump,omitempty"`
	DefaultPath string    `json:"defaultPath,omitempty"`
	Group       string    `json:"group,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	Color       string    `json:"color,omitempty"`
	Icon        string    `json:"icon,omitempty"`
	Description string    `json:"description,omitempty"`
	TimeoutSec  int       `json:"timeoutSec,omitempty"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
}

// NormalizedPort returns port with 22 as default.
func (h *Host) NormalizedPort() int {
	if h.Port <= 0 {
		return 22
	}
	return h.Port
}

// Normalize ensures canonical fields are populated.
func (h *Host) Normalize() {
	if h.Host == "" && h.Address != "" {
		h.Host = h.Address
	}
	if h.Address == "" && h.Host != "" {
		h.Address = h.Host
	}

	if h.User == "" && h.Username != "" {
		h.User = h.Username
	}
	if h.Username == "" && h.User != "" {
		h.Username = h.User
	}

	if h.IdentityID == "" && h.SecretID != "" {
		h.IdentityID = h.SecretID
	}
	if h.SecretID == "" && h.IdentityID != "" {
		h.SecretID = h.IdentityID
	}

	if h.Port <= 0 {
		h.Port = 22
	}

	if h.AuthType == "" {
		if h.IdentityID != "" {
			h.AuthType = AuthTypeVault
		} else if h.PrivateKey != "" {
			h.AuthType = AuthTypePrivateKey
		} else if h.Password != "" {
			h.AuthType = AuthTypePassword
		} else {
			h.AuthType = AuthTypeNone
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if h.CreatedAt == "" {
		h.CreatedAt = now
	}
	if h.UpdatedAt == "" {
		h.UpdatedAt = now
	}
}

// StoreFile represents the JSON structure on disk (data/hosts.json).
type StoreFile struct {
	Version   int      `json:"version"`
	UpdatedAt string   `json:"updatedAt"`
	Hosts     []*Host  `json:"hosts"`
}

// OpenSSHImportResult provides summary of an OpenSSH config import.
type OpenSSHImportResult struct {
	TotalParsed int      `json:"totalParsed"`
	Imported    int      `json:"imported"`
	Updated     int      `json:"updated"`
	Skipped     int      `json:"skipped"`
	Errors      []string `json:"errors,omitempty"`
	HostIDs     []string `json:"hostIds"`
}
