package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"config-studio/internal/audit"
	appfs "config-studio/internal/fs"
	"config-studio/internal/guard"
)

func (s *Server) handleGetTree(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	items, err := s.fs.ListDirRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	if items == nil {
		items = []appfs.FileItem{}
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"root":  rootID,
		"path":  relPath,
		"items": items,
	})
}

func (s *Server) handleGetFile(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	content, err := s.fs.ReadFileRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	_, rootObj, _ := s.fs.SafePathRoot(rootID, relPath)

	cleanRel := strings.TrimPrefix(relPath, "/")
	fullRel := cleanRel
	if rootObj.ID != "" && !strings.Contains(cleanRel, ":") {
		fullRel = rootObj.ID + ":" + cleanRel
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"root":        rootObj.ID,
		"path":        cleanRel,
		"fullRelPath": fullRel,
		"name":        filepath.Base(cleanRel),
		"readOnly":    rootObj.ReadOnly,
		"content":     string(content),
	})
}

func (s *Server) handleFSBatchRead(w http.ResponseWriter, r *http.Request) {
	var req appfs.BatchReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request payload: "+err.Error())
		return
	}

	if req.Root == "" {
		req.Root = r.URL.Query().Get("root")
	}
	if req.Pattern == "" && len(req.Patterns) == 0 && len(req.Paths) == 0 {
		if qPat := r.URL.Query().Get("pattern"); qPat != "" {
			req.Pattern = qPat
		}
	}

	res, err := s.fs.BatchReadRoot(req)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, res)
}

func (s *Server) handleGetFileInfo(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	fullPath, rootObj, err := s.fs.SafePathRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	modTime, createTime := appfs.GetFileTimes(info)
	hash := sha256.Sum256(content)
	hashHex := hex.EncodeToString(hash[:])
	lineCount := strings.Count(string(content), "\n") + 1

	cleanRel := strings.TrimPrefix(relPath, "/")
	fullRel := cleanRel
	if rootObj.ID != "" && !strings.Contains(cleanRel, ":") {
		fullRel = rootObj.ID + ":" + cleanRel
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"root":        rootObj.ID,
		"path":        cleanRel,
		"fullRelPath": fullRel,
		"name":        filepath.Base(cleanRel),
		"readOnly":    rootObj.ReadOnly,
		"size":        len(content),
		"lineCount":   lineCount,
		"charCount":   len(string(content)),
		"sha256":      hashHex,
		"modifiedAt":  modTime.Format(time.RFC3339),
		"createdAt":   createTime.Format(time.RFC3339),
	})
}

func (s *Server) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root    string `json:"root"`
		Path    string `json:"path"`
		Content string `json:"content"`
		Backup  bool   `json:"backup"`
		Force   bool   `json:"force"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	settings := s.config.Get()
	if !req.Force && settings.StructureGuardEnabled {
		if guard.IsSensitive(req.Path, settings.CriticalPatterns, nil) {
			valResult := guard.Validate(req.Path, []byte(req.Content))
			if !valResult.Valid {
				var firstCritical guard.GuardIssue
				for _, iss := range valResult.Issues {
					if iss.Severity == guard.SeverityCritical {
						firstCritical = iss
						break
					}
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error":  "Syntax validation failed for sensitive file",
					"guard":  firstCritical,
					"issues": valResult.Issues,
				})
				return
			}
		}
	}

	if err := s.fs.WriteFileRoot(req.Root, req.Path, []byte(req.Content), req.Backup); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if s.audit != nil {
		hash := sha256.Sum256([]byte(req.Content))
		action := audit.ActionFileSave
		severity := audit.SeverityInfo
		details := map[string]any{
			"backup": req.Backup,
			"bytes":  len(req.Content),
			"sha256": hex.EncodeToString(hash[:]),
			"force":  req.Force,
		}
		if req.Force {
			action = audit.ActionFileForceSave
			severity = audit.SeverityWarn
			valResult := guard.Validate(req.Path, []byte(req.Content))
			if !valResult.Valid && len(valResult.Issues) > 0 {
				details["ignored_error"] = valResult.Issues[0].Message
				details["ignored_line"] = valResult.Issues[0].Line
			}
		}

		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   action,
			Severity: severity,
			Target:   req.Path,
			Details:  details,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "saved", "path": req.Path})
}

func (s *Server) handleValidateGuard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	settings := s.config.Get()
	isSens := guard.IsSensitive(req.Path, settings.CriticalPatterns, nil)
	valResult := guard.Validate(req.Path, []byte(req.Content))
	valResult.IsGuarded = isSens

	jsonResponse(w, http.StatusOK, valResult)
}

func (s *Server) handleCreateItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root  string `json:"root"`
		Path  string `json:"path"`
		IsDir bool   `json:"isDir"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	if err := s.fs.CreateItemRoot(req.Root, req.Path, req.IsDir); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "file.create",
			Severity: audit.SeverityInfo,
			Target:   req.Path,
			Details:  map[string]any{"root": req.Root, "isDir": req.IsDir},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "created", "path": req.Path})
}

func (s *Server) handleDeleteItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root string `json:"root"`
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	if err := s.fs.DeleteItemRoot(req.Root, req.Path); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionFileDelete,
			Severity: audit.SeverityWarn,
			Target:   req.Path,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted", "path": req.Path})
}

func (s *Server) handleRenameItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root    string `json:"root"`
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.OldPath == "" || req.NewPath == "" {
		jsonError(w, http.StatusBadRequest, "oldPath and newPath are required")
		return
	}

	if err := s.fs.RenameItemRoot(req.Root, req.OldPath, req.NewPath); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.audit != nil {
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   audit.ActionFileRename,
			Severity: audit.SeverityInfo,
			Target:   req.OldPath,
			Details:  map[string]any{"root": req.Root, "newPath": req.NewPath},
		})
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status":  "renamed",
		"oldPath": req.OldPath,
		"newPath": req.NewPath,
	})
}

func (s *Server) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(50 << 20); err != nil { // 50 MB max
		jsonError(w, http.StatusBadRequest, "file too large or invalid multipart")
		return
	}

	rootID := r.FormValue("root")
	dirRel := r.FormValue("path")
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "missing file form parameter: "+err.Error())
		return
	}
	defer file.Close()

	savedPath, err := s.fs.UploadFileRoot(rootID, dirRel, header.Filename, file)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status": "uploaded",
		"path":   savedPath,
	})
}

func (s *Server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		jsonError(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	fullPath, _, err := s.fs.SafePathRoot(rootID, relPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	filename := filepath.Base(fullPath)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, fullPath)
}

func (s *Server) handleSearchFiles(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	q := r.URL.Query().Get("q")
	items, err := s.fs.SearchFilesRoot(rootID, q)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"items": items,
	})
}
