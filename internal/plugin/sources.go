package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Source struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	URL          string     `json:"url"`
	Official     bool       `json:"official"`
	Enabled      bool       `json:"enabled"`
	LastSync     *time.Time `json:"lastSync,omitempty"`
	PluginsCount int        `json:"pluginsCount"`
}

type CatalogLocale struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
}

type CatalogItem struct {
	ID          string                   `json:"id"`
	Name        string                   `json:"name"`
	Version     string                   `json:"version"`
	Description string                   `json:"description"`
	Author      string                   `json:"author"`
	License     string                   `json:"license,omitempty"`
	Homepage    string                   `json:"homepage,omitempty"`
	DownloadURL string                   `json:"downloadUrl"`
	SourceID    string                   `json:"sourceId"`
	Official    bool                     `json:"official"`
	Installed   bool                     `json:"installed"`
	Enabled     bool                     `json:"enabled"`
	Icon        string                   `json:"icon,omitempty"`
	Tags        []string                 `json:"tags,omitempty"`
	Locales     map[string]CatalogLocale `json:"locales,omitempty"`
}

type SourcesManager struct {
	sourcesFile string
	cacheFile   string
	mu          sync.RWMutex
	sources     []Source
	client      *http.Client
}

func DefaultSources() []Source {
	return []Source{
		{
			ID:           "official",
			Name:         "Config Studio Official Catalog",
			URL:          "https://raw.githubusercontent.com/EdvardBaldanov/config-studio-plugins/main/registry.json",
			Official:     true,
			Enabled:      true,
			PluginsCount: 0,
		},
		{
			ID:           "community",
			Name:         "Config Studio Community",
			URL:          "https://raw.githubusercontent.com/EdvardBaldanov/config-studio-community-plugins/main/registry.json",
			Official:     false,
			Enabled:      false,
			PluginsCount: 0,
		},
	}
}

var defaultFallbackCatalogJSON = []byte(`[
  {
    "id": "web-devkit",
    "name": "Web DevKit v1.3.2",
    "version": "1.3.2",
    "description": "HTML & PHP Live Preview с симуляцией вкладки Chrome, сервер :8085, AST-структура и автодополнение",
    "author": "Config Studio Team",
    "downloadUrl": "https://github.com/EdvardBaldanov/config-studio-web-devkit/releases/latest/download/web-devkit.cspkg",
    "sourceId": "official",
    "official": true,
    "icon": "🌐",
    "tags": ["HTML", "PHP", "Live Preview", "Server"],
    "locales": {
      "ru": {
        "name": "Web DevKit v1.3.2",
        "description": "Живой предпросмотр HTML/PHP с вкладкой браузера Chrome, веб-сервер :8085, AST-структура и автодополнение Monaco"
      },
      "en": {
        "name": "Web DevKit v1.3.2",
        "description": "HTML & PHP Live Preview with Chrome browser tab simulation, :8085 server, AST structure, and Monaco completions"
      }
    }
  },
  {
    "id": "remote-agent",
    "name": "Remote Server Agent v2.1",
    "version": "2.1.1",
    "description": "Управление парком удаленных серверов (VPS, хосты), 1-Click Adopt сопряжение, двухсоставная TOTP авторизация и переключение между ними из шапки редактора",
    "author": "Config Studio Team",
    "downloadUrl": "https://raw.githubusercontent.com/EdvardBaldanov/config-studio-plugins/main/packages/remote-agent.cspkg",
    "sourceId": "official",
    "official": true,
    "icon": "🖥️",
    "tags": ["Multi-Server", "VPS", "Agent", "Remote", "Security", "TOTP"],
    "locales": {
      "ru": {
        "name": "Удаленный агент серверов v2.0",
        "description": "Управление парком удаленных серверов, безопасная TOTP авторизация и мгновенное переключение между ними из шапки редактора"
      },
      "en": {
        "name": "Remote Server Agent v2.0",
        "description": "Manage fleet of remote servers, secure two-tier TOTP authorization and instant switching directly from the header"
      }
    }
  },
  {
    "id": "lang-en",
    "name": "English Language Pack",
    "version": "1.0.0",
    "description": "Full English localization for Config Studio UI 🇬🇧",
    "author": "Edvard Baldanov",
    "downloadUrl": "https://github.com/EdvardBaldanov/config-studio-lang-en/releases/latest/download/lang-en.cspkg",
    "sourceId": "official",
    "official": true,
    "icon": "🇬🇧",
    "tags": ["Localization", "Language", "English"]
  },
  {
    "id": "lang-ru",
    "name": "Русский языковой пакет",
    "version": "1.0.0",
    "description": "Полная русская локализация интерфейса Config Studio 🇷🇺",
    "author": "Edvard Baldanov",
    "downloadUrl": "https://github.com/EdvardBaldanov/config-studio-lang-ru/releases/latest/download/lang-ru.cspkg",
    "sourceId": "official",
    "official": true,
    "icon": "🇷🇺",
    "tags": ["Localization", "Language", "Russian"]
  },
  {
    "id": "ssh",
    "name": "SSH & SFTP Manager",
    "version": "1.0.2",
    "description": "Интерактивный Web SSH терминал (PTY), SFTP проводник файлов, хранилище ключей (UniSSH Vault) и Bastion ProxyJump",
    "author": "Config Studio Team",
    "downloadUrl": "https://raw.githubusercontent.com/EdvardBaldanov/config-studio-plugins/main/packages/ssh.cspkg",
    "homepage": "https://github.com/EdvardBaldanov/config-studio-ssh",
    "sourceId": "official",
    "official": true,
    "icon": "💻",
    "tags": ["SSH", "SFTP", "Terminal", "PTY", "Vault", "Bastion"],
    "locales": {
      "ru": {
        "name": "SSH & SFTP Менеджер",
        "description": "Интерактивный Web SSH терминал (PTY), SFTP проводник файлов, хранилище ключей (UniSSH Vault) и Bastion ProxyJump"
      },
      "en": {
        "name": "SSH & SFTP Manager",
        "description": "Interactive Web SSH terminal (PTY), SFTP file explorer, key vault (UniSSH pattern) and Bastion ProxyJump"
      }
    }
  }
]`)

func NewSourcesManager(pluginsDir string) (*SourcesManager, error) {
	if err := os.MkdirAll(pluginsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create plugins dir: %w", err)
	}

	sm := &SourcesManager{
		sourcesFile: filepath.Join(pluginsDir, "sources.json"),
		cacheFile:   filepath.Join(pluginsDir, "catalog_cache.json"),
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}

	sm.loadSources()

	// If catalog_cache.json doesn't exist, initialize with bundled fallback
	if _, err := os.Stat(sm.cacheFile); os.IsNotExist(err) {
		_ = os.WriteFile(sm.cacheFile, defaultFallbackCatalogJSON, 0644)
		// And start background sync with upstream GitHub
		go func() {
			_, _ = sm.SyncSources(nil)
		}()
	}

	return sm, nil
}

func (sm *SourcesManager) loadSources() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	data, err := os.ReadFile(sm.sourcesFile)
	if err != nil {
		sm.sources = DefaultSources()
		_ = sm.saveSourcesLocked()
		return
	}

	var loaded []Source
	if err := json.Unmarshal(data, &loaded); err != nil || len(loaded) == 0 {
		sm.sources = DefaultSources()
		_ = sm.saveSourcesLocked()
		return
	}

	// Guarantee official source always exists
	hasOfficial := false
	for _, s := range loaded {
		if s.ID == "official" {
			hasOfficial = true
			break
		}
	}
	if !hasOfficial {
		loaded = append([]Source{DefaultSources()[0]}, loaded...)
	}

	sm.sources = loaded
}

func (sm *SourcesManager) saveSourcesLocked() error {
	data, err := json.MarshalIndent(sm.sources, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(sm.sourcesFile, data, 0644)
}

func (sm *SourcesManager) ListSources() []Source {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	res := make([]Source, len(sm.sources))
	copy(res, sm.sources)
	return res
}

func (sm *SourcesManager) AddSource(src Source) (*Source, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	src.URL = strings.TrimSpace(src.URL)
	if src.URL == "" {
		return nil, errors.New("source URL cannot be empty")
	}

	src.Name = strings.TrimSpace(src.Name)
	if src.Name == "" {
		src.Name = "Custom Plugin Catalog"
	}

	if src.ID == "" {
		// generate slug from name or timestamp
		slug := strings.ToLower(strings.ReplaceAll(src.Name, " ", "-"))
		src.ID = fmt.Sprintf("src-%s-%d", slug, time.Now().Unix()%10000)
	}

	for _, existing := range sm.sources {
		if existing.ID == src.ID {
			return nil, fmt.Errorf("source with ID %q already exists", src.ID)
		}
		if existing.URL == src.URL {
			return nil, fmt.Errorf("source with URL %q already exists", src.URL)
		}
	}

	src.Official = false
	src.Enabled = true
	src.PluginsCount = 0

	sm.sources = append(sm.sources, src)
	if err := sm.saveSourcesLocked(); err != nil {
		return nil, err
	}

	return &src, nil
}

func (sm *SourcesManager) UpdateSource(id string, update Source) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for i, s := range sm.sources {
		if s.ID == id {
			if s.Official && !update.Official && id == "official" {
				update.Official = true
			}
			if update.Name != "" {
				sm.sources[i].Name = strings.TrimSpace(update.Name)
			}
			if update.URL != "" {
				sm.sources[i].URL = strings.TrimSpace(update.URL)
			}
			sm.sources[i].Enabled = update.Enabled
			return sm.saveSourcesLocked()
		}
	}

	return fmt.Errorf("source with ID %q not found", id)
}

func (sm *SourcesManager) DeleteSource(id string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if id == "official" {
		return errors.New("cannot delete official Config Studio catalog (you can disable it instead)")
	}

	idx := -1
	for i, s := range sm.sources {
		if s.ID == id {
			idx = i
			break
		}
	}

	if idx == -1 {
		return fmt.Errorf("source %q not found", id)
	}

	sm.sources = append(sm.sources[:idx], sm.sources[idx+1:]...)
	return sm.saveSourcesLocked()
}

// SyncSources polls all enabled sources, merges catalogs, updates stats, and writes to cache
func (sm *SourcesManager) SyncSources(installedPlugins []Plugin) ([]CatalogItem, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	var allItems []CatalogItem
	now := time.Now().UTC()

	// Build installed lookup
	installedMap := make(map[string]Plugin)
	for _, p := range installedPlugins {
		installedMap[p.Manifest.ID] = p
	}

	for i, src := range sm.sources {
		if !src.Enabled {
			continue
		}

		items, err := sm.fetchCatalog(src)
		if err != nil {
			// Do not crash the entire sync on single source failure
			continue
		}

		sm.sources[i].LastSync = &now
		sm.sources[i].PluginsCount = len(items)

		for _, item := range items {
			item.SourceID = src.ID
			item.Official = src.Official

			if p, ok := installedMap[item.ID]; ok {
				item.Installed = true
				item.Enabled = p.Enabled
			}

			allItems = append(allItems, item)
		}
	}

	_ = sm.saveSourcesLocked()

	// Write cache
	cacheBytes, err := json.MarshalIndent(allItems, "", "  ")
	if err == nil {
		_ = os.WriteFile(sm.cacheFile, cacheBytes, 0644)
	}

	return allItems, nil
}

func (sm *SourcesManager) fetchCatalog(src Source) ([]CatalogItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ConfigStudio-Core/1.3")

	resp, err := sm.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("source returned status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Could be []CatalogItem directly or { "plugins": []CatalogItem }
	var items []CatalogItem
	if err := json.Unmarshal(data, &items); err == nil && len(items) > 0 {
		return items, nil
	}

	var wrapper struct {
		Plugins []CatalogItem `json:"plugins"`
	}
	if err := json.Unmarshal(data, &wrapper); err == nil {
		return wrapper.Plugins, nil
	}

	return nil, errors.New("unrecognized catalog JSON format")
}

// GetCatalog reads cached items and attaches current installed/enabled status
func (sm *SourcesManager) GetCatalog(installedPlugins []Plugin) []CatalogItem {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	data, err := os.ReadFile(sm.cacheFile)
	if err != nil {
		return []CatalogItem{}
	}

	var items []CatalogItem
	if err := json.Unmarshal(data, &items); err != nil {
		return []CatalogItem{}
	}

	installedMap := make(map[string]Plugin)
	for _, p := range installedPlugins {
		installedMap[p.Manifest.ID] = p
	}

	for i := range items {
		if p, ok := installedMap[items[i].ID]; ok {
			items[i].Installed = true
			items[i].Enabled = p.Enabled
		} else {
			items[i].Installed = false
			items[i].Enabled = false
		}
	}

	return items
}
