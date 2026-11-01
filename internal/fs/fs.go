package fs

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type FileItem struct {
	Name        string    `json:"name"`
	Path        string    `json:"path"`
	Root        string    `json:"root,omitempty"`
	FullRelPath string    `json:"fullRelPath,omitempty"`
	IsDir       bool      `json:"isDir"`
	Size        int64     `json:"size"`
	ModTime     time.Time `json:"modTime"`
	CreatedAt   time.Time `json:"createdAt"`
	Extension   string    `json:"extension"`
}

type Service struct {
	WorkDir    string
	Workspaces *WorkspaceManager
}

// NewService creates a filesystem service with a single default workdir.
func NewService(workDir string) (*Service, error) {
	abs, err := filepath.Abs(workDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0755); err != nil {
		return nil, err
	}
	wm := NewInMemoryWorkspaceManager(abs)
	return &Service{
		WorkDir:    abs,
		Workspaces: wm,
	}, nil
}

// NewServiceWithManager creates a filesystem service backed by a WorkspaceManager.
func NewServiceWithManager(wm *WorkspaceManager) (*Service, error) {
	defaultRootID := wm.DefaultRoot()
	workDir := ""
	if root, ok := wm.Get(defaultRootID); ok {
		workDir = root.Path
	}
	return &Service{
		WorkDir:    workDir,
		Workspaces: wm,
	}, nil
}

// ensureWorkspaces guarantees that Workspaces is non-nil.
func (s *Service) ensureWorkspaces() *WorkspaceManager {
	if s.Workspaces == nil {
		s.Workspaces = NewInMemoryWorkspaceManager(s.WorkDir)
	}
	return s.Workspaces
}

// SafePathRoot resolves and validates a relative path inside a specific workspace root.
func (s *Service) SafePathRoot(rootID, rel string) (string, WorkspaceRoot, error) {
	wm := s.ensureWorkspaces()
	root, cleanRel, err := wm.ResolveRootAndRel(rootID, rel)
	if err != nil {
		return "", WorkspaceRoot{}, err
	}

	// Reject volume names (e.g. "C:"), colons, or absolute paths in relative path
	if filepath.VolumeName(cleanRel) != "" || strings.Contains(cleanRel, ":") {
		return "", root, errors.New("access denied: absolute paths or drive letters are not allowed")
	}

	clean := filepath.Clean(filepath.Join(root.Path, cleanRel))

	// Ensure the cleaned path is still inside root.Path
	if clean != root.Path && !strings.HasPrefix(clean, root.Path+string(filepath.Separator)) {
		return "", root, errors.New("access denied: path is outside working directory")
	}
	return clean, root, nil
}

// SafePath validates a relative path inside the default or compound workspace root.
func (s *Service) SafePath(rel string) (string, error) {
	p, _, err := s.SafePathRoot("", rel)
	return p, err
}

// ListDirRoot lists directory items within a specific workspace root.
func (s *Service) ListDirRoot(rootID, rel string) ([]FileItem, error) {
	fullPath, root, err := s.SafePathRoot(rootID, rel)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	items := make([]FileItem, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		itemRel := filepath.Join(rel, entry.Name())
		itemRel = filepath.ToSlash(itemRel)

		modTime, createTime := GetFileTimes(info)

		items = append(items, FileItem{
			Name:        entry.Name(),
			Path:        itemRel,
			Root:        root.ID,
			FullRelPath: root.ID + ":" + itemRel,
			IsDir:       entry.IsDir(),
			Size:        info.Size(),
			ModTime:     modTime,
			CreatedAt:   createTime,
			Extension:   strings.ToLower(filepath.Ext(entry.Name())),
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir // directories first
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return items, nil
}

// ListDir lists directory items within the default or compound workspace root.
func (s *Service) ListDir(rel string) ([]FileItem, error) {
	return s.ListDirRoot("", rel)
}

// SearchFilesRoot searches files in a specific root, or across all roots if rootID is empty.
func (s *Service) SearchFilesRoot(rootID, query string) ([]FileItem, error) {
	wm := s.ensureWorkspaces()
	var searchRoots []WorkspaceRoot

	if rootID != "" {
		root, ok := wm.Get(rootID)
		if !ok {
			return nil, fmt.Errorf("workspace root '%s' not found", rootID)
		}
		searchRoots = []WorkspaceRoot{root}
	} else {
		searchRoots = wm.List()
	}

	items := make([]FileItem, 0)
	q := strings.ToLower(strings.TrimSpace(query))

	for _, root := range searchRoots {
		if len(items) >= 200 {
			break
		}

		_ = filepath.Walk(root.Path, func(path string, info os.FileInfo, err error) error {
			if err != nil || path == root.Path {
				return nil
			}
			// Skip hidden directories (like .git, .cache)
			if info.IsDir() && strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}

			rel, err := filepath.Rel(root.Path, path)
			if err != nil {
				return nil
			}
			rel = filepath.ToSlash(rel)

			nameLower := strings.ToLower(info.Name())
			relLower := strings.ToLower(rel)

			if q == "" || strings.Contains(nameLower, q) || strings.Contains(relLower, q) {
				modTime, createTime := GetFileTimes(info)
				items = append(items, FileItem{
					Name:        info.Name(),
					Path:        rel,
					Root:        root.ID,
					FullRelPath: root.ID + ":" + rel,
					IsDir:       info.IsDir(),
					Size:        info.Size(),
					ModTime:     modTime,
					CreatedAt:   createTime,
					Extension:   strings.ToLower(filepath.Ext(info.Name())),
				})
			}

			if len(items) >= 200 {
				return filepath.SkipDir
			}
			return nil
		})
	}

	if q != "" {
		sort.Slice(items, func(i, j int) bool {
			if items[i].IsDir != items[j].IsDir {
				return !items[i].IsDir
			}
			iName := strings.ToLower(items[i].Name)
			jName := strings.ToLower(items[j].Name)

			iExact := iName == q
			jExact := jName == q
			if iExact != jExact {
				return iExact
			}

			iPrefix := strings.HasPrefix(iName, q)
			jPrefix := strings.HasPrefix(jName, q)
			if iPrefix != jPrefix {
				return iPrefix
			}

			iContainsName := strings.Contains(iName, q)
			jContainsName := strings.Contains(jName, q)
			if iContainsName != jContainsName {
				return iContainsName
			}

			return iName < jName
		})
	} else {
		sort.Slice(items, func(i, j int) bool {
			if items[i].IsDir != items[j].IsDir {
				return !items[i].IsDir
			}
			return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		})
	}

	if len(items) > 50 {
		items = items[:50]
	}

	return items, nil
}

// SearchFiles searches across all roots.
func (s *Service) SearchFiles(query string) ([]FileItem, error) {
	return s.SearchFilesRoot("", query)
}

// ReadFileRoot reads file content from a specific workspace root.
func (s *Service) ReadFileRoot(rootID, rel string) ([]byte, error) {
	fullPath, _, err := s.SafePathRoot(rootID, rel)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(fullPath)
}

// ReadFile reads file content from the default or compound workspace root.
func (s *Service) ReadFile(rel string) ([]byte, error) {
	return s.ReadFileRoot("", rel)
}

// WriteFileRoot writes file content to a specific workspace root with backup support.
func (s *Service) WriteFileRoot(rootID, rel string, content []byte, createBackup bool) error {
	fullPath, root, err := s.SafePathRoot(rootID, rel)
	if err != nil {
		return err
	}

	if root.ReadOnly {
		return fmt.Errorf("workspace root '%s' is read-only", root.Name)
	}

	// Create parent directories if they don't exist
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return err
	}

	if createBackup {
		if _, err := os.Stat(fullPath); err == nil {
			bakPath := fullPath + ".bak"
			_ = copyFile(fullPath, bakPath)
		}
	}

	return os.WriteFile(fullPath, content, 0644)
}

// WriteFile writes file content to default or compound workspace root.
func (s *Service) WriteFile(rel string, content []byte, createBackup bool) error {
	return s.WriteFileRoot("", rel, content, createBackup)
}

// CreateItemRoot creates a file or folder inside a specific workspace root.
func (s *Service) CreateItemRoot(rootID, rel string, isDir bool) error {
	fullPath, root, err := s.SafePathRoot(rootID, rel)
	if err != nil {
		return err
	}

	if root.ReadOnly {
		return fmt.Errorf("workspace root '%s' is read-only", root.Name)
	}

	if isDir {
		return os.MkdirAll(fullPath, 0755)
	}

	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return err
	}

	f, err := os.OpenFile(fullPath, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	return f.Close()
}

// CreateItem creates a file or folder inside default or compound workspace root.
func (s *Service) CreateItem(rel string, isDir bool) error {
	return s.CreateItemRoot("", rel, isDir)
}

// DeleteItemRoot deletes a file or directory from a specific workspace root.
func (s *Service) DeleteItemRoot(rootID, rel string) error {
	fullPath, root, err := s.SafePathRoot(rootID, rel)
	if err != nil {
		return err
	}

	if root.ReadOnly {
		return fmt.Errorf("workspace root '%s' is read-only", root.Name)
	}

	if fullPath == root.Path {
		return errors.New("cannot delete root working directory")
	}

	return os.RemoveAll(fullPath)
}

// DeleteItem deletes a file or directory from default or compound workspace root.
func (s *Service) DeleteItem(rel string) error {
	return s.DeleteItemRoot("", rel)
}

// RenameItemRoot renames a file or directory within a workspace root.
func (s *Service) RenameItemRoot(rootID, oldRel, newRel string) error {
	oldPath, rootOld, err := s.SafePathRoot(rootID, oldRel)
	if err != nil {
		return err
	}

	newPath, rootNew, err := s.SafePathRoot(rootID, newRel)
	if err != nil {
		return err
	}

	if rootOld.ReadOnly || rootNew.ReadOnly {
		return errors.New("workspace root is read-only")
	}

	if err := os.MkdirAll(filepath.Dir(newPath), 0755); err != nil {
		return err
	}
	return os.Rename(oldPath, newPath)
}

// RenameItem renames a file or directory in default or compound workspace root.
func (s *Service) RenameItem(oldRel, newRel string) error {
	return s.RenameItemRoot("", oldRel, newRel)
}

// UploadFileRoot uploads a file to a specific directory within a workspace root.
func (s *Service) UploadFileRoot(rootID, dirRel, filename string, r io.Reader) (string, error) {
	dirPath, root, err := s.SafePathRoot(rootID, dirRel)
	if err != nil {
		return "", err
	}

	if root.ReadOnly {
		return "", fmt.Errorf("workspace root '%s' is read-only", root.Name)
	}

	safeName := filepath.Base(filename)
	if safeName == "." || safeName == "/" || safeName == "" {
		return "", fmt.Errorf("invalid filename: %s", filename)
	}

	targetPath := filepath.Join(dirPath, safeName)
	dst, err := os.Create(targetPath)
	if err != nil {
		return "", err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, r); err != nil {
		return "", err
	}

	return filepath.ToSlash(filepath.Join(dirRel, safeName)), nil
}

// UploadFile uploads a file to default or compound workspace root.
func (s *Service) UploadFile(dirRel, filename string, r io.Reader) (string, error) {
	return s.UploadFileRoot("", dirRel, filename, r)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
