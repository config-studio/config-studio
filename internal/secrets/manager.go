package secrets

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	dataDir      string
	metadataFile string
	provider     Provider
	mu           sync.RWMutex
	items        map[string]SecretMeta

	privMu       sync.RWMutex
	privSessions map[string]time.Time
}

func NewManager(dataDir string) (*Manager, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}

	vault, err := NewEncryptedVaultProvider(dataDir)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize vault provider: %w", err)
	}

	provider := NewSystemProvider(vault)

	m := &Manager{
		dataDir:      dataDir,
		metadataFile: filepath.Join(dataDir, "secrets_metadata.json"),
		provider:     provider,
		items:        make(map[string]SecretMeta),
		privSessions: make(map[string]time.Time),
	}

	if err := m.loadMetadata(); err != nil {
		_ = m.saveMetadata()
	}

	return m, nil
}

func (m *Manager) loadMetadata() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.metadataFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var list []SecretMeta
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}

	m.items = make(map[string]SecretMeta, len(list))
	for _, it := range list {
		if it.ID != "" {
			m.items[it.ID] = it
		}
	}

	return nil
}

func (m *Manager) saveMetadata() error {
	m.mu.RLock()
	list := make([]SecretMeta, 0, len(m.items))
	for _, it := range m.items {
		list = append(list, it)
	}
	m.mu.RUnlock()

	sort.Slice(list, func(i, j int) bool {
		return list[i].Title < list[j].Title
	})

	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.metadataFile, data, 0644)
}

func (m *Manager) Status(authEnabled bool, sessionToken string) StoreStatus {
	m.mu.RLock()
	count := len(m.items)
	m.mu.RUnlock()

	return StoreStatus{
		Backend:          m.provider.Name(),
		IsAvailable:      true,
		Count:            count,
		AuthEnabled:      authEnabled,
		PrivilegedActive: m.IsPrivileged(sessionToken),
	}
}

func (m *Manager) List() []SecretMeta {
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make([]SecretMeta, 0, len(m.items))
	for _, it := range m.items {
		res = append(res, it)
	}

	sort.Slice(res, func(i, j int) bool {
		return res[i].Title < res[j].Title
	})

	return res
}

func (m *Manager) ListShared() []SecretMeta {
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make([]SecretMeta, 0)
	for _, it := range m.items {
		if it.Scope == ScopeShared {
			res = append(res, it)
		}
	}

	sort.Slice(res, func(i, j int) bool {
		return res[i].Title < res[j].Title
	})

	return res
}

func (m *Manager) Has(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.items[id]
	return ok
}

func (m *Manager) GetMeta(id string) (SecretMeta, bool) {
	cleanID := strings.TrimSpace(id)
	m.mu.RLock()
	defer m.mu.RUnlock()
	meta, ok := m.items[cleanID]
	return meta, ok
}

func (m *Manager) Get(id string) (string, error) {
	cleanID := strings.TrimSpace(id)
	if cleanID == "" {
		return "", fmt.Errorf("secret ID cannot be empty")
	}

	m.mu.RLock()
	_, exists := m.items[cleanID]
	m.mu.RUnlock()

	if !exists {
		return "", fmt.Errorf("secret '%s' not found", cleanID)
	}

	return m.provider.Get(cleanID)
}

func (m *Manager) Set(item SecretItem) error {
	cleanID := strings.TrimSpace(item.ID)
	if cleanID == "" {
		return fmt.Errorf("secret ID cannot be empty")
	}
	cleanTitle := strings.TrimSpace(item.Title)
	if cleanTitle == "" {
		cleanTitle = cleanID
	}

	// 1. Store secret value in secure provider
	if err := m.provider.Set(cleanID, item.Value); err != nil {
		return fmt.Errorf("failed to save secret to store: %w", err)
	}

	// 2. Update metadata
	m.mu.Lock()
	now := time.Now().UTC().Format(time.RFC3339)
	existing, ok := m.items[cleanID]
	createdAt := now
	if ok && existing.CreatedAt != "" {
		createdAt = existing.CreatedAt
	}

	secType := item.Type
	if secType == "" {
		secType = TypePassword
	}
	secScope := item.Scope
	if secScope == "" {
		secScope = ScopeShared
	}

	meta := SecretMeta{
		ID:        cleanID,
		Title:     cleanTitle,
		Type:      secType,
		Scope:     secScope,
		PluginID:  item.PluginID,
		CreatedAt: createdAt,
		UpdatedAt: now,
	}
	m.items[cleanID] = meta
	m.mu.Unlock()

	return m.saveMetadata()
}

func (m *Manager) Delete(id string) error {
	cleanID := strings.TrimSpace(id)
	if cleanID == "" {
		return fmt.Errorf("secret ID cannot be empty")
	}

	// 1. Remove from secure provider
	_ = m.provider.Delete(cleanID)

	// 2. Remove from metadata
	m.mu.Lock()
	delete(m.items, cleanID)
	m.mu.Unlock()

	return m.saveMetadata()
}

// Privileged Mode Session Management

func (m *Manager) UnlockSession(sessionToken string, duration time.Duration) {
	if sessionToken == "" {
		return
	}
	m.privMu.Lock()
	defer m.privMu.Unlock()
	m.privSessions[sessionToken] = time.Now().Add(duration)
}

func (m *Manager) LockSession(sessionToken string) {
	if sessionToken == "" {
		return
	}
	m.privMu.Lock()
	defer m.privMu.Unlock()
	delete(m.privSessions, sessionToken)
}

func (m *Manager) IsPrivileged(sessionToken string) bool {
	if sessionToken == "" {
		return false
	}
	m.privMu.RLock()
	exp, ok := m.privSessions[sessionToken]
	m.privMu.RUnlock()

	if !ok {
		return false
	}

	if time.Now().After(exp) {
		m.privMu.Lock()
		delete(m.privSessions, sessionToken)
		m.privMu.Unlock()
		return false
	}

	return true
}
