package hosts

import (
	"bufio"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ExportOpenSSH converts a list of hosts into OpenSSH config format.
func ExportOpenSSH(hosts []*Host) string {
	var sb strings.Builder
	sb.WriteString("# ==============================================================================\n")
	sb.WriteString(fmt.Sprintf("# Config Studio Fleet Inventory — Exported at %s\n", time.Now().UTC().Format(time.RFC3339)))
	sb.WriteString("# Standard OpenSSH Client Configuration (~/.ssh/config)\n")
	sb.WriteString("# ==============================================================================\n\n")

	for _, h := range hosts {
		if h == nil || h.Host == "" {
			continue
		}

		alias := sanitizeHostAlias(h.ID)
		if alias == "" {
			alias = sanitizeHostAlias(h.Name)
		}
		if alias == "" {
			alias = h.Host
		}

		sb.WriteString(fmt.Sprintf("Host %s\n", alias))
		sb.WriteString(fmt.Sprintf("    HostName %s\n", h.Host))
		if h.Port > 0 && h.Port != 22 {
			sb.WriteString(fmt.Sprintf("    Port %d\n", h.Port))
		}
		if h.User != "" {
			sb.WriteString(fmt.Sprintf("    User %s\n", h.User))
		}
		if h.ProxyJump != "" {
			sb.WriteString(fmt.Sprintf("    ProxyJump %s\n", h.ProxyJump))
		}
		if h.Description != "" {
			sb.WriteString(fmt.Sprintf("    # Description: %s\n", strings.ReplaceAll(h.Description, "\n", " ")))
		}
		if len(h.Tags) > 0 {
			sb.WriteString(fmt.Sprintf("    # Tags: %s\n", strings.Join(h.Tags, ", ")))
		}
		sb.WriteString("    ServerAliveInterval 30\n")
		sb.WriteString("    ServerAliveCountMax 3\n\n")
	}

	return sb.String()
}

// ParseOpenSSH parses OpenSSH config content into Host entities.
func ParseOpenSSH(content string) ([]*Host, error) {
	scanner := bufio.NewScanner(strings.NewReader(content))
	var result []*Host
	var current *Host

	defaultUser := ""
	defaultPort := 22

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		key := strings.ToLower(parts[0])
		val := strings.Join(parts[1:], " ")

		if key == "host" {
			// If wildcard host, use for defaults
			if val == "*" {
				current = nil
				continue
			}

			if current != nil && current.Host != "" {
				current.Normalize()
				result = append(result, current)
			}

			// First token as alias
			alias := parts[1]
			current = &Host{
				ID:       alias,
				Name:     alias,
				Port:     defaultPort,
				User:     defaultUser,
				AuthType: AuthTypeNone,
			}
			continue
		}

		if current == nil {
			if key == "user" {
				defaultUser = val
			} else if key == "port" {
				if p, err := strconv.Atoi(val); err == nil && p > 0 {
					defaultPort = p
				}
			}
			continue
		}

		switch key {
		case "hostname":
			current.Host = val
		case "port":
			if p, err := strconv.Atoi(val); err == nil && p > 0 {
				current.Port = p
			}
		case "user":
			current.User = val
		case "proxyjump":
			current.ProxyJump = val
		case "identityfile":
			current.IdentityID = val
			current.AuthType = AuthTypeVault
		}
	}

	if current != nil && current.Host != "" {
		current.Normalize()
		result = append(result, current)
	}

	return result, scanner.Err()
}

func sanitizeHostAlias(s string) string {
	var sb strings.Builder
	for _, r := range strings.TrimSpace(s) {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			sb.WriteRune(r)
		} else if r == ' ' {
			sb.WriteRune('-')
		}
	}
	return sb.String()
}
