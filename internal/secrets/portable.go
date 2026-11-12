package secrets

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"golang.org/x/crypto/pbkdf2"
)

var (
	MagicHeader            = []byte("CSBK")
	ErrInvalidBackupFormat = errors.New("invalid backup format or magic header")
	ErrInvalidPassphrase   = errors.New("invalid passphrase or corrupted archive")
	ErrEmptyPassphrase     = errors.New("passphrase cannot be empty")
)

const (
	BundleVersion    byte = 0x01
	PBKDF2Iterations      = 100000
	SaltLength            = 32
)

// PortableBundleContainer represents the unencrypted bundle content.
type PortableBundleContainer struct {
	ExportedAt string       `json:"exportedAt"`
	Version    int          `json:"version"`
	Secrets    []SecretItem `json:"secrets"`
}

// PortableImportResult captures statistics for a portable bundle import.
type PortableImportResult struct {
	Total    int      `json:"total"`
	Imported int      `json:"imported"`
	Updated  int      `json:"updated"`
	Errors   []string `json:"errors,omitempty"`
}

// ExportPortable packages and encrypts all secrets into a portable byte stream.
func (m *Manager) ExportPortable(passphrase string) ([]byte, error) {
	if len(stringsTrim(passphrase)) == 0 {
		return nil, ErrEmptyPassphrase
	}

	allMeta := m.List()
	items := make([]SecretItem, 0, len(allMeta))

	for _, meta := range allMeta {
		val, err := m.Get(meta.ID)
		if err != nil {
			continue
		}
		items = append(items, SecretItem{
			SecretMeta: meta,
			Value:      val,
		})
	}

	container := PortableBundleContainer{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Version:    1,
		Secrets:    items,
	}

	plaintext, err := json.Marshal(container)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal secrets container: %w", err)
	}

	// 1. Generate random salt
	salt := make([]byte, SaltLength)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, fmt.Errorf("failed to generate crypto salt: %w", err)
	}

	// 2. Derive 32-byte key via PBKDF2
	key := pbkdf2.Key([]byte(passphrase), salt, PBKDF2Iterations, 32, sha256.New)

	// 3. Encrypt via AES-256-GCM
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("cipher initialization error: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm initialization error: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Additional data is magic header + version
	ad := append([]byte(nil), MagicHeader...)
	ad = append(ad, BundleVersion)

	ciphertext := gcm.Seal(nil, nonce, plaintext, ad)

	// Result structure: MagicHeader(4) + Version(1) + Salt(32) + Nonce(12) + Ciphertext(variable)
	var buf bytes.Buffer
	buf.Write(MagicHeader)
	buf.WriteByte(BundleVersion)
	buf.Write(salt)
	buf.Write(nonce)
	buf.Write(ciphertext)

	return buf.Bytes(), nil
}

// ImportPortable decrypts and imports secrets from a portable byte stream.
func (m *Manager) ImportPortable(data []byte, passphrase string) (*PortableImportResult, error) {
	if len(stringsTrim(passphrase)) == 0 {
		return nil, ErrEmptyPassphrase
	}

	minLen := len(MagicHeader) + 1 + SaltLength + 12 + 16 // 4+1+32+12+16 = 65 bytes min
	if len(data) < minLen {
		return nil, ErrInvalidBackupFormat
	}

	if !bytes.Equal(data[:len(MagicHeader)], MagicHeader) {
		return nil, ErrInvalidBackupFormat
	}

	version := data[4]
	if version != BundleVersion {
		return nil, fmt.Errorf("unsupported backup bundle version: 0x%02x", version)
	}

	offset := 5
	salt := data[offset : offset+SaltLength]
	offset += SaltLength

	nonceSize := 12
	nonce := data[offset : offset+nonceSize]
	offset += nonceSize

	ciphertext := data[offset:]

	key := pbkdf2.Key([]byte(passphrase), salt, PBKDF2Iterations, 32, sha256.New)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("cipher initialization error: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm initialization error: %w", err)
	}

	ad := append([]byte(nil), MagicHeader...)
	ad = append(ad, BundleVersion)

	plaintext, err := gcm.Open(nil, nonce, ciphertext, ad)
	if err != nil {
		return nil, ErrInvalidPassphrase
	}

	var container PortableBundleContainer
	if err := json.Unmarshal(plaintext, &container); err != nil {
		return nil, fmt.Errorf("corrupted container payload: %w", err)
	}

	res := &PortableImportResult{
		Total:  len(container.Secrets),
		Errors: make([]string, 0),
	}

	for _, sec := range container.Secrets {
		if sec.ID == "" {
			continue
		}
		exists := m.Has(sec.ID)
		err := m.Set(sec)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("Failed to import secret %q: %v", sec.ID, err))
			continue
		}
		if exists {
			res.Updated++
		} else {
			res.Imported++
		}
	}

	return res, nil
}

func stringsTrim(s string) string {
	var start, end int
	for start < len(s) && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n' || s[start] == '\r') {
		start++
	}
	end = len(s)
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}
