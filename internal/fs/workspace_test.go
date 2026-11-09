package fs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceManagerCRUD(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-workspace-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dataDir := filepath.Join(tmpDir, "data")
	defaultDir := filepath.Join(tmpDir, "configs")

	wm, err := NewWorkspaceManager(dataDir, defaultDir)
	if err != nil {
		t.Fatalf("failed to create workspace manager: %v", err)
	}

	// 1. Initial list should have 1 default root
	roots := wm.List()
	if len(roots) != 1 {
		t.Fatalf("expected 1 root, got %d", len(roots))
	}
	if roots[0].ID != "default" {
		t.Errorf("expected default root id 'default', got '%s'", roots[0].ID)
	}

	// 2. Add second root (e.g. nginx)
	nginxDir := filepath.Join(tmpDir, "nginx")
	err = wm.Add(WorkspaceRoot{
		ID:       "nginx",
		Name:     "Nginx Fleet",
		Path:     nginxDir,
		ReadOnly: false,
		Icon:     "server",
	})
	if err != nil {
		t.Fatalf("failed to add nginx workspace: %v", err)
	}

	roots = wm.List()
	if len(roots) != 2 {
		t.Fatalf("expected 2 roots, got %d", len(roots))
	}

	// 3. Prevent duplicate ID
	err = wm.Add(WorkspaceRoot{
		ID:   "nginx",
		Name: "Duplicate",
		Path: nginxDir,
	})
	if err == nil {
		t.Error("expected error adding duplicate root ID, got nil")
	}

	// 4. Update root
	err = wm.Update(WorkspaceRoot{
		ID:       "nginx",
		Name:     "Nginx Updated",
		ReadOnly: true,
		Icon:     "globe",
	})
	if err != nil {
		t.Fatalf("failed to update root: %v", err)
	}

	nginxRoot, ok := wm.Get("nginx")
	if !ok || nginxRoot.Name != "Nginx Updated" || !nginxRoot.ReadOnly {
		t.Errorf("unexpected updated root: %+v", nginxRoot)
	}

	// 5. Delete root
	err = wm.Delete("nginx")
	if err != nil {
		t.Fatalf("failed to delete root: %v", err)
	}
	if len(wm.List()) != 1 {
		t.Errorf("expected 1 root after deletion, got %d", len(wm.List()))
	}

	// 6. Cannot delete the only remaining root
	err = wm.Delete("default")
	if err == nil {
		t.Error("expected error deleting the last root, got nil")
	}
}

func TestMultiRootFileSystem(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-multifs-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dataDir := filepath.Join(tmpDir, "data")
	defaultDir := filepath.Join(tmpDir, "default")
	nginxDir := filepath.Join(tmpDir, "nginx")
	roDir := filepath.Join(tmpDir, "readonly")

	wm, err := NewWorkspaceManager(dataDir, defaultDir)
	if err != nil {
		t.Fatalf("failed to init wm: %v", err)
	}

	if err := wm.Add(WorkspaceRoot{
		ID:       "nginx",
		Name:     "Nginx",
		Path:     nginxDir,
		ReadOnly: false,
	}); err != nil {
		t.Fatalf("failed to add nginx: %v", err)
	}

	if err := wm.Add(WorkspaceRoot{
		ID:       "sys",
		Name:     "System",
		Path:     roDir,
		ReadOnly: true,
	}); err != nil {
		t.Fatalf("failed to add readonly root: %v", err)
	}

	svc, err := NewServiceWithManager(wm)
	if err != nil {
		t.Fatalf("failed to init service: %v", err)
	}

	// 1. Write file to default root
	err = svc.WriteFile("test.txt", []byte("hello default"), false)
	if err != nil {
		t.Fatalf("failed to write to default: %v", err)
	}

	// 2. Write file to nginx root using rootID
	err = svc.WriteFileRoot("nginx", "nginx.conf", []byte("events {}"), false)
	if err != nil {
		t.Fatalf("failed to write to nginx root: %v", err)
	}

	// 3. Write file to nginx root using compound path
	err = svc.WriteFile("nginx:conf.d/app.conf", []byte("server {}"), false)
	if err != nil {
		t.Fatalf("failed to write compound path: %v", err)
	}

	// 4. Verify contents
	content, err := svc.ReadFileRoot("nginx", "nginx.conf")
	if err != nil || string(content) != "events {}" {
		t.Errorf("read nginx.conf mismatch: %s, err: %v", string(content), err)
	}

	content2, err := svc.ReadFile("nginx:conf.d/app.conf")
	if err != nil || string(content2) != "server {}" {
		t.Errorf("read app.conf mismatch: %s, err: %v", string(content2), err)
	}

	// 5. Test ReadOnly protection
	err = svc.WriteFileRoot("sys", "danger.conf", []byte("boom"), false)
	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Errorf("expected read-only error, got: %v", err)
	}

	// 6. Test Path Traversal protection
	_, err = svc.SafePath("nginx:../../etc/passwd")
	if err == nil {
		t.Error("expected traversal error, got nil")
	}

	// 7. Test ListDirRoot
	items, err := svc.ListDirRoot("nginx", "")
	if err != nil {
		t.Fatalf("failed to list nginx: %v", err)
	}
	if len(items) != 2 { // conf.d (dir) and nginx.conf (file)
		t.Errorf("expected 2 items in nginx root, got %d", len(items))
	}
	for _, it := range items {
		if it.Root != "nginx" {
			t.Errorf("expected item root 'nginx', got '%s'", it.Root)
		}
		if !strings.HasPrefix(it.FullRelPath, "nginx:") {
			t.Errorf("expected FullRelPath with nginx: prefix, got '%s'", it.FullRelPath)
		}
	}

	// 8. Test Search across all roots
	searchResults, err := svc.SearchFiles("conf")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(searchResults) < 2 {
		t.Errorf("expected at least 2 conf files across roots, got %d", len(searchResults))
	}
}

func TestResolveRootDefaultAlias(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-workspace-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dataDir := filepath.Join(tmpDir, "data")
	defaultDir := filepath.Join(tmpDir, "test_files")

	wm, err := NewWorkspaceManager(dataDir, defaultDir)
	if err != nil {
		t.Fatalf("failed to create workspace manager: %v", err)
	}

	// Rename root to custom id (like test_files)
	wm.mu.Lock()
	wm.roots[0].ID = "test_files"
	wm.defaultRoot = "test_files"
	wm.mu.Unlock()

	// Should resolve "default" to "test_files"
	root, rel, err := wm.ResolveRootAndRel("default", "rules/app.yml")
	if err != nil {
		t.Fatalf("failed to resolve root 'default': %v", err)
	}
	if root.ID != "test_files" {
		t.Errorf("expected root 'test_files', got '%s'", root.ID)
	}
	if rel != "rules/app.yml" {
		t.Errorf("expected rel 'rules/app.yml', got '%s'", rel)
	}

	// Should strip prefix when compound path has root id: "test_files:rules/app.yml"
	root2, rel2, err2 := wm.ResolveRootAndRel("test_files", "test_files:rules/app.yml")
	if err2 != nil {
		t.Fatalf("failed to resolve root with compound path: %v", err2)
	}
	if root2.ID != "test_files" {
		t.Errorf("expected root 'test_files', got '%s'", root2.ID)
	}
	if rel2 != "rules/app.yml" {
		t.Errorf("expected rel 'rules/app.yml', got '%s'", rel2)
	}
}

