package agent

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	DefaultStepDuration = 30 * time.Second
	DefaultDigits       = 6
)

// CleanBase32 strips spaces/hyphens and standardizes base32 strings.
func CleanBase32(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "-", "")
	return s
}

// DecodeSecret decodes a base32 encoded TOTP secret according to RFC 6238 / RFC 4226.
func DecodeSecret(secret string) ([]byte, error) {
	clean := CleanBase32(secret)
	if clean == "" {
		return nil, fmt.Errorf("empty secret")
	}
	// Base32 padding check
	if missingPadding := len(clean) % 8; missingPadding != 0 {
		clean += strings.Repeat("=", 8-missingPadding)
	}
	key, err := base32.StdEncoding.DecodeString(clean)
	if err != nil || len(key) == 0 {
		return nil, fmt.Errorf("invalid base32 secret: %w", err)
	}
	return key, nil
}

// GenerateTOTP generates an RFC 6238 TOTP code for the given time.
func GenerateTOTP(secret string, t time.Time, digits int) (string, error) {
	if digits <= 0 {
		digits = DefaultDigits
	}
	key, err := DecodeSecret(secret)
	if err != nil {
		return "", err
	}

	counter := uint64(t.Unix() / int64(DefaultStepDuration.Seconds()))
	var counterBytes [8]byte
	binary.BigEndian.PutUint64(counterBytes[:], counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(counterBytes[:])
	hash := mac.Sum(nil)

	// Dynamic truncation (RFC 4226)
	offset := hash[len(hash)-1] & 0x0f
	binaryCode := binary.BigEndian.Uint32(hash[offset : offset+4])
	binaryCode &= 0x7fffffff

	mod := uint32(math.Pow10(digits))
	otp := binaryCode % mod

	format := fmt.Sprintf("%%0%dd", digits)
	return fmt.Sprintf(format, otp), nil
}

// ValidateTOTP verifies if the provided code matches the secret within the given window steps.
// Returns (valid, stepMatched). Window = 1 means [-30s, 0, +30s].
func ValidateTOTP(secret, code string, t time.Time, window int, digits int) (bool, int64) {
	code = strings.TrimSpace(code)
	if len(code) == 0 {
		return false, 0
	}
	if digits <= 0 {
		digits = DefaultDigits
	}

	baseStep := t.Unix() / int64(DefaultStepDuration.Seconds())
	if window < 0 {
		window = 1
	}

	for w := -window; w <= window; w++ {
		targetStep := baseStep + int64(w)
		stepTime := time.Unix(targetStep*int64(DefaultStepDuration.Seconds()), 0)
		expected, err := GenerateTOTP(secret, stepTime, digits)
		if err == nil && hmac.Equal([]byte(expected), []byte(code)) {
			return true, targetStep
		}
	}

	return false, 0
}
