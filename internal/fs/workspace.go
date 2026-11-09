package fs

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

var idRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// WorkspaceRoot represents a registered root working directory in Config Studio.
type WorkspaceRoot struct {
	ID       string `json:"id" yaml:"id"`
	Name     string `json:"name" yaml:"name"`
	Path     string `json:"path" yaml:"path"`
	ReadOnly bool   `json:"readOnly" yaml:"read_only"`
	Icon     string `json:"icon,omitempty" yaml:"icon,omitempty"`
	Order    int    `json:"order,omitempty" yaml:"order,omitempty"`
	Server   string `json:"server,omitempty" yaml:"server,omitempty"` // "local", or remote server URL/ID
}

// WorkspaceConfigFile represents the root YAML schema of workspaces.yaml.
type WorkspaceConfigFile struct {
	Version     int             `yaml:"version"`
	DefaultRoot string          `yaml:"default_root"`
	Workspaces  []WorkspaceRoot `yaml:"workspaces"`
}

// WorkspaceManager manages the collection of workspace roots.
type WorkspaceManager struct {
	dataDir        string
	filePath       string
	defaultWorkDir string
	defaultRoot    string
	lastLoadedTime time.Time
	mu             sync.RWMutex
	roots          []WorkspaceRoot
}

// NewWorkspaceManager initializes the manager and loads or creates workspaces.yaml.
func NewWorkspaceManager(dataDir string, defaultWorkDir string) (*WorkspaceManager, error) {
	absData, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(absData, 0755); err != nil {
		return nil, err
	}

	absDefaultWork, err := filepath.Abs(defaultWorkDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(absDefaultWork, 0755); err != nil {
		return nil, err
	}

	wm := &WorkspaceManager{
		dataDir:        absData,
		filePath:       filepath.Join(absData, "workspaces.yaml"),
		defaultWorkDir: absDefaultWork,
		defaultRoot:    "default",
		roots:          make([]WorkspaceRoot, 0),
	}

	if _, err := os.Stat(wm.filePath); os.IsNotExist(err) {
		// Initialize with default root
		defaultItem := WorkspaceRoot{
			ID:       "default",
			Name:     "Configs",
			Path:     absDefaultWork,
			ReadOnly: false,
			Icon:     "folder",
			Order:    1,
		}
		wm.roots = []WorkspaceRoot{defaultItem}
		wm.defaultRoot = "default"
		if err := wm.save(); err != nil {
			return nil, fmt.Errorf("failed to create default workspaces.yaml: %w", err)
		}
	} else {
		if err := wm.load(); err != nil {
			return nil, fmt.Errorf("failed to load workspaces.yaml: %w", err)
		}
	}

	return wm, nil
}

// NewInMemoryWorkspaceManager creates an in-memory manager (used for tests or standalone fs.NewService).
func NewInMemoryWorkspaceManager(workDir string) *WorkspaceManager {
	abs, _ := filepath.Abs(workDir)
	return &WorkspaceManager{
		defaultRoot: "default",
		roots: []WorkspaceRoot{
			{
				ID:       "default",
				Name:     "Configs",
				Path:     abs,
				ReadOnly: false,
				Icon:     "folder",
				Order:    1,
			},
		},
	}
}

// checkReload checks if workspaces.yaml has been modified on disk and reloads if needed.
func (wm *WorkspaceManager) checkReload() {
	if wm.filePath == "" {
		return
	}

	info, err := os.Stat(wm.filePath)
	if err != nil {
		return
	}

	wm.mu.RLock()
	needsReload := info.ModTime().After(wm.lastLoadedTime)
	wm.mu.RUnlock()

	if needsReload {
		_ = wm.Reload()
	}
}

// Reload loads workspaces.yaml from disk.
func (wm *WorkspaceManager) Reload() error {
	wm.mu.Lock()
	defer wm.mu.Unlock()
	return wm.loadLocked()
}

func (wm *WorkspaceManager) load() error {
	wm.mu.Lock()
	defer wm.mu.Unlock()
	return wm.loadLocked()
}

func (wm *WorkspaceManager) loadLocked() error {
	if wm.filePath == "" {
		return nil
	}

	data, err := os.ReadFile(wm.filePath)
	if err != nil {
		return err
	}

	info, err := os.Stat(wm.filePath)
	if err == nil {
		wm.lastLoadedTime = info.ModTime()
	}

	var cfg WorkspaceConfigFile
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return err
	}

	roots := make([]WorkspaceRoot, 0, len(cfg.Workspaces))
	seenIDs := make(map[string]bool)

	for i, w := range cfg.Workspaces {
		w.ID = strings.TrimSpace(w.ID)
		if w.ID == "" || seenIDs[w.ID] {
			continue
		}
		seenIDs[w.ID] = true

		if w.Name == "" {
			w.Name = filepath.Base(w.Path)
			if w.Name == "" || w.Name == "." {
				w.Name = w.ID
			}
		}

		if w.Server == "" || w.Server == "local" {
			absPath, err := filepath.Abs(w.Path)
			if err == nil {
				w.Path = absPath
			}
		} else {
			w.Path = filepath.ToSlash(strings.TrimSpace(w.Path))
		}

		if w.Icon == "" {
			w.Icon = "folder"
		}
		if w.Order == 0 {
			w.Order = i + 1
		}

		roots = append(roots, w)
	}

	if len(roots) == 0 {
		roots = append(roots, WorkspaceRoot{
			ID:       "default",
			Name:     "Configs",
			Path:     wm.defaultWorkDir,
			ReadOnly: false,
			Icon:     "folder",
			Order:    1,
		})
	}

	wm.roots = roots
	if cfg.DefaultRoot != "" && seenIDs[cfg.DefaultRoot] {
		wm.defaultRoot = cfg.DefaultRoot
	} else {
		wm.defaultRoot = roots[0].ID
	}

	return nil
}

func (wm *WorkspaceManager) save() error {
	wm.mu.Lock()
	defer wm.mu.Unlock()
	return wm.saveLocked()
}

func (wm *WorkspaceManager) saveLocked() error {
	if wm.filePath == "" {
		return nil
	}

	cfg := WorkspaceConfigFile{
		Version:     1,
		DefaultRoot: wm.defaultRoot,
		Workspaces:  wm.roots,
	}

	data, err := yaml.Marshal(&cfg)
	if err != nil {
		return err
	}

	if err := os.WriteFile(wm.filePath, data, 0644); err != nil {
		return err
	}

	if info, err := os.Stat(wm.filePath); err == nil {
		wm.lastLoadedTime = info.ModTime()
	}

	return nil
}

// ListForServer returns workspace roots isolated for a specific server (or local host).
func (wm *WorkspaceManager) ListForServer(server string) []WorkspaceRoot {
	wm.checkReload()

	wm.mu.RLock()
	defer wm.mu.RUnlock()

	server = strings.TrimSpace(server)
	isLocal := server == "" || server == "local"

	var filtered []WorkspaceRoot
	for _, r := range wm.roots {
		rootServer := strings.TrimSpace(r.Server)
		rootIsLocal := rootServer == "" || rootServer == "local"
		if isLocal && rootIsLocal {
			filtered = append(filtered, r)
		} else if !isLocal && strings.EqualFold(rootServer, server) {
			filtered = append(filtered, r)
		}
	}

	// Default fallback if no workspaces are configured for this target
	if isLocal && len(filtered) == 0 {
		filtered = append(filtered, WorkspaceRoot{
			ID:       "default",
			Name:     "Configs",
			Path:     wm.defaultWorkDir,
			ReadOnly: false,
			Icon:     "folder",
			Server:   "local",
			Order:    1,
		})
	} else if !isLocal && len(filtered) == 0 {
		filtered = append(filtered, WorkspaceRoot{
			ID:       "root",
			Name:     "Root (/)",
			Path:     "/",
			ReadOnly: false,
			Icon:     "server",
			Server:   server,
			Order:    1,
		})
	}

	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].Order != filtered[j].Order {
			return filtered[i].Order < filtered[j].Order
		}
		return strings.ToLower(filtered[i].Name) < strings.ToLower(filtered[j].Name)
	})

	return filtered
}

// List returns a sorted slice of workspace roots.
func (wm *WorkspaceManager) List() []WorkspaceRoot {
	wm.checkReload()

	wm.mu.RLock()
	defer wm.mu.RUnlock()

	result := make([]WorkspaceRoot, len(wm.roots))
	copy(result, wm.roots)

	sort.Slice(result, func(i, j int) bool {
		if result[i].Order != result[j].Order {
			return result[i].Order < result[j].Order
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	return result
}

// Get returns a workspace root by ID.
func (wm *WorkspaceManager) Get(id string) (WorkspaceRoot, bool) {
	wm.checkReload()

	wm.mu.RLock()
	defer wm.mu.RUnlock()

	for _, r := range wm.roots {
		if r.ID == id {
			return r, true
		}
	}
	return WorkspaceRoot{}, false
}

// DefaultRoot returns the default root ID.
func (wm *WorkspaceManager) DefaultRoot() string {
	wm.checkReload()

	wm.mu.RLock()
	defer wm.mu.RUnlock()

	if wm.defaultRoot != "" {
		return wm.defaultRoot
	}
	if len(wm.roots) > 0 {
		return wm.roots[0].ID
	}
	return "default"
}

// Add adds a new workspace root and persists it.
func (wm *WorkspaceManager) Add(root WorkspaceRoot) error {
	wm.checkReload()

	root.ID = strings.TrimSpace(root.ID)
	if !idRegex.MatchString(root.ID) {
		return errors.New("workspace id must consist of 1-64 alphanumeric characters, underscores or hyphens")
	}

	root.Server = strings.TrimSpace(root.Server)
	if root.Server == "" || root.Server == "local" {
		absPath, err := filepath.Abs(strings.TrimSpace(root.Path))
		if err != nil {
			return fmt.Errorf("invalid path: %w", err)
		}
		if err := os.MkdirAll(absPath, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}
		root.Path = absPath
	} else {
		root.Path = filepath.ToSlash(strings.TrimSpace(root.Path))
	}

	if strings.TrimSpace(root.Name) == "" {
		root.Name = filepath.Base(root.Path)
		if root.Name == "" || root.Name == "." {
			root.Name = root.ID
		}
	}

	if root.Icon == "" {
		root.Icon = "folder"
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	for _, r := range wm.roots {
		if r.ID == root.ID {
			return fmt.Errorf("workspace with id '%s' already exists", root.ID)
		}
	}

	if root.Order == 0 {
		root.Order = len(wm.roots) + 1
	}

	wm.roots = append(wm.roots, root)
	return wm.saveLocked()
}

// Update updates an existing workspace root and persists it.
func (wm *WorkspaceManager) Update(root WorkspaceRoot) error {
	wm.checkReload()

	root.ID = strings.TrimSpace(root.ID)
	if root.ID == "" {
		return errors.New("workspace id is required")
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	found := false
	for i, r := range wm.roots {
		if r.ID == root.ID {
			if strings.TrimSpace(root.Name) != "" {
				wm.roots[i].Name = strings.TrimSpace(root.Name)
			}
			if strings.TrimSpace(root.Path) != "" {
				absPath, err := filepath.Abs(strings.TrimSpace(root.Path))
				if err != nil {
					return err
				}
				if err := os.MkdirAll(absPath, 0755); err != nil {
					return err
				}
				wm.roots[i].Path = absPath
			}
			wm.roots[i].ReadOnly = root.ReadOnly
			if root.Icon != "" {
				wm.roots[i].Icon = root.Icon
			}
			if root.Order > 0 {
				wm.roots[i].Order = root.Order
			}
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("workspace root '%s' not found", root.ID)
	}

	return wm.saveLocked()
}

// Delete removes a workspace root by ID from workspaces.yaml.
// Note: It NEVER removes files on disk, only the workspace reference.
func (wm *WorkspaceManager) Delete(id string) error {
	wm.checkReload()

	wm.mu.Lock()
	defer wm.mu.Unlock()

	if len(wm.roots) <= 1 {
		return errors.New("cannot delete the only remaining workspace root")
	}

	idx := -1
	for i, r := range wm.roots {
		if r.ID == id {
			idx = i
			break
		}
	}

	if idx == -1 {
		return fmt.Errorf("workspace root '%s' not found", id)
	}

	wm.roots = append(wm.roots[:idx], wm.roots[idx+1:]...)

	if wm.defaultRoot == id {
		wm.defaultRoot = wm.roots[0].ID
	}

	return wm.saveLocked()
}

// ResolveRootAndRel resolves a workspace root and the relative path inside it.
// It handles compound paths like "nginx:sites-available/default" or explicit rootID.
func (wm *WorkspaceManager) ResolveRootAndRel(rootID, relPath string) (WorkspaceRoot, string, error) {
	wm.checkReload()

	cleanRel := filepath.ToSlash(strings.TrimSpace(relPath))

	// Check if relPath starts with a compound workspace prefix "workspaceID:path"
	if idx := strings.Index(cleanRel, ":"); idx > 0 {
		candidateID := cleanRel[:idx]
		if root, ok := wm.Get(candidateID); ok {
			return root, strings.TrimPrefix(cleanRel[idx+1:], "/"), nil
		}
	}

	// If rootID is not explicitly provided, or is generic "default", fallback to defaultRoot
	if rootID == "" || rootID == "default" {
		rootID = wm.DefaultRoot()
	}

	root, ok := wm.Get(rootID)
	if !ok {
		// Fallback 1: try the configured defaultRoot
		if defRoot, defOk := wm.Get(wm.DefaultRoot()); defOk {
			clean := cleanRel
			if strings.HasPrefix(clean, defRoot.ID+":") {
				clean = strings.TrimPrefix(clean, defRoot.ID+":")
			}
			return defRoot, strings.TrimPrefix(clean, "/"), nil
		}
		// Fallback 2: first available workspace root
		wm.mu.RLock()
		if len(wm.roots) > 0 {
			firstRoot := wm.roots[0]
			wm.mu.RUnlock()
			clean := cleanRel
			if strings.HasPrefix(clean, firstRoot.ID+":") {
				clean = strings.TrimPrefix(clean, firstRoot.ID+":")
			}
			return firstRoot, strings.TrimPrefix(clean, "/"), nil
		}
		wm.mu.RUnlock()
		return WorkspaceRoot{}, "", fmt.Errorf("workspace root '%s' not found", rootID)
	}

	// If cleanRel starts with root.ID + ":", strip it
	if strings.HasPrefix(cleanRel, root.ID+":") {
		cleanRel = strings.TrimPrefix(cleanRel, root.ID+":")
	}

	return root, strings.TrimPrefix(cleanRel, "/"), nil
}
