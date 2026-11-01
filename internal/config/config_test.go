package config

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultSettings(t *testing.T) {
	s := DefaultSettings()
	if s.AppTitle != "Config Studio" {
		t.Errorf("expected AppTitle 'Config Studio', got '%s'", s.AppTitle)
	}
	if s.Language != "ru" {
		t.Errorf("expected Language 'ru', got '%s'", s.Language)
	}
	if s.ThemeMode != "dark" {
		t.Errorf("expected ThemeMode 'dark', got '%s'", s.ThemeMode)
	}
	if !s.StructureGuardEnabled {
		t.Errorf("expected StructureGuardEnabled to be true by default")
	}
}

func TestManagerLoadAndSave(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	// Initial settings should have defaults
	s := mgr.Get()
	if s.AppTitle != "Config Studio" {
		t.Errorf("expected default AppTitle, got '%s'", s.AppTitle)
	}

	// Update settings
	update := Settings{
		AppTitle:    "Custom Studio",
		AccentColor: "#ff0055",
		Language:    "en",
		AuthEnabled: true,
		AuthUser:    "alice",
		AuthPass:    "secret123",
	}
	if err := mgr.Update(update); err != nil {
		t.Fatalf("failed to update settings: %v", err)
	}

	// Re-load with a new manager to verify persistence to disk
	mgr2, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create second manager: %v", err)
	}

	s2 := mgr2.Get()
	if s2.AppTitle != "Custom Studio" {
		t.Errorf("expected persisted AppTitle 'Custom Studio', got '%s'", s2.AppTitle)
	}
	if s2.AccentColor != "#ff0055" {
		t.Errorf("expected persisted AccentColor '#ff0055', got '%s'", s2.AccentColor)
	}
	if s2.Language != "en" {
		t.Errorf("expected persisted Language 'en', got '%s'", s2.Language)
	}
	if !s2.AuthEnabled {
		t.Errorf("expected persisted AuthEnabled to be true")
	}
	if s2.AuthUser != "alice" {
		t.Errorf("expected persisted AuthUser 'alice', got '%s'", s2.AuthUser)
	}
}

func TestPasswordRedaction(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-config-pwd-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	_ = mgr.Update(Settings{
		AuthUser: "admin",
		AuthPass: "supersecret",
	})

	// Get() MUST NEVER expose AuthPass
	s := mgr.Get()
	if s.AuthPass != "" {
		t.Errorf("security violation: AuthPass leaked in Get(): '%s'", s.AuthPass)
	}

	// But CheckAuth and CheckPass must still work internally
	if !mgr.CheckAuth("admin", "supersecret") {
		t.Errorf("expected CheckAuth to succeed for valid credentials")
	}
	if mgr.CheckAuth("admin", "wrong") {
		t.Errorf("expected CheckAuth to fail for wrong password")
	}
	if !mgr.CheckPass("supersecret") {
		t.Errorf("expected CheckPass to succeed for valid password")
	}
	if mgr.CheckPass("wrong") {
		t.Errorf("expected CheckPass to fail for wrong password")
	}
}

func TestSaveIconAndMimeDetection(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-config-icon-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	// 1. Initially no custom icon
	if mgr.Get().HasCustomIcon {
		t.Errorf("expected HasCustomIcon to be false initially")
	}

	// 2. Save SVG icon
	svgData := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>`)
	if err := mgr.SaveIcon(bytes.NewReader(svgData), "icon.svg"); err != nil {
		t.Fatalf("failed to save svg icon: %v", err)
	}

	if !mgr.Get().HasCustomIcon {
		t.Errorf("expected HasCustomIcon to be true after saving icon")
	}
	if mgr.GetIconMime() != "image/svg+xml" {
		t.Errorf("expected MIME 'image/svg+xml', got '%s'", mgr.GetIconMime())
	}
	if _, err := os.Stat(filepath.Join(tmpDir, "custom-icon")); os.IsNotExist(err) {
		t.Errorf("custom-icon file was not created on disk")
	}

	// 3. Save PNG icon
	pngHeader := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR...")
	if err := mgr.SaveIcon(bytes.NewReader(pngHeader), "logo.png"); err != nil {
		t.Fatalf("failed to save png icon: %v", err)
	}
	if mgr.GetIconMime() != "image/png" {
		t.Errorf("expected MIME 'image/png', got '%s'", mgr.GetIconMime())
	}
}
