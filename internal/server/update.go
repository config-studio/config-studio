package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Default update check repository and timeout
const (
	defaultUpdateRepo = "config-studio/config-studio"
	updateHTTPTimeout = 10 * time.Second
)

// SystemUpdateCheckResponse represents release status response
type SystemUpdateCheckResponse struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	HasUpdate      bool   `json:"hasUpdate"`
	ReleaseNotes   string `json:"releaseNotes,omitempty"`
	DownloadURL    string `json:"downloadUrl,omitempty"`
	PublishedAt    string `json:"publishedAt,omitempty"`
	AssetSize      int64  `json:"assetSize,omitempty"`
}

// SelfUpdateRequest represents payload for self update
type SelfUpdateRequest struct {
	DownloadURL string `json:"downloadUrl,omitempty"`
	Version     string `json:"version,omitempty"`
}

// SelfUpdateResponse represents outcome of self-update
type SelfUpdateResponse struct {
	Success         bool   `json:"success"`
	Message         string `json:"message"`
	RestartRequired bool   `json:"restartRequired"`
	Executable      string `json:"executable,omitempty"`
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

type githubReleaseResponse struct {
	TagName     string               `json:"tag_name"`
	Name        string               `json:"name"`
	Body        string               `json:"body"`
	PublishedAt string               `json:"published_at"`
	HTMLURL     string               `json:"html_url"`
	Assets      []githubReleaseAsset `json:"assets"`
}

// CompareSemver compares two semantic version strings (e.g. "2.3.0" and "2.4.0").
// Returns 1 if v1 > v2, -1 if v1 < v2, and 0 if equal.
func CompareSemver(v1, v2 string) int {
	clean1 := strings.TrimSpace(strings.TrimPrefix(v1, "v"))
	clean2 := strings.TrimSpace(strings.TrimPrefix(v2, "v"))

	// Split off any prerelease/build metadata (e.g. -beta.1 or +20261115)
	if idx := strings.IndexAny(clean1, "-+"); idx != -1 {
		clean1 = clean1[:idx]
	}
	if idx := strings.IndexAny(clean2, "-+"); idx != -1 {
		clean2 = clean2[:idx]
	}

	parts1 := strings.Split(clean1, ".")
	parts2 := strings.Split(clean2, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var n1, n2 int
		if i < len(parts1) {
			n1, _ = strconv.Atoi(parts1[i])
		}
		if i < len(parts2) {
			n2, _ = strconv.Atoi(parts2[i])
		}

		if n1 > n2 {
			return 1
		}
		if n1 < n2 {
			return -1
		}
	}
	return 0
}

// handleCheckSystemUpdate queries GitHub Releases for updates to Config Studio.
func (s *Server) handleCheckSystemUpdate(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("repo")
	if repo == "" {
		repo = defaultUpdateRepo
	}

	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	client := &http.Client{Timeout: updateHTTPTimeout}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, apiURL, nil)
	if err != nil {
		jsonResponse(w, http.StatusOK, SystemUpdateCheckResponse{
			CurrentVersion: coreSysInfoVersion,
			LatestVersion:  coreSysInfoVersion,
			HasUpdate:      false,
		})
		return
	}
	req.Header.Set("User-Agent", "ConfigStudio-Core/"+coreSysInfoVersion)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		// Graceful degradation when offline or rate-limited
		jsonResponse(w, http.StatusOK, SystemUpdateCheckResponse{
			CurrentVersion: coreSysInfoVersion,
			LatestVersion:  coreSysInfoVersion,
			HasUpdate:      false,
		})
		return
	}
	defer resp.Body.Close()

	var release githubReleaseResponse
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		jsonResponse(w, http.StatusOK, SystemUpdateCheckResponse{
			CurrentVersion: coreSysInfoVersion,
			LatestVersion:  coreSysInfoVersion,
			HasUpdate:      false,
		})
		return
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")
	hasUpdate := CompareSemver(latestVersion, coreSysInfoVersion) > 0

	// Find the best matching binary asset for current OS/architecture
	var matchedURL string
	var matchedSize int64
	osName := runtime.GOOS
	archName := runtime.GOARCH

	for _, asset := range release.Assets {
		nameLower := strings.ToLower(asset.Name)
		if strings.Contains(nameLower, osName) && strings.Contains(nameLower, archName) {
			if osName == "windows" && !strings.HasSuffix(nameLower, ".exe") {
				continue
			}
			matchedURL = asset.BrowserDownloadURL
			matchedSize = asset.Size
			break
		}
	}

	jsonResponse(w, http.StatusOK, SystemUpdateCheckResponse{
		CurrentVersion: coreSysInfoVersion,
		LatestVersion:  latestVersion,
		HasUpdate:      hasUpdate,
		ReleaseNotes:   release.Body,
		DownloadURL:    matchedURL,
		PublishedAt:    release.PublishedAt,
		AssetSize:      matchedSize,
	})
}

// handleSelfUpdate downloads the updated core binary, stages it, backs up the current binary,
// and replaces it in-place (with Windows rename-old support).
func (s *Server) handleSelfUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req SelfUpdateRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	downloadURL := strings.TrimSpace(req.DownloadURL)
	if downloadURL == "" {
		jsonError(w, http.StatusBadRequest, "downloadUrl is required for self-update")
		return
	}

	lowerURL := strings.ToLower(downloadURL)
	if !strings.HasPrefix(lowerURL, "https://github.com/config-studio/config-studio/releases/download/") &&
		!strings.HasPrefix(lowerURL, "https://github.com/edvardbaldanov/config-studio/releases/download/") {
		jsonError(w, http.StatusBadRequest, "untrusted downloadUrl: updates must originate from official GitHub Releases")
		return
	}

	// 1. Determine running executable path
	execPath, err := os.Executable()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("unable to resolve executable path: %v", err))
		return
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("unable to resolve symlinks for executable: %v", err))
		return
	}

	execDir := filepath.Dir(execPath)
	tempPath := filepath.Join(execDir, filepath.Base(execPath)+".new")
	oldPath := filepath.Join(execDir, filepath.Base(execPath)+".old")

	// 2. Download new binary with timeout
	client := &http.Client{Timeout: 60 * time.Second}
	dlResp, err := client.Get(downloadURL)
	if err != nil {
		jsonError(w, http.StatusBadGateway, fmt.Sprintf("failed to download update binary: %v", err))
		return
	}
	defer dlResp.Body.Close()

	if dlResp.StatusCode != http.StatusOK {
		jsonError(w, http.StatusBadGateway, fmt.Sprintf("download server returned HTTP %d", dlResp.StatusCode))
		return
	}

	// 3. Write to temporary file
	out, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create temporary update file: %v", err))
		return
	}
	written, err := io.Copy(out, dlResp.Body)
	_ = out.Close()
	if err != nil || written < 1024 {
		_ = os.Remove(tempPath)
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("incomplete download (size %d bytes): %v", written, err))
		return
	}

	// 4. In-place replacement
	// Clean up any stale .old file from previous update
	_ = os.Remove(oldPath)

	// Rename running binary to .old (permitted on Windows for running binaries)
	if err := os.Rename(execPath, oldPath); err != nil {
		_ = os.Remove(tempPath)
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("failed to backup current binary: %v", err))
		return
	}

	// Rename .new to active executable
	if err := os.Rename(tempPath, execPath); err != nil {
		// Rollback if new binary placement fails
		_ = os.Rename(oldPath, execPath)
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("failed to place new binary into service path: %v", err))
		return
	}

	jsonResponse(w, http.StatusOK, SelfUpdateResponse{
		Success:         true,
		Message:         "Бинарный файл Config Studio успешно обновлен. Требуется перезапуск.",
		RestartRequired: true,
		Executable:      execPath,
	})
}

// handleSystemRestart triggers a graceful server re-launch and shutdown.
func (s *Server) handleSystemRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	execPath, err := os.Executable()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("unable to resolve executable: %v", err))
		return
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("unable to resolve symlinks: %v", err))
		return
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Сервер перезапускается...",
	})

	// Background re-exec and exit
	go func() {
		time.Sleep(600 * time.Millisecond)
		cmd := exec.Command(execPath, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		_ = cmd.Start()
		os.Exit(0)
	}()
}
