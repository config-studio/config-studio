package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"config-studio/internal/audit"
	"config-studio/internal/sandbox"
)

type serverFSAdapter struct {
	server *Server
}

func (a *serverFSAdapter) ReadFile(path string) ([]byte, error) {
	if a.server.fs == nil {
		return nil, errors.New("filesystem service not initialized")
	}
	return a.server.fs.ReadFile(path)
}

func (a *serverFSAdapter) WriteFile(path string, data []byte) error {
	if a.server.fs == nil {
		return errors.New("filesystem service not initialized")
	}
	return a.server.fs.WriteFile(path, data, true)
}

func (a *serverFSAdapter) ListFiles(dir string) ([]string, error) {
	if a.server.fs == nil {
		return nil, errors.New("filesystem service not initialized")
	}
	items, err := a.server.fs.ListDir(dir)
	if err != nil {
		return nil, err
	}
	res := make([]string, len(items))
	for i, it := range items {
		res[i] = it.Path
	}
	return res, nil
}

// handleSandboxEval executes JavaScript code inside the ephemeral Goja sandbox.
func (s *Server) handleSandboxEval(w http.ResponseWriter, r *http.Request) {
	if s.sandbox == nil {
		jsonError(w, http.StatusInternalServerError, "sandbox service not initialized")
		return
	}

	// Limit request body to 2MB to protect against payload exhaustion
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)

	var req sandbox.EvalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	res, err := s.sandbox.Eval(r.Context(), req)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "sandbox evaluation error: "+err.Error())
		return
	}

	if s.audit != nil {
		codePreview := req.Code
		if len(codePreview) > 100 {
			codePreview = codePreview[:100] + "..."
		}
		severity := audit.SeverityInfo
		if !res.Success {
			severity = audit.SeverityWarn
		}
		_ = s.audit.Log(audit.Event{
			User:     s.getAuditUser(r),
			IP:       r.RemoteAddr,
			Action:   "sandbox.eval",
			Severity: severity,
			Target:   "goja",
			Details: map[string]any{
				"codePreview": codePreview,
				"success":     res.Success,
				"durationMs":  res.DurationMs,
				"allowWrite":  req.AllowWrite,
			},
		})
	}

	jsonResponse(w, http.StatusOK, res)
}
