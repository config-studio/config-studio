package hosts

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

var (
	ErrHostNotFound = errors.New("host not found")
	ErrInvalidHost  = errors.New("invalid host: id, host, and user are required")
)

type Manager struct {
	dataDir  string
	filePath string
	mu       sync.RWMutex
	hosts    map[string]*Host
	order    []string
}

func NewManager(dataDir string) (*Manager, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create hosts data directory: %w", err)
	}

	filePath := filepath.Join(dataDir, "hosts.json")
	m := &Manager{
		dataDir:  dataDir,
		filePath: filePath,
		hosts:    make(map[string]*Host),
		order:    make([]string, 0),
	}

	if err := m.load(); err != nil {
		if os.IsNotExist(err) {
			// Check if we can auto-migrate from legacy data/servers.yaml
			serversYamlPath := filepath.Join(dataDir, "servers.yaml")
			_ = m.AutoMigrateFromFleet(serversYamlPath)
		} else {
			return nil, fmt.Errorf("failed to load hosts: %w", err)
		}
	}

	return m, nil
}

func (m *Manager) List() []*Host {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*Host, 0, len(m.order))
	for _, id := range m.order {
		if h, ok := m.hosts[id]; ok {
			cp := *h
			result = append(result, &cp)
		}
	}
	return result
}

func (m *Manager) Get(id string) (*Host, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	h, ok := m.hosts[id]
	if !ok {
		return nil, ErrHostNotFound
	}
	cp := *h
	return &cp, nil
}

func endpointKey(h *Host) string {
	if h == nil {
		return ""
	}
	return fmt.Sprintf("%s@%s:%d", strings.ToLower(strings.TrimSpace(h.User)), strings.ToLower(strings.TrimSpace(h.Host)), h.NormalizedPort())
}

func (m *Manager) findExistingMatchLocked(target *Host) *Host {
	if target == nil {
		return nil
	}
	// 1. Exact ID match
	if target.ID != "" {
		if existing, ok := m.hosts[target.ID]; ok {
			return existing
		}
		// Match between "alpine-01" and "host-alpine-01"
		trimmedID := strings.TrimPrefix(target.ID, "host-")
		if trimmedID != target.ID {
			if existing, ok := m.hosts[trimmedID]; ok {
				return existing
			}
		}
		withHostPrefix := "host-" + target.ID
		if existing, ok := m.hosts[withHostPrefix]; ok {
			return existing
		}
	}

	// 2. Exact Endpoint match (user@host:port)
	targetKey := endpointKey(target)
	if targetKey != "" && target.Host != "" {
		for _, existing := range m.hosts {
			if endpointKey(existing) == targetKey {
				return existing
			}
		}
	}

	return nil
}

func mergeHost(dest, src *Host) {
	if dest == nil || src == nil {
		return
	}
	if src.Name != "" && (dest.Name == "" || dest.Name == dest.Host) {
		dest.Name = src.Name
	}
	if src.DefaultPath != "" {
		dest.DefaultPath = src.DefaultPath
	}
	if src.IdentityID != "" && dest.IdentityID == "" {
		dest.IdentityID = src.IdentityID
	}
	if src.SecretID != "" && dest.SecretID == "" {
		dest.SecretID = src.SecretID
	}
	if src.AuthType != "" && (dest.AuthType == "" || dest.AuthType == AuthTypePassword) {
		dest.AuthType = src.AuthType
	}
	if src.Group != "" && dest.Group == "" {
		dest.Group = src.Group
	}
	if src.Color != "" && dest.Color == "" {
		dest.Color = src.Color
	}
	if src.Icon != "" && dest.Icon == "" {
		dest.Icon = src.Icon
	}
	if src.Description != "" && dest.Description == "" {
		dest.Description = src.Description
	}
	if src.ProxyJump != "" && dest.ProxyJump == "" {
		dest.ProxyJump = src.ProxyJump
	}
	if src.TimeoutSec > 0 && dest.TimeoutSec <= 0 {
		dest.TimeoutSec = src.TimeoutSec
	}

	if len(src.Tags) > 0 {
		tagSet := make(map[string]bool)
		for _, t := range dest.Tags {
			tagSet[t] = true
		}
		for _, t := range src.Tags {
			t = strings.TrimSpace(t)
			if t != "" && !tagSet[t] {
				tagSet[t] = true
				dest.Tags = append(dest.Tags, t)
			}
		}
	}
	dest.Normalize()
}

func (m *Manager) Save(host *Host) (*Host, error) {
	if host == nil {
		return nil, ErrInvalidHost
	}

	host.Normalize()
	if strings.TrimSpace(host.Host) == "" {
		return nil, fmt.Errorf("%w: host address cannot be empty", ErrInvalidHost)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	existing := m.findExistingMatchLocked(host)

	if existing != nil {
		mergeHost(existing, host)
		existing.UpdatedAt = now
		if host.Host != "" {
			existing.Host = host.Host
		}
		if host.Port > 0 {
			existing.Port = host.Port
		}
		if host.User != "" {
			existing.User = host.User
		}
		if host.IdentityID != "" {
			existing.IdentityID = host.IdentityID
		}
		if host.SecretID != "" {
			existing.SecretID = host.SecretID
		}
		if host.AuthType != "" {
			existing.AuthType = host.AuthType
		}
		if host.Name != "" {
			existing.Name = host.Name
		}
		existing.Normalize()

		if err := m.persistLocked(); err != nil {
			return nil, err
		}
		cp := *existing
		return &cp, nil
	}

	if strings.TrimSpace(host.ID) == "" {
		host.ID = fmt.Sprintf("host-%d", time.Now().UnixNano())
	}
	host.CreatedAt = now
	host.UpdatedAt = now
	m.hosts[host.ID] = host
	m.order = append(m.order, host.ID)

	if err := m.persistLocked(); err != nil {
		return nil, err
	}

	cp := *host
	return &cp, nil
}

func (m *Manager) Delete(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.hosts[id]; !ok {
		return ErrHostNotFound
	}

	delete(m.hosts, id)
	newOrder := make([]string, 0, len(m.order)-1)
	for _, existingID := range m.order {
		if existingID != id {
			newOrder = append(newOrder, existingID)
		}
	}
	m.order = newOrder

	return m.persistLocked()
}

func (m *Manager) ImportBatch(items []*Host) (*OpenSSHImportResult, error) {
	res := &OpenSSHImportResult{
		TotalParsed: len(items),
		HostIDs:     make([]string, 0),
		Errors:      make([]string, 0),
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	for _, item := range items {
		if item == nil {
			res.Skipped++
			continue
		}
		item.Normalize()
		if item.Host == "" {
			res.Skipped++
			res.Errors = append(res.Errors, fmt.Sprintf("Skipped host %q: empty address", item.Name))
			continue
		}

		existing := m.findExistingMatchLocked(item)
		if existing != nil {
			mergeHost(existing, item)
			existing.UpdatedAt = now
			res.Updated++
			res.HostIDs = append(res.HostIDs, existing.ID)
		} else {
			if item.ID == "" {
				item.ID = fmt.Sprintf("host-%d-%s", time.Now().UnixNano(), strings.ToLower(item.Name))
			}
			item.CreatedAt = now
			item.UpdatedAt = now
			m.hosts[item.ID] = item
			m.order = append(m.order, item.ID)
			res.Imported++
			res.HostIDs = append(res.HostIDs, item.ID)
		}
	}

	if err := m.persistLocked(); err != nil {
		return nil, err
	}
	return res, nil
}

// AutoMigrateFromFleet imports existing nodes from servers.yaml if present.
func (m *Manager) AutoMigrateFromFleet(yamlPath string) error {
	data, err := os.ReadFile(yamlPath)
	if err != nil {
		return err
	}

	var legacy struct {
		Servers []struct {
			ID          string   `yaml:"id"`
			Name        string   `yaml:"name"`
			Description string   `yaml:"description"`
			Group       string   `yaml:"group"`
			Tags        []string `yaml:"tags"`
			Color       string   `yaml:"color"`
			Icon        string   `yaml:"icon"`
			Connection  struct {
				SSH *struct {
					Enabled   bool   `yaml:"enabled"`
					Host      string `yaml:"host"`
					Port      int    `yaml:"port"`
					User      string `yaml:"user"`
					Identity  string `yaml:"identity"`
					ProxyJump string `yaml:"proxyJump"`
				} `yaml:"ssh"`
			} `yaml:"connection"`
		} `yaml:"servers"`
	}

	if err := yaml.Unmarshal(data, &legacy); err != nil {
		return err
	}

	for _, srv := range legacy.Servers {
		if srv.ID == "localhost" || srv.ID == "local" {
			continue
		}
		sshCfg := srv.Connection.SSH
		if sshCfg == nil || !sshCfg.Enabled || strings.TrimSpace(sshCfg.Host) == "" {
			continue
		}

		h := &Host{
			ID:          srv.ID,
			Name:        srv.Name,
			Host:        sshCfg.Host,
			Port:        sshCfg.Port,
			User:        sshCfg.User,
			IdentityID:  sshCfg.Identity,
			ProxyJump:   sshCfg.ProxyJump,
			Group:       srv.Group,
			Tags:        srv.Tags,
			Color:       srv.Color,
			Icon:        srv.Icon,
			Description: srv.Description,
		}
		h.Normalize()

		existing := m.findExistingMatchLocked(h)
		if existing != nil {
			mergeHost(existing, h)
		} else {
			m.hosts[h.ID] = h
			m.order = append(m.order, h.ID)
		}
	}

	return m.persistLocked()
}

func (m *Manager) load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return err
	}

	var sf StoreFile
	if err := json.Unmarshal(data, &sf); err != nil {
		return err
	}

	m.hosts = make(map[string]*Host)
	m.order = make([]string, 0, len(sf.Hosts))
	hasDuplicates := false

	for _, h := range sf.Hosts {
		if h == nil || h.ID == "" || strings.TrimSpace(h.Host) == "" {
			continue
		}
		h.Normalize()

		existing := m.findExistingMatchLocked(h)
		if existing != nil {
			hasDuplicates = true
			mergeHost(existing, h)
			// Prefer canonical ID (e.g. "alpine-01" instead of "host-alpine-01")
			if strings.HasPrefix(existing.ID, "host-") && !strings.HasPrefix(h.ID, "host-") {
				delete(m.hosts, existing.ID)
				for i, id := range m.order {
					if id == existing.ID {
						m.order[i] = h.ID
						break
					}
				}
				existing.ID = h.ID
				m.hosts[existing.ID] = existing
			}
		} else {
			m.hosts[h.ID] = h
			m.order = append(m.order, h.ID)
		}
	}

	if hasDuplicates {
		_ = m.persistLocked()
	}

	return nil
}

func (m *Manager) persistLocked() error {
	sf := StoreFile{
		Version:   1,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Hosts:     make([]*Host, 0, len(m.order)),
	}

	for _, id := range m.order {
		if h, ok := m.hosts[id]; ok {
			sf.Hosts = append(sf.Hosts, h)
		}
	}

	data, err := json.MarshalIndent(sf, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal hosts: %w", err)
	}

	tmpPath := m.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write tmp hosts file: %w", err)
	}

	if err := os.Rename(tmpPath, m.filePath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to replace hosts file: %w", err)
	}

	return nil
}
