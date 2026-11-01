package config

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

type Settings struct {
	AppTitle      string `json:"appTitle" yaml:"app_title"`
	BaseColor     string `json:"baseColor" yaml:"base_color"`
	AccentColor   string `json:"accentColor" yaml:"accent_color"`
	ThemeMode     string `json:"themeMode" yaml:"theme_mode"`
	Language      string `json:"language" yaml:"language"`
	HasCustomIcon bool   `json:"hasCustomIcon" yaml:"has_custom_icon"`
	IconMime      string `json:"iconMime" yaml:"icon_mime"`
	AuthEnabled   bool   `json:"authEnabled" yaml:"auth_enabled"`
	AuthUser      string `json:"authUser" yaml:"auth_user"`
	AuthPass      string `json:"authPass,omitempty" yaml:"auth_pass,omitempty"`
	ApiEnabled             bool     `json:"apiEnabled" yaml:"api_enabled"`
	ApiKey                 string   `json:"apiKey,omitempty" yaml:"api_key,omitempty"`
	PluginExecUnrestricted bool     `json:"pluginExecUnrestricted" yaml:"plugin_exec_unrestricted"`
	StructureGuardEnabled  bool     `json:"structureGuardEnabled" yaml:"structure_guard_enabled"`
	CriticalPatterns       []string `json:"criticalPatterns" yaml:"critical_patterns"`
	BottomDockMode         string   `json:"bottomDockMode" yaml:"bottom_dock_mode"`
}

type Manager struct {
	dataDir string
	mu      sync.RWMutex
	current Settings
}

func DefaultSettings() Settings {
	return Settings{
		AppTitle:      "Config Studio",
		BaseColor:     "#161b22",
		AccentColor:   "#00d2b4",
		ThemeMode:     "dark",
		Language:      "ru",
		HasCustomIcon: false,
		IconMime:      "image/svg+xml",
		AuthEnabled:   false,
		AuthUser:      "admin",
		AuthPass:      "admin",
		ApiEnabled:             false,
		ApiKey:                 "",
		PluginExecUnrestricted: false,
		StructureGuardEnabled:  true,
		CriticalPatterns:       []string{},
		BottomDockMode:         "auto",
	}
}

func NewManager(dataDir string) (*Manager, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}

	m := &Manager{
		dataDir: dataDir,
		current: DefaultSettings(),
	}

	if err := m.load(); err != nil {
		_ = m.save()
	}

	return m, nil
}

func (m *Manager) settingsPath() string {
	return filepath.Join(m.dataDir, "settings.yaml")
}

func (m *Manager) IconPath() string {
	return filepath.Join(m.dataDir, "custom-icon")
}

func (m *Manager) load() error {
	data, err := os.ReadFile(m.settingsPath())
	if err != nil {
		return err
	}
	var s Settings
	if err := yaml.Unmarshal(data, &s); err != nil {
		return err
	}

	if s.Language == "" {
		s.Language = "ru"
	}
	if s.AuthUser == "" {
		s.AuthUser = "admin"
	}

	if _, err := os.Stat(m.IconPath()); err == nil {
		s.HasCustomIcon = true
		if s.IconMime == "" {
			s.IconMime = m.detectMime(m.IconPath())
		}
	} else {
		s.HasCustomIcon = false
	}

	if !strings.Contains(string(data), "structure_guard_enabled") {
		s.StructureGuardEnabled = true
	}
	if s.CriticalPatterns == nil {
		s.CriticalPatterns = []string{}
	}

	m.current = s
	return nil
}

func (m *Manager) detectMime(path string) string {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return "image/png"
	}
	lower := strings.ToLower(string(data[:min(len(data), 512)]))
	if strings.Contains(lower, "<svg") || strings.Contains(lower, "<?xml") {
		return "image/svg+xml"
	}
	if bytes.HasPrefix(data, []byte("\x89PNG")) {
		return "image/png"
	}
	if bytes.HasPrefix(data, []byte("RIFF")) && len(data) > 12 && string(data[8:12]) == "WEBP" {
		return "image/webp"
	}
	if bytes.HasPrefix(data, []byte("\x00\x00\x01\x00")) {
		return "image/x-icon"
	}
	return "image/svg+xml"
}

func (m *Manager) save() error {
	data, err := yaml.Marshal(m.current)
	if err != nil {
		return err
	}
	header := []byte("# Config Studio Application Settings\n# You can edit this file directly or via the Web UI\n\n")
	return os.WriteFile(m.settingsPath(), append(header, data...), 0644)
}

func (m *Manager) Get() Settings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s := m.current
	s.AuthPass = "" // Do not leak password in GET responses
	return s
}

func (m *Manager) CheckAuth(user, pass string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.current.AuthUser == user && m.current.AuthPass == pass
}

func (m *Manager) CheckPass(pass string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.current.AuthPass != "" && m.current.AuthPass == pass
}

func (m *Manager) GetIconMime() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.current.IconMime != "" {
		return m.current.IconMime
	}
	return "image/svg+xml"
}

func (m *Manager) Update(s Settings) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s.AppTitle != "" {
		m.current.AppTitle = s.AppTitle
	}
	if s.BaseColor != "" {
		m.current.BaseColor = s.BaseColor
	}
	if s.AccentColor != "" {
		m.current.AccentColor = s.AccentColor
	}
	if s.ThemeMode != "" {
		m.current.ThemeMode = s.ThemeMode
	}
	if s.Language != "" {
		m.current.Language = s.Language
	}
	m.current.AuthEnabled = s.AuthEnabled
	if s.AuthUser != "" {
		m.current.AuthUser = s.AuthUser
	}
	if s.AuthPass != "" {
		m.current.AuthPass = s.AuthPass
	}
	m.current.ApiEnabled = s.ApiEnabled
	if s.ApiKey != "" {
		m.current.ApiKey = s.ApiKey
	}
	m.current.PluginExecUnrestricted = s.PluginExecUnrestricted
	m.current.StructureGuardEnabled = s.StructureGuardEnabled
	m.current.CriticalPatterns = s.CriticalPatterns
	if s.BottomDockMode != "" {
		m.current.BottomDockMode = s.BottomDockMode
	}

	return m.save()
}

func (m *Manager) SaveIcon(src io.Reader, filename string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := io.ReadAll(src)
	if err != nil {
		return err
	}

	dst, err := os.Create(m.IconPath())
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := dst.Write(data); err != nil {
		return err
	}

	// Detect MIME type reliably
	mime := "image/png"
	lowerName := strings.ToLower(filename)
	lowerContent := strings.ToLower(string(data[:min(len(data), 512)]))

	if strings.HasSuffix(lowerName, ".svg") || strings.Contains(lowerContent, "<svg") || strings.Contains(lowerContent, "<?xml") {
		mime = "image/svg+xml"
	} else if strings.HasSuffix(lowerName, ".ico") || bytes.HasPrefix(data, []byte("\x00\x00\x01\x00")) {
		mime = "image/x-icon"
	} else if strings.HasSuffix(lowerName, ".webp") || (bytes.HasPrefix(data, []byte("RIFF")) && len(data) > 12 && string(data[8:12]) == "WEBP") {
		mime = "image/webp"
	} else if bytes.HasPrefix(data, []byte("\x89PNG")) {
		mime = "image/png"
	}

	m.current.HasCustomIcon = true
	m.current.IconMime = mime
	return m.save()
}
