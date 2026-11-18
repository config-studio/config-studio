package guard

import (
	"path/filepath"
	"strings"
)

// DefaultSensitivePatterns contains baseline masks for critical files.
var DefaultSensitivePatterns = []string{
	// Docker & Compose
	"docker-compose*.yml",
	"docker-compose*.yaml",
	"compose*.yml",
	"compose*.yaml",
	"Dockerfile",
	"*.dockerfile",

	// Web Servers & Proxies
	"nginx.conf",
	"*/nginx.conf",
	"nginx/**",
	"/etc/nginx/**",
	"conf.d/*.conf",
	"sites-available/**",
	"sites-enabled/**",
	"Caddyfile",
	"traefik.yaml",
	"traefik.yml",

	// System Services
	"*.service",
	"*.timer",
	"*.socket",
	"/etc/systemd/system/**",
	"systemd/**",

	// Production & Environment
	"prod.env",
	"production.env",
	"*.prod.env",
	"*.production.env",
	".env.prod",
	".env.production",
	"prod.yaml",
	"prod.yml",
	"production.yaml",
	"production.yml",
	"*.prod.yaml",
	"*.prod.yml",
	"*.production.yaml",
	"*.production.yml",
}

// MatchPattern checks if a file path matches a glob pattern (supporting ** and basename).
func MatchPattern(pattern, path string) bool {
	pattern = filepath.ToSlash(strings.TrimSpace(pattern))
	path = filepath.ToSlash(strings.TrimSpace(path))
	if pattern == "" || path == "" {
		return false
	}

	lowerPattern := strings.ToLower(pattern)
	lowerPath := strings.ToLower(path)
	base := filepath.Base(lowerPath)

	// If pattern has no slash, match directly against base filename
	if !strings.Contains(lowerPattern, "/") {
		if matched, err := filepath.Match(lowerPattern, base); err == nil && matched {
			return true
		}
	}

	// Standard glob match on full path
	if matched, err := filepath.Match(lowerPattern, lowerPath); err == nil && matched {
		return true
	}

	// Double asterisk wildcard (** / directory tree)
	if strings.Contains(lowerPattern, "**") {
		parts := strings.Split(lowerPattern, "**")
		if len(parts) == 2 {
			prefix := strings.TrimSuffix(parts[0], "/")
			suffix := strings.TrimPrefix(parts[1], "/")

			hasPrefix := false
			if prefix == "" {
				hasPrefix = true
			} else {
				normPrefix := strings.Trim(prefix, "/")
				normPath := strings.Trim(lowerPath, "/")
				if normPath == normPrefix ||
					strings.HasPrefix(normPath, normPrefix+"/") ||
					strings.Contains("/"+normPath+"/", "/"+normPrefix+"/") {
					hasPrefix = true
				}
			}
			hasSuffix := false
			if suffix == "" {
				hasSuffix = true
			} else if strings.Contains(suffix, "*") {
				m, _ := filepath.Match(suffix, base)
				hasSuffix = m
			} else {
				hasSuffix = strings.HasSuffix(lowerPath, suffix)
			}
			if hasPrefix && hasSuffix {
				return true
			}
		}
	}

	return false
}

// IsSensitive checks if a file path is considered sensitive.
func IsSensitive(path string, userPatterns []string, manualOverride *bool) bool {
	if manualOverride != nil {
		return *manualOverride
	}

	for _, p := range userPatterns {
		if MatchPattern(p, path) {
			return true
		}
	}

	for _, p := range DefaultSensitivePatterns {
		if MatchPattern(p, path) {
			return true
		}
	}

	return false
}
