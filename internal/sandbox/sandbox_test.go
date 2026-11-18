package sandbox

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"config-studio/internal/fleet"
	"config-studio/internal/hosts"
	"config-studio/internal/secrets"
	"config-studio/internal/ssh"
)

// Mock implementations for testing:
type mockFleet struct {
	servers []fleet.ServerNode
}

func (m *mockFleet) ListServers() []fleet.ServerNode {
	return m.servers
}

func (m *mockFleet) GetServer(id string) (*fleet.ServerNode, error) {
	for _, s := range m.servers {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, errors.New("not found")
}

type mockHosts struct {
	hosts []*hosts.Host
}

func (m *mockHosts) List() []*hosts.Host {
	return m.hosts
}

func (m *mockHosts) Get(id string) (*hosts.Host, error) {
	for _, h := range m.hosts {
		if h.ID == id {
			return h, nil
		}
	}
	return nil, errors.New("not found")
}

type mockSSH struct{}

func (m *mockSSH) ExecuteCommand(ctx context.Context, cfg *ssh.Config, req *ssh.ExecRequest) (*ssh.ExecResult, error) {
	if strings.Contains(req.Cmd, "fail") {
		return &ssh.ExecResult{
			ExitCode: 1,
			Stderr:   "command failed",
		}, nil
	}
	return &ssh.ExecResult{
		ExitCode: 0,
		Stdout:   "output of: " + req.Cmd,
	}, nil
}

type mockFS struct {
	files map[string][]byte
}

func (m *mockFS) ReadFile(path string) ([]byte, error) {
	if data, ok := m.files[path]; ok {
		return data, nil
	}
	return nil, errors.New("file not found")
}

func (m *mockFS) WriteFile(path string, data []byte) error {
	m.files[path] = data
	return nil
}

func (m *mockFS) ListFiles(dir string) ([]string, error) {
	keys := make([]string, 0, len(m.files))
	for k := range m.files {
		keys = append(keys, k)
	}
	return keys, nil
}

type mockVault struct {
	secrets map[string]string
}

func (m *mockVault) Get(id string) (string, error) {
	if val, ok := m.secrets[id]; ok {
		return val, nil
	}
	return "", errors.New("secret not found")
}

func (m *mockVault) GetMeta(id string) (secrets.SecretMeta, bool) {
	if _, ok := m.secrets[id]; ok {
		scope := "user"
		if id == "system-key" {
			scope = "system"
		}
		return secrets.SecretMeta{
			ID:    id,
			Title: "Secret " + id,
			Type:  secrets.TypeToken,
			Scope: secrets.SecretScope(scope),
		}, true
	}
	return secrets.SecretMeta{}, false
}

func (m *mockVault) List() []secrets.SecretMeta {
	list := make([]secrets.SecretMeta, 0, len(m.secrets))
	for id := range m.secrets {
		list = append(list, secrets.SecretMeta{
			ID:    id,
			Title: "Secret " + id,
			Type:  secrets.TypeToken,
		})
	}
	return list
}

func setupTestService() *Service {
	fl := &mockFleet{
		servers: []fleet.ServerNode{
			{ID: "localhost", Name: "Localhost (Этот ПК)"},
			{
				ID:       "node-1",
				Name:     "Production Node 1",
				Identity: "super-secret-vault-ref",
				Connection: fleet.ConnectionConfig{
					SSH: &fleet.SSHConnectionConfig{
						Host:     "10.0.0.1",
						Identity: "vault:ssh-key",
					},
					Agent: &fleet.AgentConnectionConfig{
						VaultSecret: "vault:agent-secret",
						SecretRef:   "vault://agent:node-1",
					},
				},
			},
		},
	}
	h := &mockHosts{
		hosts: []*hosts.Host{
			{
				ID:         "node-1",
				Name:       "Host 1",
				Host:       "10.0.0.1",
				Password:   "plaintext-password",
				PrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----...",
				Passphrase: "secret-passphrase",
				IdentityID: "vault-identity-123",
				SecretID:   "vault-secret-123",
			},
			{
				ID:   "local-bypass",
				Name: "Bypass Attempt",
				Host: "127.0.0.1",
			},
		},
	}
	f := &mockFS{
		files: map[string][]byte{
			"traefik.yml": []byte("entryPoints:\n  web:\n    address: ':80'"),
		},
	}
	v := &mockVault{
		secrets: map[string]string{
			"agent:node-1": "secret-token-12345",
			"system-key":   "master-root-password",
		},
	}
	opts := Options{
		DefaultTimeout: 1 * time.Second,
		MaxTimeout:     5 * time.Second,
		MaxStackDepth:  64,
	}
	return NewService(opts, fl, h, &mockSSH{}, f, v)
}

func TestSandbox_BasicEval(t *testing.T) {
	svc := setupTestService()
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: "const a = 10; const b = 25; a + b;",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Success {
		t.Fatalf("eval failed: %s", res.Error)
	}
	if res.Value != int64(35) {
		t.Errorf("expected 35, got %v (%T)", res.Value, res.Value)
	}
}

func TestSandbox_ContextAndConsole(t *testing.T) {
	svc := setupTestService()
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: `
			console.log("Starting calculation for:", context.target);
			console.warn("Notice: scaling up");
			console.error("Critical alert simulation");
			({ result: context.multiplier * 42, target: context.target });
		`,
		Context: map[string]any{
			"target":     "production",
			"multiplier": 2,
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Success {
		t.Fatalf("eval failed: %s", res.Error)
	}
	if len(res.Logs) != 3 {
		t.Fatalf("expected 3 logs, got %d: %+v", len(res.Logs), res.Logs)
	}
	if !strings.Contains(res.Logs[0], "Starting calculation for: production") {
		t.Errorf("unexpected log 0: %s", res.Logs[0])
	}
	if !strings.Contains(res.Logs[1], "[WARN] Notice: scaling up") {
		t.Errorf("unexpected log 1: %s", res.Logs[1])
	}
	if !strings.Contains(res.Logs[2], "[ERROR] Critical alert simulation") {
		t.Errorf("unexpected log 2: %s", res.Logs[2])
	}

	valMap, ok := res.Value.(map[string]any)
	if !ok {
		t.Fatalf("expected map result, got %T: %v", res.Value, res.Value)
	}
	if valMap["result"] != int64(84) {
		t.Errorf("expected result 84, got %v", valMap["result"])
	}
}

func TestSandbox_TimeoutProtection(t *testing.T) {
	svc := setupTestService()
	// Script with infinite loop, timeout 50ms
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code:      "while(true) {}",
		TimeoutMs: 50,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Success {
		t.Fatalf("expected infinite loop to fail, but succeeded with: %v", res.Value)
	}
	if !strings.Contains(res.Error, "timeout") {
		t.Errorf("expected error to mention timeout, got: %s", res.Error)
	}
}

func TestSandbox_RecursionStackLimit(t *testing.T) {
	svc := setupTestService()
	// Script with infinite recursion
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: "function recurse() { recurse(); } recurse();",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Success {
		t.Fatalf("expected stack overflow to fail")
	}
	if !strings.Contains(res.Error, "stack") && !strings.Contains(res.Error, "RangeError") {
		t.Errorf("expected stack depth error, got: %s", res.Error)
	}
}

func TestSandbox_FacadeServers(t *testing.T) {
	svc := setupTestService()
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: `
			const list = cs.servers.list();
			const node = cs.servers.get("node-1");
			const missing = cs.servers.get("non-existent");
			({ count: list.length, nodeName: node.name, isMissingNull: missing === null });
		`,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Success {
		t.Fatalf("eval failed: %s", res.Error)
	}
	valMap := res.Value.(map[string]any)
	if valMap["count"] != int64(2) {
		t.Errorf("expected 2 servers, got %v", valMap["count"])
	}
	if valMap["nodeName"] != "Production Node 1" {
		t.Errorf("expected Production Node 1, got %v", valMap["nodeName"])
	}
	if valMap["isMissingNull"] != true {
		t.Errorf("expected isMissingNull to be true, got %v", valMap["isMissingNull"])
	}
}

func TestSandbox_FacadeFS_Safety(t *testing.T) {
	svc := setupTestService()

	// 1. Read file succeeds
	resRead, err := svc.Eval(context.Background(), EvalRequest{
		Code: `cs.fs.readFile("traefik.yml");`,
	})
	if err != nil || !resRead.Success {
		t.Fatalf("read failed: %v, err=%s", err, resRead.Error)
	}
	if !strings.Contains(resRead.Value.(string), "entryPoints") {
		t.Errorf("expected content to have entryPoints, got: %v", resRead.Value)
	}

	// 2. Write file fails when allowWrite is false
	resWriteFail, err := svc.Eval(context.Background(), EvalRequest{
		Code:       `cs.fs.writeFile("new.txt", "hello");`,
		AllowWrite: false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resWriteFail.Success {
		t.Fatalf("expected write to fail when allowWrite=false")
	}
	if !strings.Contains(resWriteFail.Error, "disabled by sandbox security policy") {
		t.Errorf("unexpected error: %s", resWriteFail.Error)
	}

	// 3. Write file succeeds when allowWrite is true
	resWriteOk, err := svc.Eval(context.Background(), EvalRequest{
		Code:       `cs.fs.writeFile("new.txt", "hello"); cs.fs.readFile("new.txt");`,
		AllowWrite: true,
	})
	if err != nil || !resWriteOk.Success {
		t.Fatalf("write failed when allowWrite=true: %s", resWriteOk.Error)
	}
	if resWriteOk.Value != "hello" {
		t.Errorf("expected hello, got %v", resWriteOk.Value)
	}
}

func TestSandbox_FacadeVault(t *testing.T) {
	svc := setupTestService()
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: `
			const list = cs.vault.list();
			const secret = cs.vault.getSecret("agent:node-1");
			const systemSecret = cs.vault.getSecret("system-key");
			({ listLen: list.length, secret: secret, systemSecret: systemSecret });
		`,
	})
	if err != nil || !res.Success {
		t.Fatalf("eval failed: %v, err=%s", err, res.Error)
	}
	valMap := res.Value.(map[string]any)
	if valMap["listLen"] != int64(2) {
		t.Errorf("expected 2 secrets, got %v", valMap["listLen"])
	}
	if valMap["secret"] != "secret-token-12345" {
		t.Errorf("expected secret-token-12345, got %v", valMap["secret"])
	}
	if valMap["systemSecret"] != nil {
		t.Errorf("expected system secret to be null, got %v", valMap["systemSecret"])
	}
}

func TestSandbox_FacadeSSH(t *testing.T) {
	svc := setupTestService()
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: `
			const res = cs.ssh.exec("node-1", "uname -a", 5);
			res;
		`,
	})
	if err != nil || !res.Success {
		t.Fatalf("eval failed: %v, err=%s", err, res.Error)
	}
	valMap := res.Value.(map[string]any)
	if valMap["exitCode"] != 0 && valMap["exitCode"] != int64(0) {
		t.Errorf("expected exitCode 0, got %v (%T)", valMap["exitCode"], valMap["exitCode"])
	}
	if !strings.Contains(valMap["stdout"].(string), "output of: uname -a") {
		t.Errorf("unexpected stdout: %v", valMap["stdout"])
	}
}

func TestSandbox_Security_ForbidLocalhostExec(t *testing.T) {
	svc := setupTestService()

	targets := []string{"localhost", "local", "", "local-bypass"}
	for _, target := range targets {
		res, err := svc.Eval(context.Background(), EvalRequest{
			Code: `cs.ssh.exec("` + target + `", "whoami");`,
		})
		if err != nil {
			t.Fatalf("unexpected go error: %v", err)
		}
		if res.Success {
			t.Fatalf("expected exec on target %q to fail, but succeeded with: %v", target, res.Value)
		}
		if !strings.Contains(res.Error, "forbidden in sandbox") && !strings.Contains(res.Error, "requires at least 2 arguments") {
			t.Errorf("expected error to mention forbidden in sandbox for target %q, got: %s", target, res.Error)
		}
	}
}

func TestSandbox_Security_CredentialsNotLeaked(t *testing.T) {
	svc := setupTestService()

	// 1. Check host sanitization
	resHost, err := svc.Eval(context.Background(), EvalRequest{
		Code: `
			const h = cs.hosts.get("node-1");
			({
				password: h.password,
				privateKey: h.privateKey,
				passphrase: h.passphrase,
				identityId: h.identityId,
				secretId: h.secretId,
				name: h.name,
				host: h.host,
			});
		`,
	})
	if err != nil || !resHost.Success {
		t.Fatalf("hosts.get failed: %v, err=%s", err, resHost.Error)
	}
	hMap, ok := resHost.Value.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T: %v", resHost.Value, resHost.Value)
	}
	for _, forbiddenKey := range []string{"password", "privateKey", "passphrase", "identityId", "secretId"} {
		if val, exists := hMap[forbiddenKey]; exists && val != nil && val != "" {
			t.Errorf("sensitive key %q leaked in host: %v", forbiddenKey, val)
		}
	}
	if hMap["name"] != "Host 1" || hMap["host"] != "10.0.0.1" {
		t.Errorf("expected public host fields preserved, got: %v", hMap)
	}

	// 2. Check server node sanitization
	resSrv, err := svc.Eval(context.Background(), EvalRequest{
		Code: `
			const s = cs.servers.get("node-1");
			({
				identity: s.identity,
				sshIdentity: s.connection && s.connection.ssh ? s.connection.ssh.identity : null,
				vaultSecret: s.connection && s.connection.agent ? s.connection.agent.vaultSecret : null,
				secretRef: s.connection && s.connection.agent ? s.connection.agent.secretRef : null,
				name: s.name,
			});
		`,
	})
	if err != nil || !resSrv.Success {
		t.Fatalf("servers.get failed: %v, err=%s", err, resSrv.Error)
	}
	sMap, ok := resSrv.Value.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T: %v", resSrv.Value, resSrv.Value)
	}
	for _, forbiddenKey := range []string{"identity", "sshIdentity", "vaultSecret", "secretRef"} {
		if val, exists := sMap[forbiddenKey]; exists && val != nil && val != "" {
			t.Errorf("sensitive key %q leaked in server: %v", forbiddenKey, val)
		}
	}
	if sMap["name"] != "Production Node 1" {
		t.Errorf("expected server name preserved, got: %v", sMap["name"])
	}
}

func TestSandbox_ContextCancellation_ReportsCorrectError(t *testing.T) {
	svc := setupTestService()
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel after 20ms while script is looping
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()

	res, err := svc.Eval(ctx, EvalRequest{
		Code:      "while(true) {}",
		TimeoutMs: 2000,
	})
	if err != nil {
		t.Fatalf("unexpected go error: %v", err)
	}
	if res.Success {
		t.Fatalf("expected canceled execution to fail")
	}
	if !strings.Contains(res.Error, "canceled by client") {
		t.Errorf("expected error to mention 'canceled by client', got: %s", res.Error)
	}
}

func TestSandbox_Logs_CappedAtLimit(t *testing.T) {
	svc := setupTestService()
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: `
			for (let i = 0; i < 1200; i++) {
				console.log("iteration", i);
			}
			console.log("A".repeat(5000));
		`,
	})
	if err != nil || !res.Success {
		t.Fatalf("eval failed: %v, err=%s", err, res.Error)
	}
	// Max log lines is 1000 + 1 warning message
	if len(res.Logs) > 1001 {
		t.Errorf("expected at most 1001 log lines, got: %d", len(res.Logs))
	}
	// Last log should be warning about log limit
	warningFound := false
	for _, l := range res.Logs {
		if strings.Contains(l, "log limit reached") {
			warningFound = true
			break
		}
	}
	if !warningFound {
		t.Errorf("expected log limit warning message in logs")
	}
}

type panicFS struct {
	mockFS
}

func (p *panicFS) ReadFile(path string) ([]byte, error) {
	panic("hardware disk explosion")
}

func TestSandbox_PanicRecovery(t *testing.T) {
	fl := &mockFleet{}
	h := &mockHosts{}
	v := &mockVault{}
	opts := Options{
		DefaultTimeout: 1 * time.Second,
		MaxTimeout:     5 * time.Second,
		MaxStackDepth:  64,
	}
	svc := NewService(opts, fl, h, &mockSSH{}, &panicFS{}, v)
	res, err := svc.Eval(context.Background(), EvalRequest{
		Code: `cs.fs.readFile("boom.txt");`,
	})
	if err != nil {
		t.Fatalf("unexpected go error: %v", err)
	}
	if res.Success {
		t.Fatalf("expected panic to fail eval")
	}
	if !strings.Contains(res.Error, "panic") && !strings.Contains(res.Error, "hardware disk explosion") {
		t.Errorf("expected error to mention panic or exception, got: %s", res.Error)
	}
}
