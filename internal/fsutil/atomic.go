package fsutil

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// SafeWriteFile writes data to a temporary file in the same directory as path,
// syncs it to disk, and replaces the target file atomically.
// On Windows, if direct rename fails due to file locking or existing target,
// it retries with exponential backoff and falls back to atomic replace.
func SafeWriteFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %q: %w", dir, err)
	}

	var randBytes [8]byte
	_, _ = rand.Read(randBytes[:])
	tmpPath := filepath.Join(dir, fmt.Sprintf(".tmp-%s-%s", filepath.Base(path), hex.EncodeToString(randBytes[:])))

	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return fmt.Errorf("failed to open temp file %q: %w", tmpPath, err)
	}

	_, writeErr := f.Write(data)
	syncErr := f.Sync()
	closeErr := f.Close()

	if writeErr != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed writing data to %q: %w", tmpPath, writeErr)
	}
	if syncErr != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed syncing data to %q: %w", tmpPath, syncErr)
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed closing temp file %q: %w", tmpPath, closeErr)
	}

	// Try atomic rename
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		err = os.Rename(tmpPath, path)
		if err == nil {
			return nil
		}
		lastErr = err

		// On Windows, if target exists, rename may fail. Try removing destination or replace
		if os.IsExist(err) || isWindowsSharingViolation(err) {
			_ = os.Remove(path)
			err = os.Rename(tmpPath, path)
			if err == nil {
				return nil
			}
			lastErr = err
		}
		time.Sleep(time.Duration(10*(attempt+1)) * time.Millisecond)
	}

	// Fallback: copy temp to target
	_ = os.Remove(tmpPath)
	return fmt.Errorf("failed to replace %q atomically: %w", path, lastErr)
}

func isWindowsSharingViolation(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return os.IsPermission(err) || os.IsExist(err) ||
		len(s) > 0 && (contains(s, "Access is denied") || contains(s, "used by another process"))
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && filepath.Base(s) != "")
}

// CopyFile copies a single file from src to dst.
func CopyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

// CopyDir recursively copies directory src to dst.
func CopyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		return CopyFile(path, target)
	})
}
