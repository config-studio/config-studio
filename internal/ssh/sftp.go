package ssh

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

// ListDirectory retrieves directory entries from a remote server via SFTP.
func (m *ClientManager) ListDirectory(ctx context.Context, req *SFTPRequest) ([]SFTPFileInfo, error) {
	if req.Path == "" {
		req.Path = "."
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
		TimeoutSec: 15,
	}

	client, err := m.Dial(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("ssh dial failed: %w", err)
	}
	defer client.Close()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return nil, fmt.Errorf("sftp client initialization failed: %w", err)
	}
	defer sftpClient.Close()

	// Normalize target path
	targetPath := req.Path
	if targetPath == "~" || targetPath == "" {
		targetPath = "."
	}

	// Resolve absolute path if relative
	if targetPath == "." {
		if realPath, err := sftpClient.RealPath("."); err == nil {
			targetPath = realPath
		}
	}

	entries, err := sftpClient.ReadDir(targetPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read remote directory %s: %w", targetPath, err)
	}

	result := make([]SFTPFileInfo, 0, len(entries))
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

	// Sort directories first, then alphabetical
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	return result, nil
}

// ReadFile retrieves the content of a remote file via SFTP.
func (m *ClientManager) ReadFile(ctx context.Context, req *SFTPRequest) ([]byte, error) {
	if req.Path == "" {
		return nil, errors.New("file path cannot be empty")
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
		TimeoutSec: 15,
	}

	client, err := m.Dial(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("ssh dial failed: %w", err)
	}
	defer client.Close()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return nil, fmt.Errorf("sftp client initialization failed: %w", err)
	}
	defer sftpClient.Close()

	f, err := sftpClient.Open(req.Path)
	if err != nil {
		return nil, fmt.Errorf("failed to open remote file %s: %w", req.Path, err)
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("failed to read remote file %s: %w", req.Path, err)
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
		TimeoutSec: 20,
	}

	client, err := m.Dial(ctx, cfg)
	if err != nil {
		return 0, fmt.Errorf("ssh dial failed: %w", err)
	}
	defer client.Close()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return 0, fmt.Errorf("sftp client initialization failed: %w", err)
	}
	defer sftpClient.Close()

	// Ensure parent directory exists
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
		return 0, fmt.Errorf("failed to open remote file %s for writing: %w", req.Path, err)
	}
	defer f.Close()

	_ = f.Chmod(mode)

	n, err := f.Write(rawBytes)
	if err != nil {
		return int64(n), fmt.Errorf("failed to write to remote file %s: %w", req.Path, err)
	}

	return int64(n), nil
}

// StatFile inspects remote file or directory metadata via SFTP.
func (m *ClientManager) StatFile(ctx context.Context, req *SFTPRequest) (*SFTPFileInfo, error) {
	if req.Path == "" {
		return nil, errors.New("path cannot be empty")
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
		TimeoutSec: 15,
	}

	client, err := m.Dial(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("ssh dial failed: %w", err)
	}
	defer client.Close()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return nil, fmt.Errorf("sftp client initialization failed: %w", err)
	}
	defer sftpClient.Close()

	fi, err := sftpClient.Stat(req.Path)
	if err != nil {
		return nil, fmt.Errorf("failed to stat remote path %s: %w", req.Path, err)
	}

	return &SFTPFileInfo{
		Name:    fi.Name(),
		Path:    req.Path,
		Size:    fi.Size(),
		Mode:    fi.Mode().String(),
		IsDir:   fi.IsDir(),
		ModTime: fi.ModTime().Format(time.RFC3339),
	}, nil
}

// MakeDirectory creates a remote directory (and any necessary parents) via SFTP.
func (m *ClientManager) MakeDirectory(ctx context.Context, req *SFTPRequest) error {
	if req.Path == "" {
		return errors.New("path cannot be empty")
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
		TimeoutSec: 15,
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

	return sftpClient.MkdirAll(req.Path)
}

// DeleteItem removes a remote file or recursively removes a directory via SFTP.
func (m *ClientManager) DeleteItem(ctx context.Context, req *SFTPRequest) error {
	if req.Path == "" || req.Path == "/" {
		return errors.New("cannot delete empty path or root directory")
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
		TimeoutSec: 20,
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

	if req.IsDir {
		return sftpClient.RemoveAll(req.Path)
	}
	return sftpClient.Remove(req.Path)
}

// RenameItem renames or moves a remote file/directory via SFTP.
func (m *ClientManager) RenameItem(ctx context.Context, req *SFTPRequest) error {
	if req.Path == "" || req.NewPath == "" {
		return errors.New("path and newPath cannot be empty")
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
		TimeoutSec: 15,
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

	return sftpClient.Rename(req.Path, req.NewPath)
}
