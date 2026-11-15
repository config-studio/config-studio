package logs

import (
	"testing"
)

func TestStripANSI(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "plain text",
			input:    "Hello world",
			expected: "Hello world",
		},
		{
			name:     "color codes",
			input:    "\x1b[31mRed text\x1b[0m and \x1b[32mgreen text\x1b[0m",
			expected: "Red text and green text",
		},
		{
			name:     "bold and background",
			input:    "\x1b[1;33;44mImportant Notice\x1b[0m",
			expected: "Important Notice",
		},
		{
			name:     "cursor movement and clear line",
			input:    "\x1b[2K\x1b[1GProgress: 100%",
			expected: "Progress: 100%",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := StripANSI(tt.input)
			if got != tt.expected {
				t.Errorf("StripANSI() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestDetectLevel(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		stream   string
		expected string
	}{
		{
			name:     "critical panic",
			line:     "panic: runtime error: invalid memory address",
			stream:   "stderr",
			expected: "crit",
		},
		{
			name:     "docker compose error",
			line:     "nginx-1 | 2026/11/16 00:45:12 [error] 14#14: *1 connect() failed",
			stream:   "stdout",
			expected: "error",
		},
		{
			name:     "warning line",
			line:     "Warning: slow query detected (2450ms)",
			stream:   "stdout",
			expected: "warn",
		},
		{
			name:     "debug line",
			line:     "[DEBUG] incoming request headers: ...",
			stream:   "stdout",
			expected: "debug",
		},
		{
			name:     "standard info line",
			line:     "Server listening on http://0.0.0.0:8080",
			stream:   "stdout",
			expected: "info",
		},
		{
			name:     "fallback stderr to error",
			line:     "Unknown stream data",
			stream:   "stderr",
			expected: "error",
		},
		{
			name:     "json log error",
			line:     `{"time":"2026-11-16T00:00:00Z","level":"error","msg":"connection lost"}`,
			stream:   "stdout",
			expected: "error",
		},
		{
			name:     "json log with severity",
			line:     `{"severity":"WARNING","message":"high memory usage"}`,
			stream:   "stdout",
			expected: "warn",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DetectLevel(tt.line, tt.stream)
			if got != tt.expected {
				t.Errorf("DetectLevel(%q, %q) = %q, want %q", tt.line, tt.stream, got, tt.expected)
			}
		})
	}
}

func TestParseLogLine(t *testing.T) {
	raw := "\x1b[31m[ERROR]\x1b[0m Service database connection timeout\n"
	entry := ParseLogLine(raw, "database", "stderr")

	if entry.Level != "error" {
		t.Errorf("expected level 'error', got %q", entry.Level)
	}
	if entry.Source != "database" {
		t.Errorf("expected source 'database', got %q", entry.Source)
	}
	if entry.Message != "[ERROR] Service database connection timeout" {
		t.Errorf("expected cleaned message, got %q", entry.Message)
	}
	if entry.Raw != raw {
		t.Errorf("expected raw string preserved, got %q", entry.Raw)
	}
	if entry.ID == "" {
		t.Error("expected non-empty entry ID")
	}

	// JSON extraction
	jsonRaw := `{"service":"auth-api","level":"warn","msg":"Rate limit reached for IP 1.2.3.4"}`
	jsonEntry := ParseLogLine(jsonRaw, "default", "stdout")
	if jsonEntry.Source != "auth-api" {
		t.Errorf("expected extracted source 'auth-api', got %q", jsonEntry.Source)
	}
	if jsonEntry.Message != "Rate limit reached for IP 1.2.3.4" {
		t.Errorf("expected extracted msg, got %q", jsonEntry.Message)
	}
	if jsonEntry.Level != "warn" {
		t.Errorf("expected level 'warn', got %q", jsonEntry.Level)
	}
}
