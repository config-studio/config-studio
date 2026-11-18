package server

import (
	"encoding/json"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"strings"

	"config-studio/internal/config"
)

func init() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_ = mime.AddExtensionType(".json", "application/json")
	_ = mime.AddExtensionType(".svg", "image/svg+xml")
	_ = mime.AddExtensionType(".js", "application/javascript")
	_ = mime.AddExtensionType(".mjs", "application/javascript")
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings := s.config.Get()
	jsonResponse(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req config.Settings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := s.config.Update(req); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to update settings: "+err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, s.config.Get())
}

func (s *Server) handleUploadIcon(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MB max
		jsonError(w, http.StatusBadRequest, "failed to parse multipart form")
		return
	}

	file, header, err := r.FormFile("icon")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing icon file: "+err.Error())
		return
	}
	defer file.Close()

	if err := s.config.SaveIcon(file, header.Filename); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save icon: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, s.config.Get())
}

func (s *Server) handleGetIcon(w http.ResponseWriter, r *http.Request) {
	iconPath := s.config.IconPath()
	if _, err := os.Stat(iconPath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	data, err := os.ReadFile(iconPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	mimeType := s.config.GetIconMime()
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) spaHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}

	// Check if file exists in embedded FS
	if _, err := fs.Stat(s.cfg.WebFS, path); err == nil {
		if strings.HasSuffix(path, ".webmanifest") || strings.HasSuffix(path, "manifest.json") {
			w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
		} else if path == "sw.js" {
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			w.Header().Set("Service-Worker-Allowed", "/")
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		http.FileServer(http.FS(s.cfg.WebFS)).ServeHTTP(w, r)
		return
	}

	// Fallback to index.html for SPA
	indexFile, err := s.cfg.WebFS.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer indexFile.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	_, _ = io.Copy(w, indexFile)
}
