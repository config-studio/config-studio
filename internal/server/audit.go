package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"config-studio/internal/audit"
)

func (s *Server) handleGetAuditLogs(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		jsonResponse(w, http.StatusOK, audit.QueryResult{Events: []audit.Event{}, Total: 0})
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 500 {
			limit = l
		}
	}

	offset := 0
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	action := r.URL.Query().Get("action")
	category := r.URL.Query().Get("category")
	source := r.URL.Query().Get("source")
	severity := r.URL.Query().Get("severity")
	search := r.URL.Query().Get("search")

	res := s.audit.Query(audit.QueryFilter{
		Limit:    limit,
		Offset:   offset,
		Action:   action,
		Category: category,
		Source:   source,
		Severity: severity,
		Search:   search,
	})

	jsonResponse(w, http.StatusOK, res)
}

func (s *Server) handleIngestAuditLogs(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		jsonResponse(w, http.StatusOK, map[string]any{"ingested": 0})
		return
	}

	var req struct {
		Events []audit.Event `json:"events"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	ingested := 0
	user := s.getAuditUser(r)
	ip := r.RemoteAddr

	for _, evt := range req.Events {
		if evt.Action == "" {
			continue
		}
		if evt.User == "" {
			evt.User = user
		}
		if evt.IP == "" {
			evt.IP = ip
		}
		if evt.Source == "" {
			evt.Source = "frontend"
		}
		if evt.SourceID == "" {
			evt.SourceID = "core"
		}
		if err := s.audit.Log(evt); err == nil {
			ingested++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"ingested": ingested,
	})
}

func (s *Server) handleExportAuditLogs(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", "attachment; filename=\"config-studio-audit.jsonl\"")
	_ = s.audit.Export(w)
}
