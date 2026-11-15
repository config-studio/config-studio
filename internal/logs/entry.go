package logs

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

var (
	ansiPattern = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(\x07|\x1b\\)`)
	entrySeq    uint64
)

// LogEntry represents a single normalized log line emitted by the streaming service.
type LogEntry struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`  // "crit", "error", "warn", "info", "debug"
	Source    string    `json:"source"` // service name, container, or tag
	Message   string    `json:"message"`
	Raw       string    `json:"raw,omitempty"`
	Stream    string    `json:"stream"` // "stdout" | "stderr"
}

// StripANSI removes all ANSI escape codes (colors, cursor control, clears).
func StripANSI(text string) string {
	return ansiPattern.ReplaceAllString(text, "")
}

// DetectLevel inspects line content and stream type to assign a standardized severity.
func DetectLevel(text string, stream string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "info"
	}

	// 1. Check if the line is structured JSON log (e.g. Zap, Logrus, Pino, Bunyan)
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &obj); err == nil {
			if lvlVal, ok := obj["level"]; ok {
				if lvlStr, ok := lvlVal.(string); ok {
					normalized := NormalizeLevel(lvlStr)
					if normalized != "" {
						return normalized
					}
				}
			}
			if lvlVal, ok := obj["severity"]; ok {
				if lvlStr, ok := lvlVal.(string); ok {
					normalized := NormalizeLevel(lvlStr)
					if normalized != "" {
						return normalized
					}
				}
			}
		}
	}

	lower := strings.ToLower(trimmed)

	// Critical
	if strings.Contains(lower, "panic") ||
		strings.Contains(lower, "fatal") ||
		strings.Contains(lower, "critical") ||
		strings.Contains(lower, "emerg") ||
		strings.Contains(lower, "alert") {
		return "crit"
	}

	// Error
	if strings.Contains(lower, "error") ||
		strings.Contains(lower, "err ") ||
		strings.Contains(lower, "err:") ||
		strings.Contains(lower, "[err]") ||
		strings.Contains(lower, "[error]") ||
		strings.Contains(lower, "failed") ||
		strings.Contains(lower, "failure") ||
		strings.Contains(lower, "exception") ||
		strings.Contains(lower, "traceback") {
		return "error"
	}

	// Warning
	if strings.Contains(lower, "warn") ||
		strings.Contains(lower, "warning") ||
		strings.Contains(lower, "[warn]") ||
		strings.Contains(lower, "[warning]") {
		return "warn"
	}

	// Debug
	if strings.Contains(lower, "debug") ||
		strings.Contains(lower, "trace") ||
		strings.Contains(lower, "[debug]") ||
		strings.Contains(lower, "[trace]") {
		return "debug"
	}

	// Fallback for stderr: if nothing else matched, stderr usually denotes error/warning
	if stream == "stderr" {
		return "error"
	}

	return "info"
}

// NormalizeLevel converts various logging level representations into standard ones.
func NormalizeLevel(raw string) string {
	l := strings.ToLower(strings.TrimSpace(raw))
	switch l {
	case "emerg", "emergency", "alert", "crit", "critical", "fatal", "panic":
		return "crit"
	case "err", "error", "eror", "e":
		return "error"
	case "warn", "warning", "w":
		return "warn"
	case "debug", "trace", "d", "t":
		return "debug"
	case "info", "notice", "informational", "i":
		return "info"
	}
	return ""
}

// ParseLogLine parses a raw incoming line from stdout/stderr, strips ANSI, extracts metadata,
// and returns a structured LogEntry.
func ParseLogLine(rawLine string, defaultSource string, stream string) *LogEntry {
	seq := atomic.AddUint64(&entrySeq, 1)
	clean := StripANSI(rawLine)
	clean = strings.TrimRight(clean, "\r\n")

	source := defaultSource
	if source == "" {
		source = "log"
	}

	// Extract message if JSON
	msg := clean
	level := DetectLevel(clean, stream)

	if strings.HasPrefix(strings.TrimSpace(clean), "{") && strings.HasSuffix(strings.TrimSpace(clean), "}") {
		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(clean), &obj); err == nil {
			if m, ok := obj["msg"].(string); ok && m != "" {
				msg = m
			} else if m, ok := obj["message"].(string); ok && m != "" {
				msg = m
			}
			if s, ok := obj["service"].(string); ok && s != "" {
				source = s
			} else if s, ok := obj["source"].(string); ok && s != "" {
				source = s
			} else if s, ok := obj["component"].(string); ok && s != "" {
				source = s
			}
		}
	}

	id := fmt.Sprintf("log_%d_%d", time.Now().UnixNano()/int64(time.Millisecond), seq)

	return &LogEntry{
		ID:        id,
		Timestamp: time.Now().UTC(),
		Level:     level,
		Source:    source,
		Message:   msg,
		Raw:       rawLine,
		Stream:    stream,
	}
}
