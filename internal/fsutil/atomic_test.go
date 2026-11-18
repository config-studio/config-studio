package fsutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSafeWriteFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-fsutil-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	target := filepath.Join(tempDir, "test.txt")

	// 1. Initial write
	data1 := []byte("hello world")
	if err := SafeWriteFile(target, data1, 0644); err != nil {
		t.Fatalf("first SafeWriteFile failed: %v", err)
	}

	read, err := os.ReadFile(target)
	if err != nil || string(read) != string(data1) {
		t.Fatalf("unexpected content after write: %s", string(read))
	}

	// 2. Overwrite existing
	data2 := []byte("overwritten safely")
	if err := SafeWriteFile(target, data2, 0644); err != nil {
		t.Fatalf("second SafeWriteFile failed: %v", err)
	}

	read, err = os.ReadFile(target)
	if err != nil || string(read) != string(data2) {
		t.Fatalf("unexpected content after overwrite: %s", string(read))
	}
}

func TestCopyFileAndDir(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cs-fsutil-copy-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	srcDir := filepath.Join(tempDir, "src")
	dstDir := filepath.Join(tempDir, "dst")
	_ = os.MkdirAll(filepath.Join(srcDir, "sub"), 0755)

	file1 := filepath.Join(srcDir, "file1.txt")
	file2 := filepath.Join(srcDir, "sub", "file2.txt")
	_ = os.WriteFile(file1, []byte("content1"), 0644)
	_ = os.WriteFile(file2, []byte("content2"), 0644)

	if err := CopyDir(srcDir, dstDir); err != nil {
		t.Fatalf("CopyDir failed: %v", err)
	}

	dstFile1 := filepath.Join(dstDir, "file1.txt")
	dstFile2 := filepath.Join(dstDir, "sub", "file2.txt")
	if c, err := os.ReadFile(dstFile1); err != nil || string(c) != "content1" {
		t.Fatalf("failed reading copied file1: %v", err)
	}
	if c, err := os.ReadFile(dstFile2); err != nil || string(c) != "content2" {
		t.Fatalf("failed reading copied file2: %v", err)
	}
}

func TestIsWindowsSharingViolation_Strict(t *testing.T) {
	if isWindowsSharingViolation(nil) {
		t.Errorf("nil error must return false")
	}

	nonSharingErr := os.ErrNotExist
	if isWindowsSharingViolation(nonSharingErr) {
		t.Errorf("ErrNotExist must return false, got true")
	}

	// An arbitrary error string longer than 16 chars must NOT be classified as sharing violation
	generalErr := os.ErrInvalid
	if isWindowsSharingViolation(generalErr) {
		t.Errorf("ErrInvalid must return false, got true")
	}

	// Sharing violations must be recognized
	if !isWindowsSharingViolation(os.ErrPermission) {
		t.Errorf("ErrPermission must return true")
	}
}
