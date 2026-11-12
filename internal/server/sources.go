package server

import (
	"encoding/json"
	"net/http"

	"config-studio/internal/audit"
	"config-studio/internal/plugin"
)

func (s *Server) handleListSources(w http.ResponseWriter, r *http.Request) {
	sources := s.plugins.Sources().ListSources()
	jsonResponse(w, http.StatusOK, map[string]any{"sources": sources})
}

func (s *Server) handleAddSource(w http.ResponseWriter, r *http.Request) {
	var src plugin.Source
	if err := json.NewDecoder(r.Body).Decode(&src); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	created, err := s.plugins.Sources().AddSource(src)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "source.add",
			Severity: audit.SeverityInfo,
			Target:   created.ID,
			Details:  map[string]any{"url": created.URL, "name": created.Name},
		})
	}

	// Trigger background sync for the new source
	go func() {
		installed, _ := s.plugins.ListPlugins()
		_, _ = s.plugins.Sources().SyncSources(installed)
	}()

	jsonResponse(w, http.StatusCreated, created)
}

func (s *Server) handleUpdateSource(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonError(w, http.StatusBadRequest, "source id required")
		return
	}

	var update plugin.Source
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := s.plugins.Sources().UpdateSource(id, update); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{"status": "ok", "id": id})
}

func (s *Server) handleDeleteSource(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonError(w, http.StatusBadRequest, "source id required")
		return
	}

	if err := s.plugins.Sources().DeleteSource(id); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "source.delete",
			Severity: audit.SeverityInfo,
			Target:   id,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]any{"status": "ok", "id": id})
}

func (s *Server) handleSyncSources(w http.ResponseWriter, r *http.Request) {
	installed, _ := s.plugins.ListPlugins()
	items, err := s.plugins.Sources().SyncSources(installed)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "sync failed: "+err.Error())
		return
	}

	sources := s.plugins.Sources().ListSources()
	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"items":   items,
		"sources": sources,
	})
}

func (s *Server) handleGetCatalog(w http.ResponseWriter, r *http.Request) {
	installed, _ := s.plugins.ListPlugins()
	forceRefresh := r.URL.Query().Get("refresh") == "1"

	var items []plugin.CatalogItem
	if forceRefresh {
		if synced, err := s.plugins.Sources().SyncSources(installed); err == nil && len(synced) > 0 {
			items = synced
		}
	}

	if len(items) == 0 {
		items = s.plugins.Sources().GetCatalog(installed)
	}

	if len(items) == 0 {
		if synced, err := s.plugins.Sources().SyncSources(installed); err == nil && len(synced) > 0 {
			items = synced
		}
	}
	jsonResponse(w, http.StatusOK, map[string]any{"catalog": items})
}
