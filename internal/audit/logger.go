package audit

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const maxMemoryEvents = 1000

// Logger handles structured append-only audit event logging and querying.
type Logger struct {
	filePath string
	mu       sync.RWMutex
	file     *os.File
	ring     []Event // in-memory cache of recent events
}

// NewLogger initializes the audit logger using the specified data directory.
func NewLogger(dataDir string) (*Logger, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create audit directory: %w", err)
	}

	auditPath := filepath.Join(dataDir, "audit.jsonl")
	file, err := os.OpenFile(auditPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0640)
	if err != nil {
		return nil, fmt.Errorf("failed to open audit.jsonl: %w", err)
	}

	l := &Logger{
		filePath: auditPath,
		file:     file,
		ring:     make([]Event, 0, maxMemoryEvents),
	}

	// Warm-up in-memory cache from recent disk entries
	l.loadRecentFromDisk()

	return l, nil
}

// loadRecentFromDisk reads the last events from the file into the in-memory ring buffer.
func (l *Logger) loadRecentFromDisk() {
	f, err := os.Open(l.filePath)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	var all []Event
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var evt Event
		if err := json.Unmarshal(line, &evt); err == nil {
			all = append(all, evt)
		}
	}

	// Keep only the last maxMemoryEvents
	if len(all) > maxMemoryEvents {
		l.ring = all[len(all)-maxMemoryEvents:]
	} else {
		l.ring = all
	}
}

func inferCategory(action, severity string) string {
	act := strings.ToLower(action)
	sev := strings.ToLower(severity)
	if sev == SeverityCritical || sev == SeverityError || strings.HasPrefix(act, "ui.") || strings.HasSuffix(act, ".error") {
		return CategoryError
	}
	if strings.HasPrefix(act, "net.") {
		return CategoryNetwork
	}
	if strings.HasPrefix(act, "system.") {
		return CategorySystem
	}
	if strings.HasPrefix(act, "plugin.") {
		if act == ActionPluginInstall || act == ActionPluginToggle || act == ActionPluginDelete {
			return CategoryUser
		}
		return CategoryPlugin
	}
	if strings.HasPrefix(act, "file.") || strings.HasPrefix(act, "shell.") || strings.HasPrefix(act, "server.") {
		return CategoryUser
	}
	return CategorySystem
}

// Log records a new audit event to disk and in-memory buffer.
func (l *Logger) Log(evt Event) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if evt.ID == "" {
		evt.ID = fmt.Sprintf("aud_%d_%04d", time.Now().UnixMilli(), time.Now().Nanosecond()%10000)
	}
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	if evt.Severity == "" {
		evt.Severity = SeverityInfo
	}
	if evt.Category == "" {
		evt.Category = inferCategory(evt.Action, evt.Severity)
	}
	if evt.Source == "" {
		evt.Source = "backend"
	}
	if evt.SourceID == "" {
		evt.SourceID = "core"
	}

	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("failed to marshal audit event: %w", err)
	}

	if _, err := l.file.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("failed to write audit event to disk: %w", err)
	}
	_ = l.file.Sync()

	// Append to in-memory buffer
	if len(l.ring) >= maxMemoryEvents {
		copy(l.ring, l.ring[1:])
		l.ring[len(l.ring)-1] = evt
	} else {
		l.ring = append(l.ring, evt)
	}

	return nil
}

// Query filters and paginates audit events from the in-memory cache (newest first).
func (l *Logger) Query(filter QueryFilter) QueryResult {
	l.mu.RLock()
	defer l.mu.RUnlock()

	searchLower := strings.ToLower(filter.Search)
	actionFilter := strings.ToLower(filter.Action)
	severityFilter := strings.ToLower(filter.Severity)

	var matched []Event

	// Iterate in reverse chronological order (newest first)
	for i := len(l.ring) - 1; i >= 0; i-- {
		evt := l.ring[i]

		if severityFilter != "" && strings.ToLower(evt.Severity) != severityFilter {
			continue
		}
		if filter.Category != "" && strings.ToLower(evt.Category) != strings.ToLower(filter.Category) {
			continue
		}
		if filter.Source != "" && strings.ToLower(evt.Source) != strings.ToLower(filter.Source) {
			continue
		}
		if actionFilter != "" && !strings.Contains(strings.ToLower(evt.Action), actionFilter) {
			continue
		}
		if !filter.From.IsZero() && evt.Timestamp.Before(filter.From) {
			continue
		}
		if !filter.To.IsZero() && evt.Timestamp.After(filter.To) {
			continue
		}
		if searchLower != "" {
			targetMatch := strings.Contains(strings.ToLower(evt.Target), searchLower)
			userMatch := strings.Contains(strings.ToLower(evt.User), searchLower)
			actionMatch := strings.Contains(strings.ToLower(evt.Action), searchLower)
			ipMatch := strings.Contains(strings.ToLower(evt.IP), searchLower)
			if !targetMatch && !userMatch && !actionMatch && !ipMatch {
				continue
			}
		}

		matched = append(matched, evt)
	}

	total := len(matched)
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	if offset > total {
		return QueryResult{Events: []Event{}, Total: total}
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	end := offset + limit
	if end > total {
		end = total
	}

	return QueryResult{
		Events: matched[offset:end],
		Total:  total,
	}
}

// Export streams the raw audit.jsonl file content without holding lock across client download.
func (l *Logger) Export(w io.Writer) error {
	f, err := os.Open(l.filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(w, f)
	return err
}

// LogSystem is a convenience method for backend internal telemetry logging.
func (l *Logger) LogSystem(category, action, severity, target string, details map[string]any) error {
	return l.Log(Event{
		Source:   "backend",
		SourceID: "core",
		Category: category,
		User:     "system",
		IP:       "127.0.0.1",
		Action:   action,
		Severity: severity,
		Target:   target,
		Details:  details,
	})
}

// Close closes the underlying audit file.
func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		return l.file.Close()
	}
	return nil
}
