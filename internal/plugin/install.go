package plugin

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"config-studio/internal/cspkg"
	"config-studio/internal/fsutil"
)

// InspectZip extracts a zip or cspkg archive and inspects its manifest.
func (m *Manager) InspectZip(r io.Reader, size int64, sourceURL string) (*PendingInstall, error) {
	const maxArchiveSize = 50 * 1024 * 1024
	lr := io.LimitReader(r, maxArchiveSize+1)
	data, err := io.ReadAll(lr)
	if err != nil {
		return nil, err
	}
	if len(data) > maxArchiveSize {
		return nil, errors.New("archive exceeds maximum allowed size of 50MB")
	}

	// Create a temporary extraction directory
	tmpDir, err := os.MkdirTemp("", "cs-plugin-inspect-*")
	if err != nil {
		return nil, err
	}

	var packageFilePath string
	// Check if this is a .cspkg binary package format
	if len(data) >= 4 && data[0] == 'C' && data[1] == 'S' && data[2] == 'P' && data[3] == 'K' {
		packageFilePath = filepath.Join(tmpDir, "package.cspkg")
		_ = os.WriteFile(packageFilePath, data, 0644)
		if _, err := cspkg.UnpackBytes(data, tmpDir); err != nil {
			_ = os.RemoveAll(tmpDir)
			return nil, fmt.Errorf("invalid cspkg package: %w", err)
		}
	} else {
		zipReader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			_ = os.RemoveAll(tmpDir)
			return nil, fmt.Errorf("invalid archive: %w", err)
		}

		// Extract files with zip-slip safety check
		for _, f := range zipReader.File {
			if f.Mode()&os.ModeSymlink != 0 {
				_ = os.RemoveAll(tmpDir)
				return nil, fmt.Errorf("security violation: symlinks not permitted in archive: %s", f.Name)
			}

			cleanPath := filepath.Clean(f.Name)
			if strings.HasPrefix(cleanPath, "..") || strings.Contains(cleanPath, ":") ||
				filepath.IsAbs(cleanPath) || filepath.VolumeName(cleanPath) != "" {
				_ = os.RemoveAll(tmpDir)
				return nil, fmt.Errorf("insecure path in archive: %s", f.Name)
			}

			targetPath := filepath.Join(tmpDir, cleanPath)
			rel, err := filepath.Rel(tmpDir, targetPath)
			if err != nil || strings.HasPrefix(rel, "..") || rel == ".." {
				_ = os.RemoveAll(tmpDir)
				return nil, fmt.Errorf("insecure path in archive: %s", f.Name)
			}

			if f.FileInfo().IsDir() {
				_ = os.MkdirAll(targetPath, 0755)
				continue
			}

			if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
				_ = os.RemoveAll(tmpDir)
				return nil, err
			}

			outFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode()&0755)
			if err != nil {
				_ = os.RemoveAll(tmpDir)
				return nil, err
			}

			rc, err := f.Open()
			if err != nil {
				outFile.Close()
				_ = os.RemoveAll(tmpDir)
				return nil, err
			}

			const maxFileSize = 50 * 1024 * 1024
			n, err := io.Copy(outFile, io.LimitReader(rc, maxFileSize+1))
			rc.Close()
			outFile.Close()
			if err != nil {
				_ = os.RemoveAll(tmpDir)
				return nil, err
			}
			if n > maxFileSize {
				_ = os.RemoveAll(tmpDir)
				return nil, fmt.Errorf("security violation: file %q exceeds maximum uncompressed size of 50MB", f.Name)
			}
		}
	}

	// Locate plugin.json in extracted files
	var manifestPath string
	_ = filepath.Walk(tmpDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && filepath.Base(path) == "plugin.json" {
			manifestPath = path
			return io.EOF
		}
		return nil
	})

	if manifestPath == "" {
		_ = os.RemoveAll(tmpDir)
		return nil, errors.New("archive does not contain a plugin.json manifest")
	}

	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		_ = os.RemoveAll(tmpDir)
		return nil, err
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		_ = os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("invalid plugin.json: %w", err)
	}

	if manifest.ID == "" {
		_ = os.RemoveAll(tmpDir)
		return nil, errors.New("plugin.json is missing 'id' field")
	}

	pluginDir := filepath.Dir(manifestPath)
	enrichManifestLocales(&manifest, pluginDir)

	// Determine if official:
	// If a sourceURL is provided, it MUST originate from an official GitHub repository.
	// If installed locally without URL, author must be an official team name.
	isOfficial := false
	authorLower := strings.ToLower(manifest.Author)
	isOfficialAuthor := authorLower == "configstudio" || authorLower == "config studio" || authorLower == "config studio team"

	sourceLower := strings.ToLower(strings.TrimSpace(sourceURL))
	isOfficialURL := strings.HasPrefix(sourceLower, "https://github.com/config-studio/") || strings.HasPrefix(sourceLower, "https://github.com/edvardbaldanov/config-studio-")

	if sourceURL != "" {
		isOfficial = isOfficialURL
	} else {
		isOfficial = isOfficialAuthor
	}

	tempKey := generateTempKey()
	pending := &PendingInstall{
		TempKey:          tempKey,
		Manifest:         manifest,
		IsOfficial:       isOfficial,
		DependencyIssues: m.CheckDependencies(manifest),
		TempDir:          tmpDir,
		PluginDir:        pluginDir,
		PackageFile:      packageFilePath,
		CreatedAt:        time.Now(),
	}

	m.mu.Lock()
	m.cleanupPendingInstallsLocked()
	m.pendingInstalls[tempKey] = pending
	m.mu.Unlock()

	return pending, nil
}

// InspectURL downloads a zip, .cspkg package, or GitHub repo and inspects its manifest.
func (m *Manager) InspectURL(rawURL string) (*PendingInstall, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, errors.New("URL is required")
	}

	downloadURL := rawURL
	lowerURL := strings.ToLower(downloadURL)

	// Only transform repository root URLs into zip archive URLs if not already a package
	isDirectArchive := strings.HasSuffix(lowerURL, ".zip") || strings.HasSuffix(lowerURL, ".cspkg")
	isReleaseAsset := strings.Contains(lowerURL, "/releases/download/") || strings.Contains(lowerURL, "/archive/")
	isRawContent := strings.Contains(lowerURL, "raw.githubusercontent.com")

	if strings.Contains(downloadURL, "github.com/") && !isDirectArchive && !isReleaseAsset && !isRawContent {
		clean := strings.TrimSuffix(downloadURL, ".git")
		clean = strings.TrimSuffix(clean, "/")
		downloadURL = clean + "/archive/refs/heads/main.zip"
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch plugin from URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound && strings.Contains(downloadURL, "/refs/heads/main.zip") {
		masterURL := strings.Replace(downloadURL, "/refs/heads/main.zip", "/refs/heads/master.zip", 1)
		resp2, err2 := client.Get(masterURL)
		if err2 == nil && resp2.StatusCode == http.StatusOK {
			defer resp2.Body.Close()
			return m.InspectZip(resp2.Body, resp2.ContentLength, rawURL)
		}
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed with HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	return m.InspectZip(resp.Body, resp.ContentLength, rawURL)
}

// ConfirmInstall finalizes plugin installation after user consent.
func (m *Manager) ConfirmInstall(tempKey string) (*Plugin, error) {
	m.mu.Lock()
	pending, ok := m.pendingInstalls[tempKey]
	if !ok {
		m.mu.Unlock()
		return nil, fmt.Errorf("pending installation %q not found or expired", tempKey)
	}
	delete(m.pendingInstalls, tempKey)
	m.mu.Unlock()

	defer os.RemoveAll(pending.TempDir)

	destPackage := filepath.Join(m.pluginsDir, pending.Manifest.ID+".cspkg")
	destDir := filepath.Join(m.pluginsDir, pending.Manifest.ID)

	// Clean up any old duplicate directory or package
	_ = os.Remove(destPackage)
	_ = os.RemoveAll(destDir)

	if pending.PackageFile != "" {
		if err := fsutil.CopyFile(pending.PackageFile, destPackage); err != nil {
			return nil, fmt.Errorf("failed to save plugin package: %w", err)
		}
	} else {
		// Automatically pack into single-file .cspkg
		if _, err := cspkg.Pack(pending.PluginDir, destPackage); err != nil {
			return nil, fmt.Errorf("failed to pack plugin: %w", err)
		}
	}

	m.mu.Lock()
	m.state[pending.Manifest.ID] = true
	_ = m.saveState()
	m.mu.Unlock()

	return m.GetPlugin(pending.Manifest.ID)
}

// CancelInstall discards an inspected pending plugin.
func (m *Manager) CancelInstall(tempKey string) error {
	m.mu.Lock()
	pending, ok := m.pendingInstalls[tempKey]
	if ok {
		delete(m.pendingInstalls, tempKey)
	}
	m.mu.Unlock()

	if pending != nil && pending.TempDir != "" {
		_ = os.RemoveAll(pending.TempDir)
	}
	return nil
}

func (m *Manager) cleanupPendingInstallsLocked() {
	now := time.Now()
	for k, p := range m.pendingInstalls {
		if now.Sub(p.CreatedAt) > 15*time.Minute {
			_ = os.RemoveAll(p.TempDir)
			delete(m.pendingInstalls, k)
		}
	}
}

func generateTempKey() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return fmt.Sprintf("tmp_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// InstallFromZip extracts a zip archive and registers the plugin directly.
func (m *Manager) InstallFromZip(r io.Reader, size int64) (*Plugin, error) {
	pending, err := m.InspectZip(r, size, "")
	if err != nil {
		return nil, err
	}
	return m.ConfirmInstall(pending.TempKey)
}

// InstallFromURL downloads a zip or GitHub repo and installs it directly.
func (m *Manager) InstallFromURL(rawURL string) (*Plugin, error) {
	pending, err := m.InspectURL(rawURL)
	if err != nil {
		return nil, err
	}
	return m.ConfirmInstall(pending.TempKey)
}
