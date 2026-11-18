package server

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"config-studio/internal/agent"
)

// handleRemoteProxy forwards requests from the browser to remote agents.
// This completely avoids Mixed Content errors (HTTPS -> HTTP) and CORS restrictions.
func (s *Server) handleRemoteProxy(w http.ResponseWriter, r *http.Request) {
	targetBase := r.Header.Get("X-Remote-Target")
	if targetBase == "" {
		targetBase = r.URL.Query().Get("target")
	}
	if targetBase == "" {
		jsonError(w, http.StatusBadRequest, "X-Remote-Target header is required")
		return
	}

	targetBase = strings.TrimSpace(targetBase)
	if !strings.HasPrefix(targetBase, "http://") && !strings.HasPrefix(targetBase, "https://") {
		targetBase = "http://" + targetBase
	}
	targetBase = strings.TrimRight(targetBase, "/")

	// Whitelist validation to prevent SSRF: targetBase must be localhost/loopback or an enrolled fleet agent
	targetClean := strings.TrimRight(targetBase, "/")
	targetAllowed := false
	if strings.HasPrefix(targetClean, "http://localhost:") || strings.HasPrefix(targetClean, "http://127.0.0.1:") ||
		strings.HasPrefix(targetClean, "https://localhost:") || strings.HasPrefix(targetClean, "https://127.0.0.1:") ||
		targetClean == "http://localhost" || targetClean == "http://127.0.0.1" {
		targetAllowed = true
	} else if s.fleet != nil {
		for _, srv := range s.fleet.ListServers() {
			if srv.Connection.Agent != nil && srv.Connection.Agent.Enabled && srv.Connection.Agent.URL != "" {
				agentURL := strings.TrimRight(srv.Connection.Agent.URL, "/")
				if strings.EqualFold(targetClean, agentURL) {
					targetAllowed = true
					break
				}
			}
			if srv.Connection.SSH != nil && srv.Connection.SSH.Host != "" {
				if strings.Contains(targetClean, srv.Connection.SSH.Host) {
					targetAllowed = true
					break
				}
			}
		}
	}

	if !targetAllowed {
		jsonError(w, http.StatusForbidden, "target URL is not in fleet inventory and not a local agent")
		return
	}

	path := r.PathValue("path")
	cleanPath := strings.TrimLeft(path, "/")

	// If this is an /api/fs/ request with a root parameter, resolve root path from workspaces.yaml
	q := r.URL.Query()
	q.Del("target")

	var wsPath string
	var rootID string
	if strings.HasPrefix(cleanPath, "api/fs/") {
		rootID = q.Get("root")
		if rootID == "root" {
			wsPath = "/"
		} else if s.fs != nil && s.fs.Workspaces != nil && rootID != "" {
			if ws, ok := s.fs.Workspaces.Get(rootID); ok && ws.Path != "" {
				wsPath = filepath.ToSlash(strings.TrimRight(ws.Path, "/"))
			}
		}
		if wsPath != "" {
			reqPath := strings.TrimSpace(q.Get("path"))
			if reqPath == "" || reqPath == "." {
				q.Set("path", wsPath)
			} else if strings.HasPrefix(reqPath, "/") {
				q.Set("path", reqPath)
			} else {
				if wsPath == "/" {
					q.Set("path", "/"+strings.TrimLeft(reqPath, "/"))
				} else {
					q.Set("path", wsPath+"/"+strings.TrimLeft(reqPath, "/"))
				}
			}
		}
	}

	targetURL := fmt.Sprintf("%s/%s", targetBase, cleanPath)
	if len(q) > 0 {
		targetURL += "?" + q.Encode()
	}

	var reqBody io.Reader = r.Body
	if strings.HasPrefix(cleanPath, "api/fs/") && r.Body != nil && (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete) {
		bodyBytes, err := io.ReadAll(r.Body)
		if err == nil && len(bodyBytes) > 0 {
			var bodyMap map[string]any
			if err := json.Unmarshal(bodyBytes, &bodyMap); err == nil {
				rID, _ := bodyMap["root"].(string)
				if rID == "" {
					rID = rootID
				}
				if rID != "" {
					var wPath string
					if rID == "root" {
						wPath = "/"
					} else if s.fs != nil && s.fs.Workspaces != nil {
						if ws, ok := s.fs.Workspaces.Get(rID); ok && ws.Path != "" {
							wPath = filepath.ToSlash(strings.TrimRight(ws.Path, "/"))
						}
					}
					if wPath != "" {
						resolvePath := func(p string) string {
							p = strings.TrimSpace(p)
							if p == "" || p == "." {
								return wPath
							}
							if strings.HasPrefix(p, "/") {
								return p
							}
							if wPath == "/" {
								return "/" + strings.TrimLeft(p, "/")
							}
							return wPath + "/" + strings.TrimLeft(p, "/")
						}
						if p, ok := bodyMap["path"].(string); ok {
							bodyMap["path"] = resolvePath(p)
						}
						if op, ok := bodyMap["oldPath"].(string); ok {
							bodyMap["oldPath"] = resolvePath(op)
						}
						if np, ok := bodyMap["newPath"].(string); ok {
							bodyMap["newPath"] = resolvePath(np)
						}
						if newJSON, err := json.Marshal(bodyMap); err == nil {
							bodyBytes = newJSON
						}
					}
				}
			}
			reqBody = bytes.NewReader(bodyBytes)
		}
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, reqBody)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to create proxy request: "+err.Error())
		return
	}

	// Forward headers (except Host and X-Remote-Target)
	for k, vv := range r.Header {
		if strings.EqualFold(k, "X-Remote-Target") || strings.EqualFold(k, "Host") {
			continue
		}
		for _, v := range vv {
			proxyReq.Header.Add(k, v)
		}
	}

	// Auto-inject or refresh credentials from Core Vault if target matches a fleet server
	if s.fleet != nil && s.secrets != nil {
		targetClean := strings.TrimRight(targetBase, "/")
		for _, srv := range s.fleet.ListServers() {
			if srv.Connection.Agent != nil && srv.Connection.Agent.Enabled {
				srvURLClean := strings.TrimRight(srv.Connection.Agent.URL, "/")
				if strings.EqualFold(targetClean, srvURLClean) {
					vKey := srv.Connection.Agent.VaultSecret
					if vKey != "" {
						secVal, err := s.secrets.Get(vKey)
						if err == nil && secVal != "" {
							var creds struct {
								KeyID  string `json:"keyId"`
								Secret string `json:"secret"`
							}
							keyID := "cs_key"
							totpSecret := secVal
							if json.Unmarshal([]byte(secVal), &creds) == nil && creds.KeyID != "" {
								keyID = creds.KeyID
								totpSecret = creds.Secret
							}
							otp, _ := agent.GenerateTOTP(totpSecret, time.Now(), 6)
							nonceBytes := make([]byte, 8)
							_, _ = rand.Read(nonceBytes)
							nonce := fmt.Sprintf("%d-%s", time.Now().UnixNano(), hex.EncodeToString(nonceBytes))
							proxyReq.Header.Set("X-Nonce", nonce)
							if otp != "" {
								proxyReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s:%s", keyID, otp))
								proxyReq.Header.Set("X-CS-Agent-Key", keyID)
								proxyReq.Header.Set("X-CS-Agent-OTP", otp)
							} else {
								proxyReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", keyID))
								proxyReq.Header.Set("X-CS-Agent-Key", keyID)
							}
						}
					}
					break
				}
			}
		}
	}

	client := s.getProxyClient()

	resp, err := client.Do(proxyReq)
	if err != nil {
		jsonError(w, http.StatusBadGateway, "failed to reach remote agent: "+err.Error())
		return
	}
	defer resp.Body.Close()

	// For filesystem tree listings scoped to a workspace, relativize paths so client sees "" at root
	if cleanPath == "api/fs/tree" && resp.StatusCode == http.StatusOK && wsPath != "" {
		respBytes, err := io.ReadAll(resp.Body)
		if err == nil {
			var data map[string]any
			if err := json.Unmarshal(respBytes, &data); err == nil {
				absDirPath, _ := data["path"].(string)
				absDirPath = filepath.ToSlash(strings.TrimRight(strings.TrimSpace(absDirPath), "/"))
				relDirPath := ""
				if absDirPath != wsPath && strings.HasPrefix(absDirPath, wsPath+"/") {
					relDirPath = strings.TrimPrefix(absDirPath, wsPath+"/")
				}
				data["path"] = relDirPath
				data["root"] = rootID

				relativizeItems := func(key string) {
					if rawList, ok := data[key].([]any); ok {
						for _, itemRaw := range rawList {
							if itemMap, ok := itemRaw.(map[string]any); ok {
								itemAbs, _ := itemMap["path"].(string)
								itemAbs = filepath.ToSlash(itemAbs)
								itemRel := itemAbs
								if itemAbs == wsPath {
									itemRel = ""
								} else if strings.HasPrefix(itemAbs, wsPath+"/") {
									itemRel = strings.TrimPrefix(itemAbs, wsPath+"/")
								}
								itemMap["path"] = itemRel
								itemMap["root"] = rootID
								itemMap["fullRelPath"] = rootID + ":" + itemRel
								if _, ok := itemMap["extension"]; !ok {
									name, _ := itemMap["name"].(string)
									isDir, _ := itemMap["isDir"].(bool)
									if !isDir && name != "" {
										itemMap["extension"] = filepath.Ext(name)
									} else {
										itemMap["extension"] = ""
									}
								}
							}
						}
					}
				}
				relativizeItems("items")
				relativizeItems("nodes")

				newRespBytes, err := json.Marshal(data)
				if err == nil {
					for k, vv := range resp.Header {
						if strings.EqualFold(k, "Content-Length") {
							continue
						}
						for _, v := range vv {
							w.Header().Add(k, v)
						}
					}
					w.Header().Set("Content-Length", strconv.Itoa(len(newRespBytes)))
					w.WriteHeader(resp.StatusCode)
					_, _ = w.Write(newRespBytes)
					return
				}
			}
		}
	}

	// For file read responses, ensure path is relative to workspace root
	if cleanPath == "api/fs/file" && r.Method == http.MethodGet && resp.StatusCode == http.StatusOK && wsPath != "" {
		respBytes, err := io.ReadAll(resp.Body)
		if err == nil {
			var data map[string]any
			if err := json.Unmarshal(respBytes, &data); err == nil {
				filePath, _ := data["path"].(string)
				filePath = filepath.ToSlash(filePath)
				relFilePath := filePath
				if strings.HasPrefix(filePath, wsPath+"/") {
					relFilePath = strings.TrimPrefix(filePath, wsPath+"/")
				}
				data["path"] = relFilePath
				data["root"] = rootID
				data["fullRelPath"] = rootID + ":" + relFilePath
				if _, ok := data["name"]; !ok {
					data["name"] = filepath.Base(filePath)
				}
				newRespBytes, err := json.Marshal(data)
				if err == nil {
					for k, vv := range resp.Header {
						if strings.EqualFold(k, "Content-Length") {
							continue
						}
						for _, v := range vv {
							w.Header().Add(k, v)
						}
					}
					w.Header().Set("Content-Length", strconv.Itoa(len(newRespBytes)))
					w.WriteHeader(resp.StatusCode)
					_, _ = w.Write(newRespBytes)
					return
				}
			}
		}
	}

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
