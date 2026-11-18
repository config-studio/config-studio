package plugin

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"config-studio/internal/cspkg"
)

func createTestPluginZip(t *testing.T, id, name, author string, permissions []string) []byte {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	manifestJSON := `{
		"id": "` + id + `",
		"name": "` + name + `",
		"version": "1.0.0",
		"author": "` + author + `",
		"entry": "main.js",
		"permissions": ["` + permissions[0] + `"]
	}`

	w, err := zw.Create("plugin.json")
	if err != nil {
		t.Fatalf("failed to create zip entry: %v", err)
	}
	if _, err := w.Write([]byte(manifestJSON)); err != nil {
		t.Fatalf("failed to write manifest: %v", err)
	}

	w2, err := zw.Create("main.js")
	if err != nil {
		t.Fatalf("failed to create main.js entry: %v", err)
	}
	if _, err := w2.Write([]byte("console.log('hello');")); err != nil {
		t.Fatalf("failed to write main.js: %v", err)
	}

	if err := zw.Close(); err != nil {
		t.Fatalf("failed to close zip writer: %v", err)
	}

	return buf.Bytes()
}

func TestInspectAndConfirmInstall(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-test-plugin-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	zipData := createTestPluginZip(t, "sample-plugin", "Sample Plugin", "ConfigStudio", []string{"shell.exec"})

	// 1. Inspect
	pending, err := mgr.InspectZip(bytes.NewReader(zipData), int64(len(zipData)), "")
	if err != nil {
		t.Fatalf("InspectZip failed: %v", err)
	}

	if pending.TempKey == "" {
		t.Errorf("expected TempKey to be non-empty")
	}
	if pending.Manifest.ID != "sample-plugin" {
		t.Errorf("expected ID 'sample-plugin', got %q", pending.Manifest.ID)
	}
	if !pending.IsOfficial {
		t.Errorf("expected IsOfficial to be true for ConfigStudio author")
	}

	// 2. Confirm Install
	installed, err := mgr.ConfirmInstall(pending.TempKey)
	if err != nil {
		t.Fatalf("ConfirmInstall failed: %v", err)
	}

	if installed.ID != "sample-plugin" {
		t.Errorf("expected installed plugin ID 'sample-plugin', got %q", installed.ID)
	}

	// Check if installed on disk as single-file .cspkg
	expectedPackage := filepath.Join(tempDir, "plugins", "sample-plugin.cspkg")
	if _, err := os.Stat(expectedPackage); err != nil {
		t.Errorf("expected package file %s to exist: %v", expectedPackage, err)
	}
	mainJs, err := cspkg.ReadFile(expectedPackage, "main.js")
	if err != nil || len(mainJs) == 0 {
		t.Errorf("failed to read main.js from installed cspkg: %v", err)
	}

	// Check if pending was removed
	mgr.mu.RLock()
	_, exists := mgr.pendingInstalls[pending.TempKey]
	mgr.mu.RUnlock()
	if exists {
		t.Errorf("expected pending install to be removed after confirmation")
	}
}

func TestInspectAndCancelInstall(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-test-plugin-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	zipData := createTestPluginZip(t, "cancel-plugin", "Cancel Plugin", "CommunityDev", []string{"network"})

	pending, err := mgr.InspectZip(bytes.NewReader(zipData), int64(len(zipData)), "")
	if err != nil {
		t.Fatalf("InspectZip failed: %v", err)
	}

	if pending.IsOfficial {
		t.Errorf("expected IsOfficial to be false for CommunityDev author")
	}

	// Cancel
	if err := mgr.CancelInstall(pending.TempKey); err != nil {
		t.Fatalf("CancelInstall failed: %v", err)
	}

	// Check if destination was not created
	destDir := filepath.Join(tempDir, "plugins", "cancel-plugin")
	if _, err := os.Stat(destDir); !os.IsNotExist(err) {
		t.Errorf("expected destination dir %s to not exist", destDir)
	}
}

func TestValidateCommandStrictConfirmation(t *testing.T) {
	// Risky command with unrestricted=true but confirmed=false should still require confirmation
	err := ValidateCommand("rm", []string{"-rf", "some_dir"}, true, false)
	if err == nil {
		t.Errorf("expected risky command to require confirmation even when unrestricted=true")
	}

	// With confirmed=true, it should pass
	err = ValidateCommand("rm", []string{"-rf", "some_dir"}, true, true)
	if err != nil {
		t.Errorf("expected confirmed command to pass, got: %v", err)
	}

	// Strict blacklist should NEVER pass, even if confirmed=true
	err = ValidateCommand("rm", []string{"-rf", "/"}, true, true)
	if err == nil {
		t.Errorf("expected blacklisted command 'rm -rf /' to be rejected even if confirmed")
	}
}

func TestPluginLocalesAndLocalization(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-test-locales-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	pluginsDir := filepath.Join(tempDir, "plugins")
	pDir := filepath.Join(pluginsDir, "demo-plugin")
	localesDir := filepath.Join(pDir, "locales")
	if err := os.MkdirAll(localesDir, 0755); err != nil {
		t.Fatalf("failed to create locales dir: %v", err)
	}

	// 1. plugin.json with inline locales and metadata
	manifestJSON := `{
		"id": "demo-plugin",
		"name": "Demo Plugin",
		"version": "1.0.0",
		"entry": "main.js",
		"locales": {
			"ru": {
				"name": "Демо плагин",
				"greeting": "Привет"
			}
		}
	}`
	_ = os.WriteFile(filepath.Join(pDir, "plugin.json"), []byte(manifestJSON), 0644)
	_ = os.WriteFile(filepath.Join(pDir, "main.js"), []byte("// demo"), 0644)

	// 2. Separate file in locales/en.json and override/add in locales/ru.json
	_ = os.WriteFile(filepath.Join(localesDir, "en.json"), []byte(`{"name":"Demo Plugin EN","greeting":"Hello"}`), 0644)
	_ = os.WriteFile(filepath.Join(localesDir, "ru.json"), []byte(`{"description":"Описание из файла"}`), 0644)

	// 3. localization.json for whole UI language pack
	_ = os.WriteFile(filepath.Join(pDir, "localization.json"), []byte(`{
		"code": "de",
		"name": "Deutsch",
		"flag": "🇩🇪",
		"translations": { "save": "Speichern" }
	}`), 0644)

	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	plugins, err := mgr.ListPlugins()
	if err != nil {
		t.Fatalf("ListPlugins failed: %v", err)
	}

	if len(plugins) != 1 {
		t.Fatalf("expected 1 plugin, got %d", len(plugins))
	}

	p := plugins[0]
	if p.Locales == nil {
		t.Fatalf("expected p.Locales to not be nil")
	}

	// Verify inline ru.greeting was preserved and file ru.description was merged
	if p.Locales["ru"]["greeting"] != "Привет" {
		t.Errorf("expected ru greeting 'Привет', got %q", p.Locales["ru"]["greeting"])
	}
	if p.Locales["ru"]["description"] != "Описание из файла" {
		t.Errorf("expected ru description 'Описание из файла', got %q", p.Locales["ru"]["description"])
	}

	// Verify en.json was loaded
	if p.Locales["en"]["greeting"] != "Hello" {
		t.Errorf("expected en greeting 'Hello', got %q", p.Locales["en"]["greeting"])
	}

	// Verify localization language pack was populated
	if p.Localization == nil {
		t.Fatalf("expected p.Localization to not be nil")
	}
	if p.Localization.Code != "de" || p.Localization.Name != "Deutsch" || p.Localization.Translations["save"] != "Speichern" {
		t.Errorf("unexpected localization pack: %+v", p.Localization)
	}
}

func TestLocalJsonLanguagePack(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-local-json-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	pDir := filepath.Join(tempDir, "plugins", "lang-ru")
	_ = os.MkdirAll(pDir, 0755)

	manifestContent := `{
		"id": "lang-ru",
		"name": "Русский языковой пакет",
		"version": "1.1.0",
		"description": "Russian pack",
		"entry": "main.js",
		"localization": {
			"code": "ru",
			"name": "Русский",
			"flag": "🇷🇺"
		}
	}`
	_ = os.WriteFile(filepath.Join(pDir, "plugin.json"), []byte(manifestContent), 0644)
	_ = os.WriteFile(filepath.Join(pDir, "main.js"), []byte(`console.log("ru");`), 0644)
	_ = os.WriteFile(filepath.Join(pDir, "local.json"), []byte(`{
		"appTitle": "Название приложения",
		"save": "Сохранить"
	}`), 0644)

	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	plugins, err := mgr.ListPlugins()
	if err != nil {
		t.Fatalf("ListPlugins failed: %v", err)
	}
	if len(plugins) != 1 {
		t.Fatalf("expected 1 plugin, got %d", len(plugins))
	}
	p := plugins[0]
	if p.Localization == nil {
		t.Fatalf("expected p.Localization to not be nil")
	}
	if p.Localization.Code != "ru" || p.Localization.Name != "Русский" || p.Localization.Flag != "🇷🇺" {
		t.Errorf("unexpected localization metadata: %+v", p.Localization)
	}
	if p.Localization.Translations["appTitle"] != "Название приложения" || p.Localization.Translations["save"] != "Сохранить" {
		t.Errorf("unexpected translations: %+v", p.Localization.Translations)
	}
}

func TestSemVerAndVersionConstraints(t *testing.T) {
	tests := []struct {
		installed  string
		constraint string
		expected   bool
	}{
		{"1.0.0", "", true},
		{"1.0.0", "*", true},
		{"1.0.0", "latest", true},
		{"1.2.3", ">=1.0.0", true},
		{"0.9.5", ">=1.0.0", false},
		{"2.0.0", ">=1.0.0", true},
		{"1.5.0", "<=1.5.0", true},
		{"1.5.1", "<=1.5.0", false},
		{"1.2.0", "^1.0.0", true},
		{"2.0.0", "^1.0.0", false},
		{"1.2.4", "~1.2.0", true},
		{"1.3.0", "~1.2.0", false},
		{"1.0.0", "1.0.0", true},
		{"1.0.1", "1.0.0", false},
		{"v2.1.0", ">=2.0.0", true},
	}

	for _, tc := range tests {
		actual := MatchesVersionConstraint(tc.installed, tc.constraint)
		if actual != tc.expected {
			t.Errorf("MatchesVersionConstraint(%q, %q) = %v; expected %v", tc.installed, tc.constraint, actual, tc.expected)
		}
	}
}

func TestPluginDependenciesAndCascadeProtection(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-test-deps-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	pluginsDir := filepath.Join(tempDir, "plugins")

	// 1. Install provider plugin: ssh-client (v1.2.0)
	sshDir := filepath.Join(pluginsDir, "ssh-client")
	_ = os.MkdirAll(sshDir, 0755)
	_ = os.WriteFile(filepath.Join(sshDir, "plugin.json"), []byte(`{
		"id": "ssh-client",
		"name": "SSH Client",
		"version": "1.2.0",
		"entry": "main.js",
		"providesServices": ["ssh"]
	}`), 0644)
	_ = os.WriteFile(filepath.Join(sshDir, "main.js"), []byte("console.log('ssh');"), 0644)

	// 2. Install consumer plugin: quick-deploy (v1.0.0) depending on ssh-client >= 1.0.0
	deployDir := filepath.Join(pluginsDir, "quick-deploy")
	_ = os.MkdirAll(deployDir, 0755)
	_ = os.WriteFile(filepath.Join(deployDir, "plugin.json"), []byte(`{
		"id": "quick-deploy",
		"name": "Quick Deploy",
		"version": "1.0.0",
		"entry": "main.js",
		"dependencies": {
			"ssh-client": ">=1.0.0"
		},
		"permissions": ["service:ssh"]
	}`), 0644)
	_ = os.WriteFile(filepath.Join(deployDir, "main.js"), []byte("console.log('deploy');"), 0644)

	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	plugins, err := mgr.ListPlugins()
	if err != nil {
		t.Fatalf("ListPlugins failed: %v", err)
	}

	// Verify dependents mapping: ssh-client should have quick-deploy in dependents
	var sshPlugin *Plugin
	for i := range plugins {
		if plugins[i].ID == "ssh-client" {
			sshPlugin = &plugins[i]
		}
	}
	if sshPlugin == nil {
		t.Fatalf("ssh-client plugin not found")
	}
	if len(sshPlugin.Dependents) != 1 || sshPlugin.Dependents[0] != "quick-deploy" {
		t.Errorf("expected ssh-client to have dependents ['quick-deploy'], got %v", sshPlugin.Dependents)
	}

	// 3. Test CheckDependencies for a new manifest requiring missing plugin
	issues := mgr.CheckDependencies(Manifest{
		ID: "analyzer",
		Dependencies: map[string]string{
			"ssh-client":     ">=1.0.0",
			"docker-manager": "*",
		},
	})
	if len(issues) != 1 || issues[0].PluginID != "docker-manager" || issues[0].Status != "missing" {
		t.Errorf("expected missing docker-manager issue, got %+v", issues)
	}

	// 4. Test Cascade Protection: attempting to disable ssh-client while quick-deploy is enabled must fail!
	err = mgr.TogglePlugin("ssh-client", false)
	if err == nil {
		t.Fatalf("expected error disabling ssh-client with active dependent, got nil")
	}
	var depErr *DependencyInUseError
	if !errorsAs(err, &depErr) {
		t.Fatalf("expected *DependencyInUseError, got: %T: %v", err, err)
	}

	// 5. Test Cascade Protection on Delete
	err = mgr.DeletePlugin("ssh-client")
	if err == nil {
		t.Fatalf("expected error deleting ssh-client with active dependent, got nil")
	}

	// 6. Once quick-deploy is disabled, ssh-client CAN be safely disabled
	if err := mgr.TogglePlugin("quick-deploy", false); err != nil {
		t.Fatalf("failed to disable quick-deploy: %v", err)
	}

	if err := mgr.TogglePlugin("ssh-client", false); err != nil {
		t.Errorf("expected ssh-client to be disableable when dependent is inactive, got: %v", err)
	}
}

func errorsAs(err error, target any) bool {
	type causer interface {
		As(any) bool
	}
	if c, ok := err.(causer); ok {
		return c.As(target)
	}
	if err == nil {
		return false
	}
	// direct type check for DependencyInUseError
	if depErrPtr, ok := target.(**DependencyInUseError); ok {
		if val, isType := err.(*DependencyInUseError); isType {
			*depErrPtr = val
			return true
		}
	}
	return false
}

func TestInspectAndInstallCSPKG(t *testing.T) {
	tempDir := t.TempDir()
	srcDir := filepath.Join(tempDir, "sample-pkg-src")
	_ = os.MkdirAll(srcDir, 0755)

	manifestJSON := `{
		"id": "binary-pkg-test",
		"name": "Binary Package Test",
		"version": "1.0.0",
		"author": "Config Studio Team",
		"entry": "main.js"
	}`
	_ = os.WriteFile(filepath.Join(srcDir, "plugin.json"), []byte(manifestJSON), 0644)
	_ = os.WriteFile(filepath.Join(srcDir, "main.js"), []byte("console.log('binary package');"), 0644)

	cspkgPath := filepath.Join(tempDir, "test.cspkg")
	_, err := cspkg.Pack(srcDir, cspkgPath)
	if err != nil {
		t.Fatalf("failed to pack cspkg: %v", err)
	}

	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	cspkgFile, err := os.Open(cspkgPath)
	if err != nil {
		t.Fatalf("failed to open cspkg: %v", err)
	}
	defer cspkgFile.Close()

	stat, _ := cspkgFile.Stat()

	// Inspect CSPKG
	pending, err := mgr.InspectZip(cspkgFile, stat.Size(), "https://example.com/test.cspkg")
	if err != nil {
		t.Fatalf("failed to inspect cspkg via manager: %v", err)
	}

	if pending.Manifest.ID != "binary-pkg-test" {
		t.Errorf("expected ID 'binary-pkg-test', got %s", pending.Manifest.ID)
	}

	// Confirm install
	installed, err := mgr.ConfirmInstall(pending.TempKey)
	if err != nil {
		t.Fatalf("failed to confirm install cspkg: %v", err)
	}

	if installed.ID != "binary-pkg-test" || !installed.Enabled {
		t.Errorf("installed plugin state mismatch: %+v", installed)
	}

	// Verify plugin exists on disk
	p, err := mgr.GetPlugin("binary-pkg-test")
	if err != nil {
		t.Fatalf("GetPlugin failed: %v", err)
	}
	if p.Manifest.Name != "Binary Package Test" {
		t.Errorf("Manifest name mismatch: %s", p.Manifest.Name)
	}
}

func TestInspectURLWithCSPKGRelease(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-test-url-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	srcDir := filepath.Join(tempDir, "src")
	_ = os.MkdirAll(srcDir, 0755)
	_ = os.WriteFile(filepath.Join(srcDir, "plugin.json"), []byte(`{
		"id": "url-cspkg-test",
		"name": "URL CSPKG Test",
		"version": "1.0.0",
		"entry": "main.js"
	}`), 0644)
	_ = os.WriteFile(filepath.Join(srcDir, "main.js"), []byte("console.log(1)"), 0644)

	cspkgPath := filepath.Join(tempDir, "url-cspkg-test.cspkg")
	if _, err := cspkg.Pack(srcDir, cspkgPath); err != nil {
		t.Fatalf("Pack failed: %v", err)
	}

	pkgBytes, err := os.ReadFile(cspkgPath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(pkgBytes)
	}))
	defer ts.Close()

	mgr, err := NewManager(filepath.Join(tempDir, "plugins"), nil)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	// 1. Test direct .cspkg URL
	pending, err := mgr.InspectURL(ts.URL + "/releases/download/v1.0.0/url-cspkg-test.cspkg")
	if err != nil {
		t.Fatalf("InspectURL failed for .cspkg URL: %v", err)
	}

	if pending.Manifest.ID != "url-cspkg-test" {
		t.Errorf("expected ID 'url-cspkg-test', got %s", pending.Manifest.ID)
	}

	// 2. Confirm install
	installed, err := mgr.ConfirmInstall(pending.TempKey)
	if err != nil {
		t.Fatalf("ConfirmInstall failed: %v", err)
	}

	if installed.ID != "url-cspkg-test" {
		t.Errorf("expected installed ID 'url-cspkg-test', got %s", installed.ID)
	}
}

func TestPluginOptionalDependencies(t *testing.T) {
	tempDir := t.TempDir()
	pluginsDir := filepath.Join(tempDir, "plugins")
	_ = os.MkdirAll(pluginsDir, 0755)

	// 1. Install optional helper plugin (v1.0.0)
	helperDir := filepath.Join(pluginsDir, "opt-helper")
	_ = os.MkdirAll(helperDir, 0755)
	_ = os.WriteFile(filepath.Join(helperDir, "plugin.json"), []byte(`{
		"id": "opt-helper",
		"name": "Optional Helper",
		"version": "1.0.0",
		"entry": "main.js",
		"providesServices": ["helper"]
	}`), 0644)
	_ = os.WriteFile(filepath.Join(helperDir, "main.js"), []byte("console.log('helper');"), 0644)

	// 2. Install consumer plugin with optionalDependencies
	consumerDir := filepath.Join(pluginsDir, "opt-consumer")
	_ = os.MkdirAll(consumerDir, 0755)
	_ = os.WriteFile(filepath.Join(consumerDir, "plugin.json"), []byte(`{
		"id": "opt-consumer",
		"name": "Optional Consumer",
		"version": "1.0.0",
		"entry": "main.js",
		"optionalDependencies": {
			"opt-helper": ">=1.0.0",
			"non-existent": "*"
		},
		"permissions": ["service:helper"]
	}`), 0644)
	_ = os.WriteFile(filepath.Join(consumerDir, "main.js"), []byte("console.log('consumer');"), 0644)

	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	plugins, err := mgr.ListPlugins()
	if err != nil {
		t.Fatalf("ListPlugins failed: %v", err)
	}

	// Verify dependents mapping: opt-helper should NOT have opt-consumer in Dependents (because it's optional)
	var helperPlugin *Plugin
	for i := range plugins {
		if plugins[i].ID == "opt-helper" {
			helperPlugin = &plugins[i]
		}
	}
	if helperPlugin == nil {
		t.Fatalf("opt-helper plugin not found")
	}
	if len(helperPlugin.Dependents) != 0 {
		t.Errorf("expected opt-helper to have 0 dependents, got %v", helperPlugin.Dependents)
	}

	// Test CheckDependencies: non-existent should be reported as missing with Optional=true
	issues := mgr.CheckDependencies(Manifest{
		ID: "test-manifest",
		OptionalDependencies: map[string]string{
			"opt-helper":   ">=1.0.0",
			"non-existent": "*",
		},
	})
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %d: %+v", len(issues), issues)
	}
	if issues[0].PluginID != "non-existent" || !issues[0].Optional || issues[0].Status != "missing" {
		t.Errorf("expected optional missing issue for non-existent, got %+v", issues[0])
	}

	// Test Cascade Protection: disabling opt-helper MUST SUCCEED (because opt-consumer only depends optionally)
	err = mgr.TogglePlugin("opt-helper", false)
	if err != nil {
		t.Fatalf("disabling opt-helper with optional dependent should succeed, got: %v", err)
	}

	// Now opt-helper is disabled; CheckDependencies should report opt-helper as disabled with Optional=true
	issuesDisabled := mgr.CheckDependencies(Manifest{
		ID: "test-manifest",
		OptionalDependencies: map[string]string{
			"opt-helper": ">=1.0.0",
		},
	})
	if len(issuesDisabled) != 1 || issuesDisabled[0].PluginID != "opt-helper" || !issuesDisabled[0].Optional || issuesDisabled[0].Status != "disabled" {
		t.Errorf("expected optional disabled issue for opt-helper, got %+v", issuesDisabled)
	}

	// Deleting opt-helper MUST also SUCCEED
	err = mgr.DeletePlugin("opt-helper")
	if err != nil {
		t.Fatalf("deleting opt-helper with optional dependent should succeed, got: %v", err)
	}
}

func TestInstall_PathTraversalManifestID(t *testing.T) {
	tempDir := t.TempDir()
	mgr, err := NewManager(tempDir, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	invalidIDs := []string{
		"../../traversal",
		"../escape",
		"sub/folder",
		"invalid id with spaces",
		"id_with_special_chars!@#$",
	}

	for _, invalidID := range invalidIDs {
		zipData := createTestPluginZip(t, invalidID, "Bad Plugin", "Attacker", []string{"shell.exec"})
		_, err := mgr.InspectZip(bytes.NewReader(zipData), int64(len(zipData)), "")
		if err == nil {
			t.Errorf("expected error for invalid/traversal plugin id %q, but got nil", invalidID)
		}
	}
}
