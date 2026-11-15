package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompareSemver(t *testing.T) {
	tests := []struct {
		v1       string
		v2       string
		expected int
	}{
		{"2.3.0", "2.3.0", 0},
		{"v2.4.0", "2.3.0", 1},
		{"2.3.0", "v2.4.0", -1},
		{"2.3.1", "2.3.0", 1},
		{"2.3.0", "2.3.1", -1},
		{"3.0.0", "2.9.9", 1},
		{"2.3.0-beta.1", "2.3.0", 0},
		{"v2.10.0", "v2.9.0", 1},
	}

	for _, tc := range tests {
		got := CompareSemver(tc.v1, tc.v2)
		if got != tc.expected {
			t.Errorf("CompareSemver(%q, %q) = %d; want %d", tc.v1, tc.v2, got, tc.expected)
		}
	}
}

func TestHandleCheckSystemUpdateFallback(t *testing.T) {
	srv := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/system/check-update?repo=nonexistent/repo-for-testing", nil)
	w := httptest.NewRecorder()

	srv.handleCheckSystemUpdate(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var res SystemUpdateCheckResponse
	if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if res.CurrentVersion != coreSysInfoVersion {
		t.Errorf("expected currentVersion %q, got %q", coreSysInfoVersion, res.CurrentVersion)
	}
	if res.HasUpdate {
		t.Errorf("expected hasUpdate to be false on fallback")
	}
}
