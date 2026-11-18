package fs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupTestService(t *testing.T) (*Service, string, func()) {
	tmpDir, err := os.MkdirTemp("", "cs-fs-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	dataDir := filepath.Join(tmpDir, "data")
	workDir := filepath.Join(tmpDir, "configs")

	wm, err := NewWorkspaceManager(dataDir, workDir)
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatalf("failed to create workspace manager: %v", err)
	}

	svc, err := NewServiceWithManager(wm)
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatalf("failed to create fs service: %v", err)
	}

	cleanup := func() {
		os.RemoveAll(tmpDir)
	}

	return svc, workDir, cleanup
}

func TestSafePathRootPathTraversal(t *testing.T) {
	svc, _, cleanup := setupTestService(t)
	defer cleanup()

	traversalAttempts := []string{
		"../secret.txt",
		"../../etc/passwd",
		"..\\..\\windows\\system32",
		"foo/../../bar/../../outside.txt",
		"C:\\Windows\\System32\\cmd.exe",
		"C:/Windows/System32/cmd.exe",
	}

	for _, attack := range traversalAttempts {
		_, _, err := svc.SafePathRoot("default", attack)
		if err == nil {
			t.Errorf("security vulnerability: expected access denied for '%s', got nil error", attack)
			continue
		}
		if !strings.Contains(err.Error(), "access denied") && !strings.Contains(err.Error(), "outside") {
			t.Errorf("expected access denied error for '%s', got: %v", attack, err)
		}
	}
}

func TestSafePathRootValid(t *testing.T) {
	svc, workDir, cleanup := setupTestService(t)
	defer cleanup()

	resolved, root, err := svc.SafePathRoot("default", "nginx/nginx.conf")
	if err != nil {
		t.Fatalf("expected valid path, got error: %v", err)
	}
	if root.ID != "default" {
		t.Errorf("expected root 'default', got '%s'", root.ID)
	}

	expectedPrefix, _ := filepath.Abs(workDir)
	if !strings.HasPrefix(resolved, expectedPrefix) {
		t.Errorf("expected resolved path '%s' to start with '%s'", resolved, expectedPrefix)
	}
}

func TestFileCRUDOperations(t *testing.T) {
	svc, _, cleanup := setupTestService(t)
	defer cleanup()

	// 1. Create directory
	err := svc.CreateItemRoot("default", "nginx", true)
	if err != nil {
		t.Fatalf("failed to create directory: %v", err)
	}

	// 2. Create file
	err = svc.CreateItemRoot("default", "nginx/app.conf", false)
	if err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	// 3. Write file content
	content := []byte("server { listen 80; }")
	err = svc.WriteFileRoot("default", "nginx/app.conf", content, false)
	if err != nil {
		t.Fatalf("failed to write file: %v", err)
	}

	// 4. Read back
	readBack, err := svc.ReadFileRoot("default", "nginx/app.conf")
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}
	if string(readBack) != string(content) {
		t.Errorf("expected '%s', got '%s'", string(content), string(readBack))
	}

	// 5. List directory
	items, err := svc.ListDirRoot("default", "nginx")
	if err != nil {
		t.Fatalf("failed to list directory: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Name != "app.conf" {
		t.Errorf("expected item 'app.conf', got '%s'", items[0].Name)
	}

	// 6. Rename
	err = svc.RenameItemRoot("default", "nginx/app.conf", "nginx/production.conf")
	if err != nil {
		t.Fatalf("failed to rename file: %v", err)
	}

	// Verify rename
	items, _ = svc.ListDirRoot("default", "nginx")
	if len(items) != 1 || items[0].Name != "production.conf" {
		t.Errorf("expected renamed item 'production.conf'")
	}

	// 7. Delete
	err = svc.DeleteItemRoot("default", "nginx/production.conf")
	if err != nil {
		t.Fatalf("failed to delete file: %v", err)
	}
	items, _ = svc.ListDirRoot("default", "nginx")
	if len(items) != 0 {
		t.Errorf("expected empty directory after delete")
	}
}

func TestReadOnlyEnforcement(t *testing.T) {
	svc, _, cleanup := setupTestService(t)
	defer cleanup()

	// Add read-only workspace
	roDir := filepath.Join(os.TempDir(), "cs-ro-test")
	_ = os.MkdirAll(roDir, 0755)
	defer os.RemoveAll(roDir)

	err := svc.Workspaces.Add(WorkspaceRoot{
		ID:       "readonly-vault",
		Name:     "Read Only Vault",
		Path:     roDir,
		ReadOnly: true,
	})
	if err != nil {
		t.Fatalf("failed to add workspace: %v", err)
	}

	// Attempt write -> MUST fail
	err = svc.WriteFileRoot("readonly-vault", "hacked.conf", []byte("bad"), false)
	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Errorf("expected read-only error on WriteFileRoot, got: %v", err)
	}

	// Attempt create -> MUST fail
	err = svc.CreateItemRoot("readonly-vault", "subfolder", true)
	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Errorf("expected read-only error on CreateItemRoot, got: %v", err)
	}

	// Attempt delete -> MUST fail
	err = svc.DeleteItemRoot("readonly-vault", "anything")
	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Errorf("expected read-only error on DeleteItemRoot, got: %v", err)
	}

	// Attempt rename -> MUST fail
	err = svc.RenameItemRoot("readonly-vault", "old", "new")
	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Errorf("expected read-only error on RenameItemRoot, got: %v", err)
	}
}

func TestBatchReadRoot(t *testing.T) {
	svc, workDir, cleanup := setupTestService(t)
	defer cleanup()

	// 1. Create test files
	_ = os.MkdirAll(filepath.Join(workDir, "rules", "sub"), 0755)
	_ = os.WriteFile(filepath.Join(workDir, "rules", "mw-auth.yml"), []byte("auth: middleware"), 0644)
	_ = os.WriteFile(filepath.Join(workDir, "rules", "mw-rate.yml"), []byte("rate: 100/s"), 0644)
	_ = os.WriteFile(filepath.Join(workDir, "rules", "sub", "deep.yml"), []byte("deep: true"), 0644)
	_ = os.WriteFile(filepath.Join(workDir, "rules", "app.bin"), []byte{0x00, 0x01, 0x02}, 0644)
	_ = os.WriteFile(filepath.Join(workDir, "other.txt"), []byte("hello world"), 0644)

	// Test 1: Explicit paths
	res, err := svc.BatchReadRoot(BatchReadRequest{
		Paths: []string{"rules/mw-auth.yml", "rules/mw-rate.yml"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(res.Files))
	}
	if res.Files["rules/mw-auth.yml"] != "auth: middleware" {
		t.Errorf("unexpected content: %s", res.Files["rules/mw-auth.yml"])
	}

	// Test 2: Single-level glob
	res, err = svc.BatchReadRoot(BatchReadRequest{
		Pattern: "rules/*.yml",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Files) != 2 {
		t.Fatalf("expected 2 files for rules/*.yml, got %d", len(res.Files))
	}

	// Test 3: Recursive glob (**)
	res, err = svc.BatchReadRoot(BatchReadRequest{
		Pattern: "rules/**/*.yml",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Files) != 3 {
		t.Fatalf("expected 3 files for rules/**/*.yml, got %d", len(res.Files))
	}

	// Test 4: Binary file handling
	res, err = svc.BatchReadRoot(BatchReadRequest{
		Paths: []string{"rules/app.bin", "other.txt"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Files) != 1 || res.Files["other.txt"] != "hello world" {
		t.Errorf("expected only other.txt to be read, got: %v", res.Files)
	}
	if res.Errors["rules/app.bin"] != "binary file skipped" {
		t.Errorf("expected binary error for app.bin, got: %v", res.Errors)
	}

	// Test 5: Path traversal protection
	res, err = svc.BatchReadRoot(BatchReadRequest{
		Paths: []string{"../../outside.txt"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Files) != 0 {
		t.Errorf("expected 0 files for traversal, got %d", len(res.Files))
	}
	if len(res.Errors) == 0 {
		t.Errorf("expected traversal error in Errors map")
	}

	// Test 6: MaxFiles limit
	res, err = svc.BatchReadRoot(BatchReadRequest{
		Pattern:  "rules/**/*.yml",
		MaxFiles: 2,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Files) != 2 || !res.Truncated {
		t.Errorf("expected 2 files and truncated=true, got files=%d, truncated=%v", len(res.Files), res.Truncated)
	}
}

func TestSafePathRootSymlinkEscape(t *testing.T) {
	svc, workDir, cleanup := setupTestService(t)
	defer cleanup()

	// Create an external secret file outside the workDir
	outsideDir, err := os.MkdirTemp("", "cs-outside-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(outsideDir)

	secretFile := filepath.Join(outsideDir, "secret.conf")
	if err := os.WriteFile(secretFile, []byte("super-secret"), 0644); err != nil {
		t.Fatal(err)
	}

	symlinkPath := filepath.Join(workDir, "leak-link.conf")
	err = os.Symlink(secretFile, symlinkPath)
	if err != nil {
		t.Skipf("skipping symlink test (OS does not permit symlink creation): %v", err)
	}

	_, _, err = svc.SafePathRoot("default", "leak-link.conf")
	if err == nil {
		t.Fatalf("expected error accessing symlink pointing outside working directory, got nil")
	}
	if !strings.Contains(err.Error(), "symlink") && !strings.Contains(err.Error(), "access denied") {
		t.Errorf("expected symlink or access denied error, got: %v", err)
	}
}
