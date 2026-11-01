package agent

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

type TLSConfig struct {
	Enabled  bool   `yaml:"enabled" json:"enabled"`
	CertFile string `yaml:"cert_file,omitempty" json:"certFile,omitempty"`
	KeyFile  string `yaml:"key_file,omitempty" json:"keyFile,omitempty"`
}

type SandboxConfig struct {
	AllowedRoots []string `yaml:"allowed_roots" json:"allowedRoots"`
	DeniedPaths  []string `yaml:"denied_paths" json:"deniedPaths"`
}

type Config struct {
	Host         string        `yaml:"host" json:"host"`
	Port         int           `yaml:"port" json:"port"`
	TLS          TLSConfig     `yaml:"tls" json:"tls"`
	Adopted      bool          `yaml:"adopted" json:"adopted"`
	Master       MasterAuth    `yaml:"master" json:"master"`
	Sandbox      SandboxConfig `yaml:"sandbox" json:"sandbox"`
	ScopedTokens []ScopedToken `yaml:"scoped_tokens" json:"scopedTokens"`

	filePath string     `yaml:"-" json:"-"`
	mu       sync.Mutex `yaml:"-" json:"-"`
}

// DefaultConfig returns default configuration for the agent.
func DefaultConfig(configPath string) *Config {
	defaultRoots := []string{"/"}
	if os.PathSeparator == '\\' {
		defaultRoots = []string{"C:\\"}
	}

	return &Config{
		Host:    "0.0.0.0",
		Port:    8085,
		Adopted: false,
		TLS: TLSConfig{
			Enabled: false,
		},
		Master: MasterAuth{
			KeyID:  GenerateRandomToken("cs_master"),
			Secret: GenerateBase32Secret(20),
		},
		Sandbox: SandboxConfig{
			AllowedRoots: defaultRoots,
			DeniedPaths: []string{
				"/etc/shadow",
				"/etc/gshadow",
				"/root/.ssh",
			},
		},
		ScopedTokens: []ScopedToken{},
		filePath:     configPath,
	}
}

// LoadOrInitConfig loads agent.yaml from the specified path or initializes a new one.
func LoadOrInitConfig(configPath string) (*Config, bool, error) {
	if configPath == "" {
		configPath = "agent.yaml"
	}

	// 1. If file does not exist, create default
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		cfg := DefaultConfig(configPath)
		if err := cfg.Save(); err != nil {
			return nil, false, fmt.Errorf("failed to save initial agent.yaml: %w", err)
		}
		return cfg, true, nil
	}

	// 2. Load existing file
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read %s: %w", configPath, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, false, fmt.Errorf("invalid YAML syntax in %s: %w", configPath, err)
	}

	cfg.filePath = configPath
	if cfg.Port <= 0 {
		cfg.Port = 8085
	}
	if cfg.Host == "" {
		cfg.Host = "0.0.0.0"
	}
	if len(cfg.Sandbox.AllowedRoots) == 0 {
		if os.PathSeparator == '\\' {
			cfg.Sandbox.AllowedRoots = []string{"C:\\"}
		} else {
			cfg.Sandbox.AllowedRoots = []string{"/"}
		}
	}

	return &cfg, false, nil
}

// Save writes configuration to disk atomically.
func (c *Config) Save() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}

	dir := filepath.Dir(c.filePath)
	if dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0700)
	}

	tmpFile := c.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0600); err != nil {
		return err
	}

	return os.Rename(tmpFile, c.filePath)
}

// AddScopedToken adds and persists a new scoped token.
func (c *Config) AddScopedToken(id, desc string, topics, roots []string) (*ScopedToken, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("token ID is required")
	}

	for _, t := range c.ScopedTokens {
		if t.ID == id {
			return nil, fmt.Errorf("token with ID %q already exists", id)
		}
	}

	token := &ScopedToken{
		ID:           id,
		Token:        GenerateRandomToken("cs_ro_" + id),
		Description:  desc,
		Topics:       topics,
		AllowedRoots: roots,
		CreatedAt:    strings.Split(yamlTimestamp(), ".")[0] + "Z",
	}

	c.ScopedTokens = append(c.ScopedTokens, *token)

	// Save
	data, err := yaml.Marshal(c)
	if err == nil {
		_ = os.WriteFile(c.filePath, data, 0600)
	}

	return token, nil
}

// DeleteScopedToken removes and persists token deletion.
func (c *Config) DeleteScopedToken(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	idx := -1
	for i, t := range c.ScopedTokens {
		if t.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("token %q not found", id)
	}

	c.ScopedTokens = append(c.ScopedTokens[:idx], c.ScopedTokens[idx+1:]...)

	data, err := yaml.Marshal(c)
	if err == nil {
		_ = os.WriteFile(c.filePath, data, 0600)
	}
	return nil
}

func GenerateBase32Secret(length int) string {
	bytes := make([]byte, length)
	_, _ = rand.Read(bytes)
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(bytes)
}

func yamlTimestamp() string {
	return strings.ReplaceAll(strings.ReplaceAll(os.Getenv("TIME"), " ", "T"), "+", "Z")
}
