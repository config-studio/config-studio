package plugin

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"config-studio/internal/cspkg"
	"config-studio/internal/fsutil"
)

type Manager struct {
	pluginsDir      string
	settingsDir     string
	runner          *Runner
	sources         *SourcesManager
	mu              sync.RWMutex
	state           map[string]bool // pluginId -> enabled
	pendingInstalls map[string]*PendingInstall
}

func NewManager(dataDir string, runner *Runner) (*Manager, error) {
	pluginsDir := filepath.Join(dataDir, "plugins")
	if err := os.MkdirAll(pluginsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create plugins directory: %w", err)
	}

	settingsDir := filepath.Join(dataDir, "plugin-settings")
	if err := os.MkdirAll(settingsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create plugin-settings directory: %w", err)
	}

	sm, err := NewSourcesManager(pluginsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize sources manager: %w", err)
	}

	m := &Manager{
		pluginsDir:      pluginsDir,
		settingsDir:     settingsDir,
		runner:          runner,
		sources:         sm,
		state:           make(map[string]bool),
		pendingInstalls: make(map[string]*PendingInstall),
	}

	m.loadState()

	return m, nil
}

func (m *Manager) Sources() *SourcesManager {
	return m.sources
}

func (m *Manager) stateFilePath() string {
	return filepath.Join(m.pluginsDir, "state.json")
}

func (m *Manager) loadState() {
	data, err := os.ReadFile(m.stateFilePath())
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &m.state)
}

func (m *Manager) saveState() error {
	data, err := json.MarshalIndent(m.state, "", "  ")
	if err != nil {
		return err
	}
	return fsutil.SafeWriteFile(m.stateFilePath(), data, 0644)
}

// GetPluginSettings reads plugin-specific settings from data/plugin-settings/<pluginId>.json.
func (m *Manager) GetPluginSettings(id string) (map[string]any, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	cleanID := filepath.Base(id)
	target := filepath.Join(m.settingsDir, cleanID+".json")
	data, err := os.ReadFile(target)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}

	var res map[string]any
	if err := json.Unmarshal(data, &res); err != nil {
		return map[string]any{}, nil
	}
	if res == nil {
		res = map[string]any{}
	}
	return res, nil
}

// SavePluginSettings saves plugin-specific settings to data/plugin-settings/<pluginId>.json.
func (m *Manager) SavePluginSettings(id string, settings map[string]any) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cleanID := filepath.Base(id)
	if cleanID == "" || cleanID == "." || cleanID == "/" || cleanID == "\\" {
		return fmt.Errorf("invalid plugin id")
	}

	if err := os.MkdirAll(m.settingsDir, 0755); err != nil {
		return err
	}

	if settings == nil {
		settings = map[string]any{}
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}

	target := filepath.Join(m.settingsDir, cleanID+".json")
	return fsutil.SafeWriteFile(target, data, 0644)
}

// GetAllPluginSettings returns all saved plugin settings mapped by plugin ID.
func (m *Manager) GetAllPluginSettings() map[string]map[string]any {
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make(map[string]map[string]any)
	files, err := os.ReadDir(m.settingsDir)
	if err != nil {
		return res
	}

	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".json") {
			pluginID := strings.TrimSuffix(f.Name(), ".json")
			data, err := os.ReadFile(filepath.Join(m.settingsDir, f.Name()))
			if err == nil {
				var s map[string]any
				if err := json.Unmarshal(data, &s); err == nil && s != nil {
					res[pluginID] = s
				}
			}
		}
	}
	return res
}

// enrichManifestLocales populates and merges locales and language packs from the plugin directory.
func enrichManifestLocales(manifest *Manifest, pluginDir string) {
	if len(manifest.Permissions) == 0 && len(manifest.Capabilities) > 0 {
		manifest.Permissions = manifest.Capabilities
	}
	if manifest.CSS == "" && len(manifest.Styles) > 0 {
		manifest.CSS = manifest.Styles[0]
	}
	if manifest.Locales == nil {
		manifest.Locales = make(map[string]map[string]string)
	}

	// 1. Scan locales/ folder if present (e.g. locales/ru.json, locales/en.json, locales/de.json)
	localesDir := filepath.Join(pluginDir, "locales")
	if stat, err := os.Stat(localesDir); err == nil && stat.IsDir() {
		files, _ := os.ReadDir(localesDir)
		for _, f := range files {
			if !f.IsDir() && strings.HasSuffix(strings.ToLower(f.Name()), ".json") {
				langCode := strings.TrimSuffix(strings.ToLower(f.Name()), ".json")
				content, err := os.ReadFile(filepath.Join(localesDir, f.Name()))
				if err == nil {
					var dict map[string]string
					if err := json.Unmarshal(content, &dict); err == nil && len(dict) > 0 {
						if manifest.Locales[langCode] == nil {
							manifest.Locales[langCode] = dict
						} else {
							for k, v := range dict {
								manifest.Locales[langCode][k] = v
							}
						}
					}
				}
			}
		}
	}

	// 2. Check if a dedicated local.json, localization.json, or locale.json exists for a full language pack plugin
	for _, fname := range []string{"local.json", "localization.json", "locale.json"} {
		locPackFile := filepath.Join(pluginDir, fname)
		if content, err := os.ReadFile(locPackFile); err == nil {
			applyLocalizationData(manifest, content)
			break
		}
	}

	// If Locales map ended up completely empty, clean it up to avoid empty {} in JSON
	if len(manifest.Locales) == 0 {
		manifest.Locales = nil
	}
}

// applyLocalizationData populates or merges language pack definition and translations into manifest.
func applyLocalizationData(manifest *Manifest, data []byte) {
	// First, try unmarshalling as a LanguagePackDef object: { code, name, flag, translations }
	var pack LanguagePackDef
	if err := json.Unmarshal(data, &pack); err == nil && (pack.Code != "" || len(pack.Translations) > 0) {
		if manifest.Localization == nil {
			manifest.Localization = &pack
		} else {
			if manifest.Localization.Code == "" {
				manifest.Localization.Code = pack.Code
			}
			if manifest.Localization.Name == "" {
				manifest.Localization.Name = pack.Name
			}
			if manifest.Localization.Flag == "" {
				manifest.Localization.Flag = pack.Flag
			}
			if manifest.Localization.Translations == nil {
				manifest.Localization.Translations = pack.Translations
			} else {
				for k, v := range pack.Translations {
					manifest.Localization.Translations[k] = v
				}
			}
		}
		return
	}

	// Second, try unmarshalling as a flat translations map: { "key": "value" }
	var dict map[string]string
	if err := json.Unmarshal(data, &dict); err == nil && len(dict) > 0 {
		if manifest.Localization == nil {
			code := strings.TrimPrefix(manifest.ID, "lang-")
			manifest.Localization = &LanguagePackDef{
				Code:         code,
				Name:         manifest.Name,
				Translations: dict,
			}
		} else {
			if manifest.Localization.Translations == nil {
				manifest.Localization.Translations = dict
			} else {
				for k, v := range dict {
					manifest.Localization.Translations[k] = v
				}
			}
		}
	}
}

// ListPlugins scans the plugins directory and returns all installed plugins.
func (m *Manager) ListPlugins() ([]Plugin, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.listPluginsLocked()
}

func (m *Manager) listPluginsLocked() ([]Plugin, error) {
	entries, err := os.ReadDir(m.pluginsDir)
	if err != nil {
		return nil, err
	}

	var plugins []Plugin
	seen := make(map[string]bool)

	// 1. Scan single-file .cspkg packages
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".cspkg") {
			pkgPath := filepath.Join(m.pluginsDir, entry.Name())
			p, err := m.loadPluginFromCSPKG(pkgPath)
			if err == nil && p != nil {
				plugins = append(plugins, *p)
				seen[p.ID] = true
			}
		}
	}

	// 2. Scan directories (for local development or unpacked folders)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if seen[entry.Name()] {
			continue
		}
		pDir := filepath.Join(m.pluginsDir, entry.Name())
		manifestPath := filepath.Join(pDir, "plugin.json")
		if _, err := os.Stat(manifestPath); err != nil {
			continue
		}

		manifestData, err := os.ReadFile(manifestPath)
		if err != nil {
			continue
		}

		var manifest Manifest
		if err := json.Unmarshal(manifestData, &manifest); err != nil {
			continue
		}

		if manifest.ID == "" {
			manifest.ID = entry.Name()
		}

		enrichManifestLocales(&manifest, pDir)

		enabled, ok := m.state[manifest.ID]
		if !ok {
			enabled = true // default enabled
		}

		info, _ := entry.Info()
		var installedAt time.Time
		if info != nil {
			installedAt = info.ModTime()
		} else {
			installedAt = time.Now()
		}

		plugins = append(plugins, Plugin{
			Manifest:    manifest,
			Enabled:     enabled,
			Dir:         pDir,
			InstalledAt: installedAt,
			Builtin:     false,
		})
		seen[manifest.ID] = true
	}

	// Calculate active dependents for each plugin
	dependentsMap := make(map[string][]string)
	for _, p := range plugins {
		if !p.Enabled {
			continue
		}
		for depID := range p.Dependencies {
			dependentsMap[depID] = append(dependentsMap[depID], p.ID)
		}
	}
	for i := range plugins {
		plugins[i].Dependents = dependentsMap[plugins[i].ID]
	}

	return plugins, nil
}

func (m *Manager) loadPluginFromCSPKG(pkgPath string) (*Plugin, error) {
	info, err := cspkg.Inspect(pkgPath)
	if err != nil {
		return nil, err
	}

	var manifest Manifest
	if err := json.Unmarshal(info.Manifest, &manifest); err != nil {
		return nil, fmt.Errorf("invalid manifest in %s: %w", pkgPath, err)
	}

	if manifest.ID == "" {
		base := filepath.Base(pkgPath)
		manifest.ID = strings.TrimSuffix(base, filepath.Ext(base))
	}

	enrichManifestLocalesFromCSPKG(&manifest, pkgPath)

	stat, _ := os.Stat(pkgPath)
	installedAt := time.Now()
	if stat != nil {
		installedAt = stat.ModTime()
	}

	enabled, ok := m.state[manifest.ID]
	if !ok {
		enabled = true // default enabled
	}

	return &Plugin{
		Manifest:    manifest,
		Enabled:     enabled,
		PackageFile: pkgPath,
		InstalledAt: installedAt,
		Builtin:     false,
	}, nil
}

func enrichManifestLocalesFromCSPKG(manifest *Manifest, pkgPath string) {
	if len(manifest.Permissions) == 0 && len(manifest.Capabilities) > 0 {
		manifest.Permissions = manifest.Capabilities
	}
	if manifest.CSS == "" && len(manifest.Styles) > 0 {
		manifest.CSS = manifest.Styles[0]
	}
	zr, err := cspkg.OpenZipReader(pkgPath)
	if err != nil {
		return
	}

	if manifest.Locales == nil {
		manifest.Locales = make(map[string]map[string]string)
	}

	for _, f := range zr.File {
		clean := filepath.ToSlash(filepath.Clean(f.Name))
		if strings.HasPrefix(clean, "locales/") && strings.HasSuffix(strings.ToLower(clean), ".json") {
			rc, err := f.Open()
			if err == nil {
				data, err := io.ReadAll(rc)
				rc.Close()
				if err == nil {
					var dict map[string]string
					if err := json.Unmarshal(data, &dict); err == nil && len(dict) > 0 {
						langCode := strings.TrimSuffix(filepath.Base(clean), ".json")
						if manifest.Locales[langCode] == nil {
							manifest.Locales[langCode] = dict
						} else {
							for k, v := range dict {
								manifest.Locales[langCode][k] = v
							}
						}
					}
				}
			}
		} else if clean == "local.json" || clean == "localization.json" || clean == "locale.json" {
			rc, err := f.Open()
			if err == nil {
				data, err := io.ReadAll(rc)
				rc.Close()
				if err == nil {
					applyLocalizationData(manifest, data)
				}
			}
		}
	}

	if len(manifest.Locales) == 0 {
		manifest.Locales = nil
	}
}

// GetActiveDependents returns IDs of active plugins that depend on the given plugin ID.
func (m *Manager) GetActiveDependents(id string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.getActiveDependentsLocked(id)
}

func (m *Manager) getActiveDependentsLocked(id string) []string {
	plugins, err := m.listPluginsLocked()
	if err != nil {
		return nil
	}
	var dependents []string
	for _, p := range plugins {
		if !p.Enabled || p.ID == id {
			continue
		}
		for depID := range p.Dependencies {
			if depID == id {
				dependents = append(dependents, p.ID)
				break
			}
		}
	}
	return dependents
}

// CheckDependencies checks whether all dependencies (required and optional) declared by the manifest are satisfied.
func (m *Manager) CheckDependencies(manifest Manifest) []DependencyIssue {
	if len(manifest.Dependencies) == 0 && len(manifest.OptionalDependencies) == 0 {
		return nil
	}

	plugins, err := m.ListPlugins()
	if err != nil {
		plugins = []Plugin{}
	}

	installedMap := make(map[string]Plugin)
	for _, p := range plugins {
		installedMap[p.ID] = p
	}

	var issues []DependencyIssue

	// 1. Hard / Required Dependencies
	for depID, constraint := range manifest.Dependencies {
		inst, exists := installedMap[depID]
		if !exists {
			issues = append(issues, DependencyIssue{
				PluginID: depID,
				Required: constraint,
				Status:   "missing",
				Optional: false,
			})
			continue
		}
		if !inst.Enabled {
			issues = append(issues, DependencyIssue{
				PluginID:  depID,
				Required:  constraint,
				Installed: inst.Version,
				Status:    "disabled",
				Optional:  false,
			})
			continue
		}
		if !MatchesVersionConstraint(inst.Version, constraint) {
			issues = append(issues, DependencyIssue{
				PluginID:  depID,
				Required:  constraint,
				Installed: inst.Version,
				Status:    "incompatible",
				Optional:  false,
			})
			continue
		}
	}

	// 2. Soft / Optional Dependencies
	for depID, constraint := range manifest.OptionalDependencies {
		inst, exists := installedMap[depID]
		if !exists {
			issues = append(issues, DependencyIssue{
				PluginID: depID,
				Required: constraint,
				Status:   "missing",
				Optional: true,
			})
			continue
		}
		if !inst.Enabled {
			issues = append(issues, DependencyIssue{
				PluginID:  depID,
				Required:  constraint,
				Installed: inst.Version,
				Status:    "disabled",
				Optional:  true,
			})
			continue
		}
		if !MatchesVersionConstraint(inst.Version, constraint) {
			issues = append(issues, DependencyIssue{
				PluginID:  depID,
				Required:  constraint,
				Installed: inst.Version,
				Status:    "incompatible",
				Optional:  true,
			})
			continue
		}
	}

	return issues
}

// GetPlugin returns a single plugin by ID.
func (m *Manager) GetPlugin(id string) (*Plugin, error) {
	plugins, err := m.ListPlugins()
	if err != nil {
		return nil, err
	}
	for _, p := range plugins {
		if p.ID == id {
			return &p, nil
		}
	}
	return nil, fmt.Errorf("plugin %s not found", id)
}

// TogglePlugin enables or disables a plugin.
func (m *Manager) TogglePlugin(id string, enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !enabled {
		activeDeps := m.getActiveDependentsLocked(id)
		if len(activeDeps) > 0 {
			return &DependencyInUseError{
				PluginID:   id,
				Dependents: activeDeps,
			}
		}
	}

	m.state[id] = enabled
	if !enabled && m.runner != nil {
		m.runner.StopAllForPlugin(id)
	}
	return m.saveState()
}

// DeletePlugin removes a plugin folder completely.
func (m *Manager) DeletePlugin(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	activeDeps := m.getActiveDependentsLocked(id)
	if len(activeDeps) > 0 {
		return &DependencyInUseError{
			PluginID:   id,
			Dependents: activeDeps,
		}
	}

	p, err := m.getPluginLocked(id)
	if err != nil {
		return err
	}

	if m.runner != nil {
		m.runner.StopAllForPlugin(id)
	}

	if p.PackageFile != "" {
		_ = os.Remove(p.PackageFile)
	}
	if p.Dir != "" {
		_ = os.RemoveAll(p.Dir)
	}

	delete(m.state, id)
	_ = m.saveState()
	return nil
}

func (m *Manager) getPluginLocked(id string) (*Plugin, error) {
	plugins, err := m.listPluginsLocked()
	if err != nil {
		return nil, err
	}
	for _, p := range plugins {
		if p.ID == id {
			return &p, nil
		}
	}
	return nil, fmt.Errorf("plugin %s not found", id)
}



// ServeFile safely serves plugin asset files (JS, CSS, images).
func (m *Manager) ServeFile(w http.ResponseWriter, r *http.Request, pluginID, relPath string) {
	p, err := m.GetPlugin(pluginID)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	cleanRel := filepath.ToSlash(filepath.Clean(strings.TrimPrefix(relPath, "/")))
	if strings.HasPrefix(cleanRel, "..") || strings.Contains(cleanRel, ":") || filepath.IsAbs(cleanRel) || filepath.VolumeName(cleanRel) != "" {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Set appropriate Content-Type
	switch filepath.Ext(cleanRel) {
	case ".js", ".mjs":
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case ".css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case ".json":
		w.Header().Set("Content-Type", "application/json")
	case ".svg":
		w.Header().Set("Content-Type", "image/svg+xml")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	}

	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if p.PackageFile != "" {
		data, err := cspkg.ReadFile(p.PackageFile, cleanRel)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
		return
	}

	realDir, err := filepath.EvalSymlinks(p.Dir)
	if err != nil {
		realDir = filepath.Clean(p.Dir)
	}

	target := filepath.Join(p.Dir, cleanRel)
	realTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	relCheck, err := filepath.Rel(realDir, realTarget)
	if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	info, err := os.Stat(realTarget)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, realTarget)
}
