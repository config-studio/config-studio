package agent

import (
	"fmt"
	"net"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// ConnectionLinkInfo represents parsed parameters from a cs-agent:// connection URL.
type ConnectionLinkInfo struct {
	KeyID    string   `json:"keyId"`
	Secret   string   `json:"secret"`
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	TLS      bool     `json:"tls"`
	Roots    []string `json:"roots"`
	NodeName string   `json:"nodeName"`
	NodeID   string   `json:"nodeId"`
}

// DetectOutboundIP determines the primary outbound IPv4 of the machine.
func DetectOutboundIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		localAddr, ok := conn.LocalAddr().(*net.UDPAddr)
		if ok && localAddr.IP != nil {
			ipStr := localAddr.IP.String()
			if ipStr != "" && ipStr != "0.0.0.0" {
				return ipStr
			}
		}
	}

	hostname, err := os.Hostname()
	if err == nil && hostname != "" {
		addrs, err := net.LookupHost(hostname)
		if err == nil {
			for _, addr := range addrs {
				ip := net.ParseIP(addr)
				if ip != nil && ip.To4() != nil && !ip.IsLoopback() {
					return ip.String()
				}
			}
		}
		return hostname
	}

	return "127.0.0.1"
}

// GenerateConnectionLink creates a 1-click import URI conforming to cs-agent:// specification.
// Format: cs-agent://<keyId>:<totpSecret>@<host>:<port>/?roots=<path1>,<path2>&tls=<0|1>#<nodeName>
func (c *Config) GenerateConnectionLink(overrideHost string, nodeName string, customRoots []string) string {
	host := strings.TrimSpace(overrideHost)
	if host == "" {
		if c.Host != "" && c.Host != "0.0.0.0" && c.Host != "::" {
			host = c.Host
		} else {
			host = DetectOutboundIP()
		}
	}

	roots := customRoots
	if len(roots) == 0 {
		roots = c.Sandbox.AllowedRoots
	}

	// Clean root paths
	cleanRoots := make([]string, 0, len(roots))
	for _, r := range roots {
		r = strings.TrimSpace(r)
		if r != "" {
			cleanRoots = append(cleanRoots, r)
		}
	}

	port := c.Port
	if port <= 0 {
		port = 8085
	}

	u := &url.URL{
		Scheme: "cs-agent",
		User:   url.UserPassword(c.Master.KeyID, c.Master.Secret),
		Host:   net.JoinHostPort(host, strconv.Itoa(port)),
		Path:   "/",
	}

	q := url.Values{}
	if len(cleanRoots) > 0 {
		q.Set("roots", strings.Join(cleanRoots, ","))
	}
	if c.TLS.Enabled {
		q.Set("tls", "1")
	}

	name := strings.TrimSpace(nodeName)
	if name == "" {
		h, err := os.Hostname()
		if err == nil && h != "" {
			name = h
		} else {
			name = "agent-node"
		}
	}
	u.RawQuery = q.Encode()
	u.Fragment = name

	return u.String()
}

var idSlugRegex = regexp.MustCompile(`[^a-z0-9_-]+`)

// ParseConnectionLink parses a cs-agent:// (or csagent://) URL and extracts connection credentials.
func ParseConnectionLink(raw string) (*ConnectionLinkInfo, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty connection link")
	}

	// Normalise scheme prefix
	if strings.HasPrefix(raw, "csagent://") {
		raw = "cs-agent://" + strings.TrimPrefix(raw, "csagent://")
	} else if strings.HasPrefix(raw, "cs://agent/") {
		raw = "cs-agent://" + strings.TrimPrefix(raw, "cs://agent/")
	} else if !strings.HasPrefix(raw, "cs-agent://") {
		return nil, fmt.Errorf("invalid scheme: must start with cs-agent://")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to parse URL: %w", err)
	}

	if u.User == nil {
		return nil, fmt.Errorf("missing credentials in URL: expected <keyId>:<secret>@host")
	}

	keyID := u.User.Username()
	secret, hasSecret := u.User.Password()
	if !hasSecret || secret == "" {
		return nil, fmt.Errorf("missing secret in credentials: expected <keyId>:<secret>@host")
	}

	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("missing host in URL")
	}

	port := 8085
	portStr := u.Port()
	if portStr != "" {
		p, err := strconv.Atoi(portStr)
		if err == nil && p > 0 && p <= 65535 {
			port = p
		}
	}

	q := u.Query()
	isTLS := q.Get("tls") == "1" || strings.ToLower(q.Get("tls")) == "true"

	var roots []string
	if rootsRaw := q.Get("roots"); rootsRaw != "" {
		for _, r := range strings.Split(rootsRaw, ",") {
			r = strings.TrimSpace(r)
			if r != "" {
				if strings.HasPrefix(r, "/") {
					roots = append(roots, pathpkg.Clean(r))
				} else {
					roots = append(roots, filepath.Clean(r))
				}
			}
		}
	}

	nodeName := strings.TrimSpace(u.Fragment)
	if nodeName == "" {
		nodeName = q.Get("name")
	}
	if nodeName == "" {
		nodeName = host
	}

	nodeID := q.Get("id")
	if nodeID == "" {
		nodeID = strings.ToLower(nodeName)
		nodeID = idSlugRegex.ReplaceAllString(nodeID, "-")
		nodeID = strings.Trim(nodeID, "-")
	}

	return &ConnectionLinkInfo{
		KeyID:    keyID,
		Secret:   strings.ToUpper(strings.TrimSpace(secret)),
		Host:     host,
		Port:     port,
		TLS:      isTLS,
		Roots:    roots,
		NodeName: nodeName,
		NodeID:   nodeID,
	}, nil
}
