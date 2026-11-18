package agent

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type FSNode struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	IsDir     bool      `json:"isDir"`
	Size      int64     `json:"size"`
	ModTime   time.Time `json:"modTime"`
	Extension string    `json:"extension,omitempty"`
}

func (s *Server) handleFSTree(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		if len(s.cfg.Sandbox.AllowedRoots) > 0 {
			dirPath = s.cfg.Sandbox.AllowedRoots[0]
		} else {
			dirPath = "/"
		}
	}

	if !s.auth.CanAccessPath(ctx, dirPath, false) {
		jsonError(w, http.StatusForbidden, "Path access denied by agent sandbox")
		return
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to read directory: "+err.Error())
		return
	}

	var nodes []FSNode
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fullPath := filepath.Join(dirPath, entry.Name())
		ext := ""
		if !entry.IsDir() {
			ext = filepath.Ext(entry.Name())
		}
		nodes = append(nodes, FSNode{
			Name:      entry.Name(),
			Path:      filepath.ToSlash(fullPath),
			IsDir:     entry.IsDir(),
			Size:      info.Size(),
			ModTime:   info.ModTime(),
			Extension: ext,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"path":  filepath.ToSlash(dirPath),
		"nodes": nodes,
		"items": nodes,
	})
}

func (s *Server) resolveSandboxPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	if filepath.IsAbs(p) || strings.HasPrefix(p, "/") {
		return filepath.Clean(p)
	}
	if len(s.cfg.Sandbox.AllowedRoots) > 0 {
		return filepath.Clean(filepath.Join(s.cfg.Sandbox.AllowedRoots[0], p))
	}
	return filepath.Clean(p)
}

func (s *Server) handleFSReadFile(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	filePath := s.resolveSandboxPath(r.URL.Query().Get("path"))
	if filePath == "" {
		jsonError(w, http.StatusBadRequest, "path query parameter is required")
		return
	}

	if !s.auth.CanAccessPath(ctx, filePath, false) {
		jsonError(w, http.StatusForbidden, "File read access denied")
		return
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Cannot read file: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"name":    filepath.Base(filePath),
		"path":    filepath.ToSlash(filePath),
		"content": string(data),
		"size":    len(data),
	})
}

func (s *Server) handleFSWriteFile(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Write operations require Master RW elevation (TOTP)")
		return
	}

	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Path = s.resolveSandboxPath(req.Path)
	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	if !s.auth.CanAccessPath(ctx, req.Path, true) {
		jsonError(w, http.StatusForbidden, "Path write access denied by agent sandbox")
		return
	}

	// Create backup if file already exists
	if _, err := os.Stat(req.Path); err == nil {
		_ = os.WriteFile(req.Path+".csbak", []byte(req.Content), 0644)
	}

	dir := filepath.Dir(req.Path)
	_ = os.MkdirAll(dir, 0755)

	if err := os.WriteFile(req.Path, []byte(req.Content), 0644); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to write file: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "saved",
		"path":   filepath.ToSlash(req.Path),
		"size":   len(req.Content),
	})
}

func (s *Server) handleFSDelete(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Delete operations require Master RW elevation (TOTP)")
		return
	}

	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		var req struct {
			Path string `json:"path"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		targetPath = req.Path
	}

	targetPath = s.resolveSandboxPath(targetPath)
	if targetPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	if !s.auth.CanAccessPath(ctx, targetPath, true) {
		jsonError(w, http.StatusForbidden, "Path deletion denied by sandbox")
		return
	}

	if err := os.RemoveAll(targetPath); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to delete: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "deleted",
		"path":   filepath.ToSlash(targetPath),
	})
}

func (s *Server) handleFSRename(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Rename requires Master RW elevation (TOTP)")
		return
	}

	var req struct {
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.OldPath = s.resolveSandboxPath(req.OldPath)
	req.NewPath = s.resolveSandboxPath(req.NewPath)
	if req.OldPath == "" || req.NewPath == "" {
		jsonError(w, http.StatusBadRequest, "oldPath and newPath are required")
		return
	}

	if !s.auth.CanAccessPath(ctx, req.OldPath, true) || !s.auth.CanAccessPath(ctx, req.NewPath, true) {
		jsonError(w, http.StatusForbidden, "Path rename denied by sandbox")
		return
	}

	if err := os.Rename(req.OldPath, req.NewPath); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to rename: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "renamed",
		"oldPath": filepath.ToSlash(req.OldPath),
		"newPath": filepath.ToSlash(req.NewPath),
	})
}

func (s *Server) handleFSCreate(w http.ResponseWriter, r *http.Request) {
	ctx := s.authenticate(w, r)
	if ctx == nil {
		return
	}

	if ctx.Level < AccessReadWrite {
		jsonError(w, http.StatusForbidden, "Creation requires Master RW elevation (TOTP)")
		return
	}

	var req struct {
		Path  string `json:"path"`
		IsDir bool   `json:"isDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Path = s.resolveSandboxPath(req.Path)
	if !s.auth.CanAccessPath(ctx, req.Path, true) {
		jsonError(w, http.StatusForbidden, "Path creation denied by sandbox")
		return
	}

	if req.IsDir {
		if err := os.MkdirAll(req.Path, 0755); err != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to create directory: "+err.Error())
			return
		}
	} else {
		dir := filepath.Dir(req.Path)
		_ = os.MkdirAll(dir, 0755)
		if err := os.WriteFile(req.Path, []byte(""), 0644); err != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to create file: "+err.Error())
			return
		}
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"status": "created",
		"path":   filepath.ToSlash(req.Path),
	})
}
