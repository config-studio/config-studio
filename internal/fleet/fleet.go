package fleet

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

var idRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// RolloutHooks defines lifecycle validation and restart commands.
type RolloutHooks struct {
	PreApply    string `json:"preApply,omitempty" yaml:"pre_apply,omitempty"`
	PostApply   string `json:"postApply,omitempty" yaml:"post_apply,omitempty"`
	HealthCheck string `json:"healthCheck,omitempty" yaml:"health_check,omitempty"`
}

// RolloutConfig defines fleet rollout and canary strategies.
type RolloutConfig struct {
	Canary bool         `json:"canary" yaml:"canary"`
	Order  int          `json:"order,omitempty" yaml:"order,omitempty"`
	Hooks  RolloutHooks `json:"hooks,omitempty" yaml:"hooks,omitempty"`
}

// SSHConnectionConfig defines native SSH/SFTP access parameters.
type SSHConnectionConfig struct {
	Enabled   bool   `json:"enabled" yaml:"enabled"`
	Host      string `json:"host,omitempty" yaml:"host,omitempty"`
	Port      int    `json:"port,omitempty" yaml:"port,omitempty"`
	User      string `json:"user,omitempty" yaml:"user,omitempty"`
	Identity  string `json:"identity,omitempty" yaml:"identity,omitempty"` // Core Vault reference (e.g. "vault:key-id")
	ProxyJump string `json:"proxyJump,omitempty" yaml:"proxy_jump,omitempty"`
	Sudo      bool   `json:"sudo,omitempty" yaml:"sudo,omitempty"`
}

// AgentConnectionConfig defines Remote Agent daemon parameters.
type AgentConnectionConfig struct {
	Enabled     bool   `json:"enabled" yaml:"enabled"`
	URL         string `json:"url,omitempty" yaml:"url,omitempty"`
	VaultSecret string `json:"vaultSecret,omitempty" yaml:"vault_secret,omitempty"` // Core Vault reference (e.g. "vault:agent-id")
	TLSVerify   bool   `json:"tlsVerify" yaml:"tls_verify"`
}

// ConnectionConfig holds supported protocols for a node.
type ConnectionConfig struct {
	SSH   *SSHConnectionConfig   `json:"ssh,omitempty" yaml:"ssh,omitempty"`
	Agent *AgentConnectionConfig `json:"agent,omitempty" yaml:"agent,omitempty"`
}

// ServerNode represents a registered fleet server in servers.yaml.
type ServerNode struct {
	ID          string            `json:"id" yaml:"id"`
	Name        string            `json:"name" yaml:"name"`
	Description string            `json:"description,omitempty" yaml:"description,omitempty"`
	Group       string            `json:"group,omitempty" yaml:"group,omitempty"`
	Tags        []string          `json:"tags,omitempty" yaml:"tags,omitempty"`
	Icon        string            `json:"icon,omitempty" yaml:"icon,omitempty"`
	Color       string            `json:"color,omitempty" yaml:"color,omitempty"`

	// Top-level convenience shortcuts (for single-VPS minimal configs)
	Host        string            `json:"host,omitempty" yaml:"host,omitempty"`
	User        string            `json:"user,omitempty" yaml:"user,omitempty"`
	Port        int               `json:"port,omitempty" yaml:"port,omitempty"`
	Identity    string            `json:"identity,omitempty" yaml:"identity,omitempty"`

	Connection  ConnectionConfig  `json:"connection,omitempty" yaml:"connection,omitempty"`
	Rollout     *RolloutConfig    `json:"rollout,omitempty" yaml:"rollout,omitempty"`
}

// Normalize ensures convenient top-level parameters are reflected in Connection structures.
func (s *ServerNode) Normalize() {
	if s.Tags == nil {
		s.Tags = make([]string, 0)
	}
	if s.Host != "" && s.Connection.SSH == nil {
		port := s.Port
		if port <= 0 {
			port = 22
		}
		user := s.User
		if user == "" {
			user = "root"
		}
		s.Connection.SSH = &SSHConnectionConfig{
			Enabled:  true,
			Host:     s.Host,
			Port:     port,
			User:     user,
			Identity: s.Identity,
		}
	}
	if s.Connection.SSH != nil && s.Connection.SSH.Port <= 0 {
		s.Connection.SSH.Port = 22
	}
}

// ServersConfigFile represents the root schema of servers.yaml.
type ServersConfigFile struct {
	Version string                 `json:"version" yaml:"version"`
	Presets map[string]interface{} `json:"presets,omitempty" yaml:"presets,omitempty"`
	Servers []ServerNode           `json:"servers" yaml:"servers"`
}

// Manager manages the fleet inventory and persistent servers.yaml storage.
type Manager struct {
	dataDir        string
	filePath       string
	lastLoadedTime time.Time
	mu             sync.RWMutex
	servers        []ServerNode
	presets        map[string]interface{}
}

// NewManager initializes the Manager and loads or creates servers.yaml.
func NewManager(dataDir string) (*Manager, error) {
	absData, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(absData, 0755); err != nil {
		return nil, err
	}

	m := &Manager{
		dataDir:  absData,
		filePath: filepath.Join(absData, "servers.yaml"),
		servers:  make([]ServerNode, 0),
		presets:  make(map[string]interface{}),
	}

	if _, err := os.Stat(m.filePath); os.IsNotExist(err) {
		// Initialize with Localhost default node
		defaultNode := ServerNode{
			ID:          "localhost",
			Name:        "Localhost (Этот ПК)",
			Description: "Локальный хост Config Studio",
			Group:       "Local",
			Tags:        []string{"local", "host"},
			Icon:        "host",
			Color:       "#10b981",
		}
		m.servers = append(m.servers, defaultNode)
		if err := m.saveLocked(); err != nil {
			return nil, fmt.Errorf("failed to create initial servers.yaml: %w", err)
		}
	} else {
		if err := m.load(); err != nil {
			return nil, fmt.Errorf("failed to load servers.yaml: %w", err)
		}
	}

	return m, nil
}

// load parses the servers.yaml file into memory.
func (m *Manager) load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return err
	}

	var cfg ServersConfigFile
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("unmarshal error: %w", err)
	}

	for i := range cfg.Servers {
		cfg.Servers[i].Normalize()
	}

	m.servers = cfg.Servers
	if cfg.Presets != nil {
		m.presets = cfg.Presets
	} else {
		m.presets = make(map[string]interface{})
	}

	fi, _ := os.Stat(m.filePath)
	if fi != nil {
		m.lastLoadedTime = fi.ModTime()
	}

	return nil
}

// maybeReload reloads the file if it was modified on disk by an external process.
func (m *Manager) maybeReload() {
	fi, err := os.Stat(m.filePath)
	if err != nil {
		return
	}
	if fi.ModTime().After(m.lastLoadedTime) {
		_ = m.load()
	}
}

// saveLocked writes the in-memory state to servers.yaml. Must be called under lock.
func (m *Manager) saveLocked() error {
	cfg := ServersConfigFile{
		Version: "1",
		Presets: m.presets,
		Servers: m.servers,
	}

	data, err := yaml.Marshal(&cfg)
	if err != nil {
		return err
	}

	header := []byte("# servers.yaml — Config Studio Fleet Inventory\n")
	content := append(header, data...)

	tmpPath := m.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, content, 0644); err != nil {
		return err
	}

	if err := os.Rename(tmpPath, m.filePath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}

	fi, _ := os.Stat(m.filePath)
	if fi != nil {
		m.lastLoadedTime = fi.ModTime()
	}

	return nil
}

// ListServers returns a copy of all registered servers.
func (m *Manager) ListServers() []ServerNode {
	m.maybeReload()
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make([]ServerNode, len(m.servers))
	copy(res, m.servers)
	return res
}

// GetServer finds a server by its unique ID.
func (m *Manager) GetServer(id string) (*ServerNode, error) {
	m.maybeReload()
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, s := range m.servers {
		if s.ID == id {
			copy := s
			return &copy, nil
		}
	}
	return nil, fmt.Errorf("server %q not found", id)
}

// AddOrUpdateServer inserts or updates a server node in servers.yaml.
func (m *Manager) AddOrUpdateServer(srv ServerNode) error {
	if srv.ID == "" {
		return errors.New("server id cannot be empty")
	}
	if !idRegex.MatchString(srv.ID) {
		return errors.New("server id must contain only alphanumeric characters, dashes, or underscores")
	}
	if strings.TrimSpace(srv.Name) == "" {
		srv.Name = srv.ID
	}

	srv.Normalize()

	m.mu.Lock()
	defer m.mu.Unlock()

	found := false
	for i, s := range m.servers {
		if s.ID == srv.ID {
			m.servers[i] = srv
			found = true
			break
		}
	}

	if !found {
		m.servers = append(m.servers, srv)
	}

	return m.saveLocked()
}

// DeleteServer removes a server from servers.yaml.
func (m *Manager) DeleteServer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var updated []ServerNode
	for _, s := range m.servers {
		if s.ID != id {
			updated = append(updated, s)
		}
	}

	if len(updated) == len(m.servers) {
		return fmt.Errorf("server %q not found", id)
	}

	m.servers = updated
	return m.saveLocked()
}

// GetRawYAML returns the raw string content of servers.yaml.
func (m *Manager) GetRawYAML() (string, error) {
	m.maybeReload()
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SetRawYAML validates and saves raw string content to servers.yaml.
func (m *Manager) SetRawYAML(rawContent string) error {
	var cfg ServersConfigFile
	if err := yaml.Unmarshal([]byte(rawContent), &cfg); err != nil {
		return fmt.Errorf("invalid YAML syntax: %w", err)
	}

	seenIDs := make(map[string]bool)
	for i := range cfg.Servers {
		s := &cfg.Servers[i]
		if s.ID == "" {
			return errors.New("all servers must have an 'id'")
		}
		if !idRegex.MatchString(s.ID) {
			return fmt.Errorf("invalid server id %q: must match [a-zA-Z0-9_-]+", s.ID)
		}
		if seenIDs[s.ID] {
			return fmt.Errorf("duplicate server id %q", s.ID)
		}
		seenIDs[s.ID] = true
		s.Normalize()
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	tmpPath := m.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, []byte(rawContent), 0644); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, m.filePath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}

	m.servers = cfg.Servers
	if cfg.Presets != nil {
		m.presets = cfg.Presets
	}
	fi, _ := os.Stat(m.filePath)
	if fi != nil {
		m.lastLoadedTime = fi.ModTime()
	}

	return nil
}

// PingResult describes the connectivity status of a server node.
type PingResult struct {
	ID        string `json:"id"`
	Status    string `json:"status"` // "online", "ro", "offline"
	LatencyMs int64  `json:"latencyMs"`
	Protocol  string `json:"protocol"` // "agent", "ssh", "local"
	Error     string `json:"error,omitempty"`
}

// Ping probes connectivity to a server node (via Agent HTTP or SSH TCP).
func (m *Manager) Ping(ctx context.Context, id string) PingResult {
	srv, err := m.GetServer(id)
	if err != nil {
		return PingResult{ID: id, Status: "offline", Error: err.Error()}
	}

	if srv.ID == "localhost" || srv.Group == "Local" {
		return PingResult{
			ID:        id,
			Status:    "online",
			LatencyMs: 0,
			Protocol:  "local",
		}
	}

	start := time.Now()

	// 1. Try Remote Agent HTTP health probe if enabled
	if srv.Connection.Agent != nil && srv.Connection.Agent.Enabled && srv.Connection.Agent.URL != "" {
		healthURL := strings.TrimRight(srv.Connection.Agent.URL, "/") + "/health"
		req, err := http.NewRequestWithContext(ctx, "GET", healthURL, nil)
		if err == nil {
			client := &http.Client{Timeout: 3 * time.Second}
			resp, err := client.Do(req)
			if err == nil {
				_ = resp.Body.Close()
				latency := time.Since(start).Milliseconds()
				if resp.StatusCode == 200 {
					return PingResult{
						ID:        id,
						Status:    "online",
						LatencyMs: latency,
						Protocol:  "agent",
					}
				}
			}
		}
	}

	// 2. Try SSH TCP ping probe if enabled
	if srv.Connection.SSH != nil && srv.Connection.SSH.Enabled && srv.Connection.SSH.Host != "" {
		port := srv.Connection.SSH.Port
		if port <= 0 {
			port = 22
		}
		target := fmt.Sprintf("%s:%d", srv.Connection.SSH.Host, port)
		dialer := net.Dialer{Timeout: 3 * time.Second}
		conn, err := dialer.DialContext(ctx, "tcp", target)
		if err == nil {
			_ = conn.Close()
			latency := time.Since(start).Milliseconds()
			return PingResult{
				ID:        id,
				Status:    "online",
				LatencyMs: latency,
				Protocol:  "ssh",
			}
		}
		return PingResult{
			ID:        id,
			Status:    "offline",
			LatencyMs: time.Since(start).Milliseconds(),
			Protocol:  "ssh",
			Error:     err.Error(),
		}
	}

	return PingResult{
		ID:       id,
		Status:   "offline",
		Protocol: "none",
		Error:    "no active connection protocol configured (SSH or Agent)",
	}
}
