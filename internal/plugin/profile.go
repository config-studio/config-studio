package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ProfileAppSettings struct {
	AppTitle              string   `json:"appTitle"`
	BaseColor             string   `json:"baseColor"`
	AccentColor           string   `json:"accentColor"`
	ThemeMode             string   `json:"themeMode"`
	Language              string   `json:"language"`
	BottomDockMode        string   `json:"bottomDockMode"`
	StructureGuardEnabled bool     `json:"structureGuardEnabled"`
	CriticalPatterns      []string `json:"criticalPatterns"`
}

type ProfilePlugin struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	Enabled   bool   `json:"enabled"`
	SourceURL string `json:"sourceUrl,omitempty"`
}

type StudioProfile struct {
	Schema         string                    `json:"$schema,omitempty"`
	Version        string                    `json:"version"`
	ExportedAt     time.Time                 `json:"exportedAt"`
	App            ProfileAppSettings        `json:"app"`
	Sources        []Source                  `json:"sources"`
	Plugins        []ProfilePlugin           `json:"plugins"`
	PluginSettings map[string]map[string]any `json:"pluginSettings,omitempty"`
}

type PluginStatusDiff struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	Installed bool   `json:"installed"`
	Action    string `json:"action"` // "already_installed", "to_install", "will_enable"
}

type ProfilePreview struct {
	Profile       StudioProfile      `json:"profile"`
	SettingsDiff  []string           `json:"settingsDiff"`
	NewSources    []Source           `json:"newSources"`
	PluginsStatus []PluginStatusDiff `json:"pluginsStatus"`
}

type ProfileImportRequest struct {
	Profile            StudioProfile `json:"profile"`
	ApplySettings      bool          `json:"applySettings"`
	ImportSources      bool          `json:"importSources"`
	AutoInstallPlugins bool          `json:"autoInstallPlugins"`
}

type ProfileImportResult struct {
	SettingsApplied bool     `json:"settingsApplied"`
	SourcesAdded    int      `json:"sourcesAdded"`
	PluginsQueued   []string `json:"pluginsQueued"`
	PluginsEnabled  []string `json:"pluginsEnabled"`
	Errors          []string `json:"errors,omitempty"`
}

var KnownOfficialPlugins = map[string]string{
	"web-devkit": "https://github.com/config-studio/config-studio-web-devkit",
	"servers":    "https://github.com/config-studio/config-studio-servers",
}

// GenerateProfile creates an exportable StudioProfile from current settings, sources, and plugins.
// Crucially, it guarantees secrets, auth credentials, and sensitive tokens are completely excluded.
func GenerateProfile(
	appSettings ProfileAppSettings,
	sources []Source,
	installedPlugins []Plugin,
	pluginSettings map[string]map[string]any,
) StudioProfile {
	profilePlugins := make([]ProfilePlugin, 0, len(installedPlugins))
	for _, p := range installedPlugins {
		sourceURL := p.Manifest.Homepage
		if sourceURL == "" {
			if known, ok := KnownOfficialPlugins[p.Manifest.ID]; ok {
				sourceURL = known
			}
		}
		profilePlugins = append(profilePlugins, ProfilePlugin{
			ID:        p.Manifest.ID,
			Name:      p.Manifest.Name,
			Version:   p.Manifest.Version,
			Enabled:   p.Enabled,
			SourceURL: sourceURL,
		})
	}

	cleanSources := make([]Source, 0, len(sources))
	for _, s := range sources {
		cleanSources = append(cleanSources, Source{
			ID:       s.ID,
			Name:     s.Name,
			URL:      s.URL,
			Official: s.Official,
			Enabled:  s.Enabled,
		})
	}

	if appSettings.CriticalPatterns == nil {
		appSettings.CriticalPatterns = make([]string, 0)
	}

	return StudioProfile{
		Schema:         "https://config-studio.io/schemas/profile-v1.json",
		Version:        "1.0",
		ExportedAt:     time.Now().UTC(),
		App:            appSettings,
		Sources:        cleanSources,
		Plugins:        profilePlugins,
		PluginSettings: pluginSettings,
	}
}

// PreviewProfile compares imported profile against current state to show user exact changes
func PreviewProfile(
	profile StudioProfile,
	currentApp ProfileAppSettings,
	currentSources []Source,
	installedPlugins []Plugin,
) (*ProfilePreview, error) {
	if profile.Version == "" {
		return nil, errors.New("invalid profile format: missing version")
	}

	settingsDiff := make([]string, 0)
	if profile.App.AppTitle != "" && profile.App.AppTitle != currentApp.AppTitle {
		settingsDiff = append(settingsDiff, fmt.Sprintf("Заголовок: %q ➔ %q", currentApp.AppTitle, profile.App.AppTitle))
	}
	if profile.App.ThemeMode != "" && profile.App.ThemeMode != currentApp.ThemeMode {
		settingsDiff = append(settingsDiff, fmt.Sprintf("Тема: %q ➔ %q", currentApp.ThemeMode, profile.App.ThemeMode))
	}
	if profile.App.BaseColor != "" && profile.App.BaseColor != currentApp.BaseColor {
		settingsDiff = append(settingsDiff, fmt.Sprintf("Цвет фона: %s ➔ %s", currentApp.BaseColor, profile.App.BaseColor))
	}
	if profile.App.AccentColor != "" && profile.App.AccentColor != currentApp.AccentColor {
		settingsDiff = append(settingsDiff, fmt.Sprintf("Акцентный цвет: %s ➔ %s", currentApp.AccentColor, profile.App.AccentColor))
	}
	if profile.App.BottomDockMode != "" && profile.App.BottomDockMode != currentApp.BottomDockMode {
		settingsDiff = append(settingsDiff, fmt.Sprintf("Нижняя панель: %s ➔ %s", currentApp.BottomDockMode, profile.App.BottomDockMode))
	}

	// Sources diff
	currentSourcesMap := make(map[string]bool)
	for _, s := range currentSources {
		currentSourcesMap[strings.ToLower(strings.TrimSpace(s.URL))] = true
	}

	newSources := make([]Source, 0)
	for _, s := range profile.Sources {
		cleanURL := strings.ToLower(strings.TrimSpace(s.URL))
		if cleanURL != "" && !currentSourcesMap[cleanURL] {
			newSources = append(newSources, s)
		}
	}

	// Plugins diff
	installedMap := make(map[string]Plugin)
	for _, p := range installedPlugins {
		installedMap[p.Manifest.ID] = p
	}

	pluginsStatus := make([]PluginStatusDiff, 0)
	for _, pp := range profile.Plugins {
		existing, isInstalled := installedMap[pp.ID]
		if !isInstalled {
			pluginsStatus = append(pluginsStatus, PluginStatusDiff{
				ID:        pp.ID,
				Name:      pp.Name,
				Version:   pp.Version,
				Installed: false,
				Action:    "to_install",
			})
		} else if !existing.Enabled && pp.Enabled {
			pluginsStatus = append(pluginsStatus, PluginStatusDiff{
				ID:        pp.ID,
				Name:      pp.Name,
				Version:   pp.Version,
				Installed: true,
				Action:    "will_enable",
			})
		} else {
			pluginsStatus = append(pluginsStatus, PluginStatusDiff{
				ID:        pp.ID,
				Name:      pp.Name,
				Version:   pp.Version,
				Installed: true,
				Action:    "already_installed",
			})
		}
	}

	if profile.Sources == nil {
		profile.Sources = make([]Source, 0)
	}
	if profile.Plugins == nil {
		profile.Plugins = make([]ProfilePlugin, 0)
	}

	return &ProfilePreview{
		Profile:       profile,
		SettingsDiff:  settingsDiff,
		NewSources:    newSources,
		PluginsStatus: pluginsStatus,
	}, nil
}

// ParseProfileBytes securely deserializes and validates profile json
func ParseProfileBytes(data []byte) (*StudioProfile, error) {
	var profile StudioProfile
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, fmt.Errorf("failed to parse profile JSON: %w", err)
	}
	if profile.Version == "" {
		return nil, errors.New("profile JSON is missing 'version' property")
	}
	if profile.Sources == nil {
		profile.Sources = make([]Source, 0)
	}
	if profile.Plugins == nil {
		profile.Plugins = make([]ProfilePlugin, 0)
	}
	return &profile, nil
}
