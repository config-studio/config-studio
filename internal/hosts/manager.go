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

func (m *Manager) Save(host *Host) (*Host, error) {
	if host == nil {
		return nil, ErrInvalidHost
	}

	host.Normalize()
	if strings.TrimSpace(host.ID) == "" {
		host.ID = fmt.Sprintf("host-%d", time.Now().UnixNano())
	}
	if strings.TrimSpace(host.Host) == "" {
		return nil, fmt.Errorf("%w: host address cannot be empty", ErrInvalidHost)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	existing, exists := m.hosts[host.ID]
	if exists {
		host.CreatedAt = existing.CreatedAt
		host.UpdatedAt = now
	} else {
		host.CreatedAt = now
		host.UpdatedAt = now
		m.order = append(m.order, host.ID)
	}

	m.hosts[host.ID] = host
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

		if item.ID == "" {
			item.ID = fmt.Sprintf("host-%d-%s", time.Now().UnixNano(), strings.ToLower(item.Name))
		}

		existing, exists := m.hosts[item.ID]
		if exists {
			item.CreatedAt = existing.CreatedAt
			item.UpdatedAt = now
			m.hosts[item.ID] = item
			res.Updated++
		} else {
			item.CreatedAt = now
			item.UpdatedAt = now
			m.hosts[item.ID] = item
			m.order = append(m.order, item.ID)
			res.Imported++
		}
		res.HostIDs = append(res.HostIDs, item.ID)
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

		if _, exists := m.hosts[h.ID]; !exists {
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

	for _, h := range sf.Hosts {
		if h != nil && h.ID != "" {
			h.Normalize()
			m.hosts[h.ID] = h
			m.order = append(m.order, h.ID)
		}
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
