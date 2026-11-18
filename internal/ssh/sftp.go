package ssh

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

// withSFTP handles dialing, client lifecycle, error wrapping and cleanup in a single place.
func (m *ClientManager) withSFTP(ctx context.Context, req *SFTPRequest, timeoutSec int, fn func(sftpClient *sftp.Client) error) error {
	if timeoutSec <= 0 {
		timeoutSec = 15
	}
	cfg := &Config{
		Host:       req.Host,
		Port:       req.Port,
		User:       req.User,
		AuthType:   req.AuthType,
		Password:   req.Password,
		PrivateKey: req.PrivateKey,
		Passphrase: req.Passphrase,
		IdentityID: req.IdentityID,
		JumpHost:   req.JumpHost,
		TimeoutSec: timeoutSec,
	}

	client, err := m.Dial(ctx, cfg)
	if err != nil {
		return fmt.Errorf("ssh dial failed: %w", err)
	}
	defer client.Close()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return fmt.Errorf("sftp client initialization failed: %w", err)
	}
	defer sftpClient.Close()

	return fn(sftpClient)
}

// ListDirectory retrieves directory entries from a remote server via SFTP.
func (m *ClientManager) ListDirectory(ctx context.Context, req *SFTPRequest) ([]SFTPFileInfo, error) {
	if req.Path == "" {
		req.Path = "."
	}

	var result []SFTPFileInfo
	err := m.withSFTP(ctx, req, 15, func(sftpClient *sftp.Client) error {
		targetPath := req.Path
		if targetPath == "~" || targetPath == "" {
			targetPath = "."
		}

		if targetPath == "." {
			if realPath, err := sftpClient.RealPath("."); err == nil {
				targetPath = realPath
			}
		}

		entries, err := sftpClient.ReadDir(targetPath)
		if err != nil {
			return fmt.Errorf("failed to read remote directory %s: %w", targetPath, err)
		}

		result = make([]SFTPFileInfo, 0, len(entries))
		for _, entry := range entries {
			entryPath := path.Join(targetPath, entry.Name())
			result = append(result, SFTPFileInfo{
				Name:    entry.Name(),
				Path:    entryPath,
				Size:    entry.Size(),
				Mode:    entry.Mode().String(),
				IsDir:   entry.IsDir(),
				ModTime: entry.ModTime().Format(time.RFC3339),
			})
		}

		sort.Slice(result, func(i, j int) bool {
			if result[i].IsDir != result[j].IsDir {
				return result[i].IsDir
			}
			return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
		})
		return nil
	})

	if err != nil {
		return nil, err
	}
	return result, nil
}

// ReadFile retrieves the content of a remote file via SFTP.
func (m *ClientManager) ReadFile(ctx context.Context, req *SFTPRequest) ([]byte, error) {
	if req.Path == "" {
		return nil, errors.New("file path cannot be empty")
	}

	var data []byte
	err := m.withSFTP(ctx, req, 15, func(sftpClient *sftp.Client) error {
		f, err := sftpClient.Open(req.Path)
		if err != nil {
			return fmt.Errorf("failed to open remote file %s: %w", req.Path, err)
		}
		defer f.Close()

		var readErr error
		data, readErr = io.ReadAll(f)
		if readErr != nil {
			return fmt.Errorf("failed to read remote file %s: %w", req.Path, readErr)
		}
		return nil
	})

	if err != nil {
		return nil, err
	}
	return data, nil
}

// WriteFile writes or updates a remote file via SFTP.
func (m *ClientManager) WriteFile(ctx context.Context, req *SFTPRequest) (int64, error) {
	if req.Path == "" {
		return 0, errors.New("file path cannot be empty")
	}

	var rawBytes []byte
	var err error

	if req.Encoding == "base64" {
		rawBytes, err = base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			return 0, fmt.Errorf("invalid base64 content: %w", err)
		}
	} else {
		rawBytes = []byte(req.Content)
	}

	var written int64
	err = m.withSFTP(ctx, req, 20, func(sftpClient *sftp.Client) error {
		dir := path.Dir(req.Path)
		if dir != "" && dir != "/" && dir != "." {
			_ = sftpClient.MkdirAll(dir)
		}

		mode := os.FileMode(0644)
		if req.Mode > 0 {
			mode = os.FileMode(req.Mode)
		}

		f, err := sftpClient.OpenFile(req.Path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
		if err != nil {
			return fmt.Errorf("failed to open remote file %s for writing: %w", req.Path, err)
		}
		defer f.Close()

		_ = f.Chmod(mode)

		n, err := f.Write(rawBytes)
		written = int64(n)
		if err != nil {
			return fmt.Errorf("failed to write to remote file %s: %w", req.Path, err)
		}
		return nil
	})

	return written, err
}

// StatFile inspects remote file or directory metadata via SFTP.
func (m *ClientManager) StatFile(ctx context.Context, req *SFTPRequest) (*SFTPFileInfo, error) {
	if req.Path == "" {
		return nil, errors.New("path cannot be empty")
	}

	var fileInfo *SFTPFileInfo
	err := m.withSFTP(ctx, req, 15, func(sftpClient *sftp.Client) error {
		fi, err := sftpClient.Stat(req.Path)
		if err != nil {
			return fmt.Errorf("failed to stat remote path %s: %w", req.Path, err)
		}

		fileInfo = &SFTPFileInfo{
			Name:    fi.Name(),
			Path:    req.Path,
			Size:    fi.Size(),
			Mode:    fi.Mode().String(),
			IsDir:   fi.IsDir(),
			ModTime: fi.ModTime().Format(time.RFC3339),
		}
		return nil
	})

	if err != nil {
		return nil, err
	}
	return fileInfo, nil
}

// MakeDirectory creates a remote directory (and any necessary parents) via SFTP.
func (m *ClientManager) MakeDirectory(ctx context.Context, req *SFTPRequest) error {
	if req.Path == "" {
		return errors.New("path cannot be empty")
	}

	return m.withSFTP(ctx, req, 15, func(sftpClient *sftp.Client) error {
		return sftpClient.MkdirAll(req.Path)
	})
}

// DeleteItem removes a remote file or recursively removes a directory via SFTP.
func (m *ClientManager) DeleteItem(ctx context.Context, req *SFTPRequest) error {
	if req.Path == "" || req.Path == "/" {
		return errors.New("cannot delete empty path or root directory")
	}

	return m.withSFTP(ctx, req, 20, func(sftpClient *sftp.Client) error {
		if req.IsDir {
			return sftpClient.RemoveAll(req.Path)
		}
		return sftpClient.Remove(req.Path)
	})
}

// RenameItem renames or moves a remote file/directory via SFTP.
func (m *ClientManager) RenameItem(ctx context.Context, req *SFTPRequest) error {
	if req.Path == "" || req.NewPath == "" {
		return errors.New("path and newPath cannot be empty")
	}

	return m.withSFTP(ctx, req, 15, func(sftpClient *sftp.Client) error {
		return sftpClient.Rename(req.Path, req.NewPath)
	})
}

func isBinarySFTP(data []byte) bool {
	n := len(data)
	if n > 512 {
		n = 512
	}
	for _, b := range data[:n] {
		if b == 0 {
			return true
		}
	}
	return false
}

func matchSFTPGlob(pattern, relPath string) bool {
	pattern = strings.ReplaceAll(pattern, "\\", "/")
	relPath = strings.ReplaceAll(relPath, "\\", "/")
	pattern = strings.TrimPrefix(pattern, "./")
	relPath = strings.TrimPrefix(relPath, "./")

	if pattern == "*" || pattern == "**" || pattern == "**/*" {
		return true
	}

	if !strings.Contains(pattern, "**") {
		if !strings.Contains(pattern, "/") {
			if matched, _ := path.Match(pattern, path.Base(relPath)); matched {
				return true
			}
		}
		if matched, _ := path.Match(pattern, relPath); matched {
			return true
		}
		return false
	}

	var sb strings.Builder
	sb.WriteString("(?i)^")
	i := 0
	n := len(pattern)
	for i < n {
		if i+4 <= n && pattern[i:i+4] == "/**/" {
			sb.WriteString("(?:/.+/|/)")
			i += 4
		} else if i+3 <= n && pattern[i:i+3] == "/**" {
			sb.WriteString("(?:/.*)?")
			i += 3
		} else if i+3 <= n && pattern[i:i+3] == "**/" {
			sb.WriteString("(?:^|.*/)")
			i += 3
		} else if i+2 <= n && pattern[i:i+2] == "**" {
			sb.WriteString(".*")
			i += 2
		} else if pattern[i] == '*' {
			sb.WriteString("[^/]*")
			i++
		} else if pattern[i] == '?' {
			sb.WriteString("[^/]")
			i++
		} else {
			sb.WriteString(regexp.QuoteMeta(string(pattern[i])))
			i++
		}
	}
	sb.WriteString("$")

	re, err := regexp.Compile(sb.String())
	if err != nil {
		return false
	}
	return re.MatchString(relPath)
}

// BatchReadFile reads multiple remote files matching paths or glob patterns via SFTP.
func (m *ClientManager) BatchReadFile(ctx context.Context, req *SFTPBatchReadRequest) (*SFTPBatchReadResult, error) {
	sftpReq := &SFTPRequest{
		Host:       req.Host,
		Port:       req.Port,
		User:       req.User,
		AuthType:   req.AuthType,
		Password:   req.Password,
		PrivateKey: req.PrivateKey,
		Passphrase: req.Passphrase,
		IdentityID: req.IdentityID,
		JumpHost:   req.JumpHost,
	}

	maxFiles := req.MaxFiles
	if maxFiles <= 0 {
		maxFiles = 100
	} else if maxFiles > 500 {
		maxFiles = 500
	}

	maxSizeBytes := req.MaxSizeBytes
	if maxSizeBytes <= 0 {
		maxSizeBytes = 5 * 1024 * 1024 // 5 MB default
	} else if maxSizeBytes > 10*1024*1024 {
		maxSizeBytes = 10 * 1024 * 1024
	}

	res := &SFTPBatchReadResult{
		Files:  make(map[string]string),
		Errors: make(map[string]string),
	}

	err := m.withSFTP(ctx, sftpReq, 15, func(sftpClient *sftp.Client) error {
		candSet := make(map[string]bool)
		var candidateList []string

		// 1. Explicit paths
		for _, p := range req.Paths {
			clean := path.Clean(p)
			if clean != "" && clean != "." && !candSet[clean] {
				candSet[clean] = true
				candidateList = append(candidateList, clean)
			}
		}

		// 2. Glob patterns
		var patterns []string
		if req.Pattern != "" {
			patterns = append(patterns, req.Pattern)
		}
		patterns = append(patterns, req.Patterns...)

		baseDir := req.BaseDir
		if baseDir == "" {
			baseDir = "."
		}

		if len(patterns) > 0 {
			walker := sftpClient.Walk(baseDir)
			for walker.Step() {
				if err := walker.Err(); err != nil {
					continue
				}
				stat := walker.Stat()
				if stat.IsDir() {
					if strings.HasPrefix(stat.Name(), ".") && stat.Name() != "." {
						walker.SkipDir()
					}
					continue
				}

				remotePath := walker.Path()
				relToBasename := path.Base(remotePath)
				relPath := strings.TrimPrefix(remotePath, baseDir)
				relPath = strings.TrimPrefix(relPath, "/")

				for _, pat := range patterns {
					if matched, _ := path.Match(pat, relToBasename); matched ||
						matchSFTPGlob(pat, relPath) ||
						matchSFTPGlob(pat, remotePath) {
						if !candSet[remotePath] {
							candSet[remotePath] = true
							candidateList = append(candidateList, remotePath)
						}
						break
					}
				}
			}
		}

		sort.Strings(candidateList)

		var totalSize int64
		for _, p := range candidateList {
			if len(res.Files) >= maxFiles {
				res.Truncated = true
				break
			}

			st, err := sftpClient.Stat(p)
			if err != nil {
				res.Errors[p] = err.Error()
				continue
			}
			if st.IsDir() {
				continue
			}

			if (totalSize + st.Size()) > maxSizeBytes {
				res.Truncated = true
				break
			}

			f, err := sftpClient.Open(p)
			if err != nil {
				res.Errors[p] = err.Error()
				continue
			}

			data, err := io.ReadAll(f)
			_ = f.Close()
			if err != nil {
				res.Errors[p] = err.Error()
				continue
			}

			if isBinarySFTP(data) {
				res.Errors[p] = "binary file skipped"
				continue
			}

			res.Files[p] = string(data)
			totalSize += int64(len(data))
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	res.Count = len(res.Files)
	if len(res.Errors) == 0 {
		res.Errors = nil
	}

	return res, nil
}
