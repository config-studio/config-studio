package cspkg

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

var (
	// MagicBytes are the initial 4 bytes of any Config Studio Package file
	MagicBytes = [4]byte{'C', 'S', 'P', 'K'}

	// FormatVersion is current cspkg binary format version
	FormatVersion uint16 = 1

	ErrInvalidMagic   = errors.New("invalid cspkg file: magic header mismatch")
	ErrCorruptPackage = errors.New("corrupt cspkg: SHA-256 integrity verification failed")
	ErrMissingManifest = errors.New("invalid plugin: missing plugin.json manifest")
)

// Header represents the 48-byte binary header of a .cspkg file
type Header struct {
	Magic        [4]byte
	Version      uint16
	Flags        uint16
	PayloadSHA256 [32]byte
	ManifestSize uint32
	PayloadSize  uint32
}

// PackageInfo holds metadata about an inspected or packed .cspkg
type PackageInfo struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Version     string          `json:"version"`
	Description string          `json:"description"`
	Author      string          `json:"author"`
	FormatVer   uint16          `json:"formatVersion"`
	Checksum    string          `json:"checksumSha256"`
	Manifest    json.RawMessage `json:"manifest"`
	Files       []string        `json:"files"`
	TotalSize   int64           `json:"totalUncompressedSize"`
	PackedSize  int64           `json:"packedSize"`
}

// Pack compresses srcDir into a single .cspkg file at destFile
func Pack(srcDir string, destFile string) (*PackageInfo, error) {
	manifestPath := filepath.Join(srcDir, "plugin.json")
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMissingManifest, err)
	}

	var basicManifest struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Version     string `json:"version"`
		Description string `json:"description"`
		Author      string `json:"author"`
	}
	if err := json.Unmarshal(manifestBytes, &basicManifest); err != nil {
		return nil, fmt.Errorf("invalid plugin.json: %w", err)
	}
	if basicManifest.ID == "" || basicManifest.Version == "" {
		return nil, errors.New("plugin.json must specify 'id' and 'version'")
	}

	// Build zip archive of all valid files in srcDir
	var zipBuf bytes.Buffer
	zipWriter := zip.NewWriter(&zipBuf)

	var filesList []string
	var totalUncompressed int64

	err = filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}

		rel = filepath.ToSlash(rel)
		if rel == "." || rel == "" {
			return nil
		}

		// Skip VCS, development dirs, and build artifacts
		if strings.HasPrefix(rel, ".git") || strings.HasPrefix(rel, ".DS_Store") ||
			strings.HasPrefix(rel, "node_modules") || strings.HasSuffix(rel, ".cspkg") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if info.IsDir() {
			return nil
		}

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()

		w, err := zipWriter.Create(rel)
		if err != nil {
			return err
		}

		n, err := io.Copy(w, f)
		if err != nil {
			return err
		}

		filesList = append(filesList, rel)
		totalUncompressed += n
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to collect files: %w", err)
	}

	if err := zipWriter.Close(); err != nil {
		return nil, fmt.Errorf("failed to finalize payload: %w", err)
	}

	payloadBytes := zipBuf.Bytes()
	payloadHash := sha256.Sum256(payloadBytes)

	// Ensure output dir exists
	if err := os.MkdirAll(filepath.Dir(destFile), 0755); err != nil {
		return nil, err
	}

	out, err := os.Create(destFile)
	if err != nil {
		return nil, fmt.Errorf("failed to create output file: %w", err)
	}
	defer out.Close()

	// Write 48-byte binary header
	header := Header{
		Magic:         MagicBytes,
		Version:       FormatVersion,
		Flags:         0,
		PayloadSHA256: payloadHash,
		ManifestSize:  uint32(len(manifestBytes)),
		PayloadSize:   uint32(len(payloadBytes)),
	}

	if err := binary.Write(out, binary.LittleEndian, &header); err != nil {
		return nil, fmt.Errorf("failed to write header: %w", err)
	}

	// Write Manifest
	if _, err := out.Write(manifestBytes); err != nil {
		return nil, fmt.Errorf("failed to write manifest: %w", err)
	}

	// Write Payload
	if _, err := out.Write(payloadBytes); err != nil {
		return nil, fmt.Errorf("failed to write payload: %w", err)
	}

	stat, _ := out.Stat()
	packedSize := int64(0)
	if stat != nil {
		packedSize = stat.Size()
	}

	return &PackageInfo{
		ID:          basicManifest.ID,
		Name:        basicManifest.Name,
		Version:     basicManifest.Version,
		Description: basicManifest.Description,
		Author:      basicManifest.Author,
		FormatVer:   FormatVersion,
		Checksum:    fmt.Sprintf("%x", payloadHash),
		Manifest:    manifestBytes,
		Files:       filesList,
		TotalSize:   totalUncompressed,
		PackedSize:  packedSize,
	}, nil
}

// Inspect reads and validates a .cspkg file without extracting files to disk
func Inspect(cspkgPath string) (*PackageInfo, error) {
	data, err := os.ReadFile(cspkgPath)
	if err != nil {
		return nil, err
	}
	return InspectBytes(data)
}

// InspectBytes reads and validates raw .cspkg bytes
func InspectBytes(data []byte) (*PackageInfo, error) {
	headerSize := binary.Size(Header{})
	if len(data) < headerSize {
		return nil, errors.New("file too small to be a valid cspkg")
	}

	var header Header
	buf := bytes.NewReader(data[:headerSize])
	if err := binary.Read(buf, binary.LittleEndian, &header); err != nil {
		return nil, err
	}

	if header.Magic != MagicBytes {
		return nil, ErrInvalidMagic
	}

	offset := headerSize
	manifestEnd := offset + int(header.ManifestSize)
	if manifestEnd > len(data) {
		return nil, errors.New("corrupt header: manifest size exceeds file length")
	}

	manifestBytes := data[offset:manifestEnd]
	offset = manifestEnd

	payloadEnd := offset + int(header.PayloadSize)
	if payloadEnd > len(data) {
		return nil, errors.New("corrupt header: payload size exceeds file length")
	}

	payloadBytes := data[offset:payloadEnd]

	// Verify SHA-256 integrity
	actualHash := sha256.Sum256(payloadBytes)
	if actualHash != header.PayloadSHA256 {
		return nil, ErrCorruptPackage
	}

	var basicManifest struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Version     string `json:"version"`
		Description string `json:"description"`
		Author      string `json:"author"`
	}
	_ = json.Unmarshal(manifestBytes, &basicManifest)

	// Inspect payload zip directory
	zipReader, err := zip.NewReader(bytes.NewReader(payloadBytes), int64(len(payloadBytes)))
	if err != nil {
		return nil, fmt.Errorf("corrupt zip payload: %w", err)
	}

	var filesList []string
	var totalUncompressed int64
	for _, f := range zipReader.File {
		filesList = append(filesList, f.Name)
		totalUncompressed += int64(f.UncompressedSize64)
	}

	return &PackageInfo{
		ID:          basicManifest.ID,
		Name:        basicManifest.Name,
		Version:     basicManifest.Version,
		Description: basicManifest.Description,
		Author:      basicManifest.Author,
		FormatVer:   header.Version,
		Checksum:    fmt.Sprintf("%x", header.PayloadSHA256),
		Manifest:    manifestBytes,
		Files:       filesList,
		TotalSize:   totalUncompressed,
		PackedSize:  int64(len(data)),
	}, nil
}

// Unpack extracts a .cspkg file safely into targetDir
func Unpack(cspkgPath string, targetDir string) (*PackageInfo, error) {
	data, err := os.ReadFile(cspkgPath)
	if err != nil {
		return nil, err
	}
	return UnpackBytes(data, targetDir)
}

// UnpackBytes extracts raw .cspkg bytes safely into targetDir
func UnpackBytes(data []byte, targetDir string) (*PackageInfo, error) {
	info, err := InspectBytes(data)
	if err != nil {
		return nil, err
	}

	headerSize := binary.Size(Header{})
	manifestEnd := headerSize + int(binary.LittleEndian.Uint32(data[40:44]))
	payloadBytes := data[manifestEnd:]

	zipReader, err := zip.NewReader(bytes.NewReader(payloadBytes), int64(len(payloadBytes)))
	if err != nil {
		return nil, fmt.Errorf("failed to read payload: %w", err)
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, err
	}

	for _, file := range zipReader.File {
		// Reject symlinks
		if file.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("security violation: symlinks not permitted in package: %q", file.Name)
		}

		cleanName := filepath.Clean(file.Name)
		if strings.HasPrefix(cleanName, "..") || filepath.IsAbs(cleanName) ||
			filepath.VolumeName(cleanName) != "" || strings.Contains(cleanName, ":") {
			return nil, fmt.Errorf("security violation: path traversal detected in %q", file.Name)
		}

		destPath := filepath.Join(targetDir, cleanName)
		rel, err := filepath.Rel(targetDir, destPath)
		if err != nil || strings.HasPrefix(rel, "..") || rel == ".." {
			return nil, fmt.Errorf("security violation: path escapes target dir in %q", file.Name)
		}

		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(destPath, 0755); err != nil {
				return nil, err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return nil, err
		}

		rc, err := file.Open()
		if err != nil {
			return nil, err
		}

		// Enforce maximum 100MB per file to prevent decompression bombs
		const maxFileSize = 100 * 1024 * 1024
		lr := io.LimitReader(rc, maxFileSize+1)

		out, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode()&0755)
		if err != nil {
			rc.Close()
			return nil, err
		}

		n, err := io.Copy(out, lr)
		out.Close()
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("failed writing %s: %w", cleanName, err)
		}
		if n > maxFileSize {
			_ = os.Remove(destPath)
			return nil, fmt.Errorf("security violation: file %q exceeds maximum uncompressed size of 100MB", file.Name)
		}
	}

	return info, nil
}

// IsCSPKG checks if the first 4 bytes match MagicBytes
func IsCSPKG(r io.ReaderAt) bool {
	var magic [4]byte
	n, err := r.ReadAt(magic[:], 0)
	if err != nil || n < 4 {
		return false
	}
	return magic == MagicBytes
}

// OpenZipReader returns an archive/zip.Reader pointing to the payload inside the .cspkg file
func OpenZipReader(cspkgPath string) (*zip.Reader, error) {
	data, err := os.ReadFile(cspkgPath)
	if err != nil {
		return nil, err
	}
	return OpenZipReaderBytes(data)
}

// OpenZipReaderBytes parses raw .cspkg bytes and returns a zip.Reader for the payload
func OpenZipReaderBytes(data []byte) (*zip.Reader, error) {
	headerSize := binary.Size(Header{})
	if len(data) < headerSize {
		return nil, errors.New("file too small to be a valid cspkg")
	}

	var header Header
	buf := bytes.NewReader(data[:headerSize])
	if err := binary.Read(buf, binary.LittleEndian, &header); err != nil {
		return nil, err
	}

	if header.Magic != MagicBytes {
		return nil, ErrInvalidMagic
	}

	manifestEnd := headerSize + int(header.ManifestSize)
	payloadEnd := manifestEnd + int(header.PayloadSize)
	if payloadEnd > len(data) {
		return nil, errors.New("corrupt cspkg: payload bounds exceed file length")
	}

	payloadBytes := data[manifestEnd:payloadEnd]
	return zip.NewReader(bytes.NewReader(payloadBytes), int64(len(payloadBytes)))
}

// ReadFile reads and returns the contents of a specific relative path from inside a .cspkg package
func ReadFile(cspkgPath string, relPath string) ([]byte, error) {
	zr, err := OpenZipReader(cspkgPath)
	if err != nil {
		return nil, err
	}

	cleanRel := filepath.ToSlash(filepath.Clean(strings.TrimPrefix(relPath, "/")))

	for _, f := range zr.File {
		if filepath.ToSlash(filepath.Clean(f.Name)) == cleanRel {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}

	return nil, os.ErrNotExist
}
