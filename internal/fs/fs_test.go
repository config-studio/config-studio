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
