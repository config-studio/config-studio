package ssh

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"config-studio/internal/secrets"

	gossh "golang.org/x/crypto/ssh"
)

func TestGenerateEd25519KeyPair(t *testing.T) {
	kp, err := GenerateEd25519KeyPair("test-comment")
	if err != nil {
		t.Fatalf("GenerateEd25519KeyPair failed: %v", err)
	}

	if !strings.Contains(kp.PrivateKeyPEM, "BEGIN OPENSSH PRIVATE KEY") {
		t.Errorf("Expected OpenSSH private key PEM, got: %s", kp.PrivateKeyPEM)
	}

	if !strings.HasPrefix(kp.PublicKeyAuth, "ssh-ed25519 ") {
		t.Errorf("Expected ssh-ed25519 prefix, got: %s", kp.PublicKeyAuth)
	}

	if !strings.HasSuffix(kp.PublicKeyAuth, "test-comment") {
		t.Errorf("Expected test-comment suffix, got: %s", kp.PublicKeyAuth)
	}

	// Verify the private key can be parsed by crypto/ssh
	signer, err := gossh.ParsePrivateKey([]byte(kp.PrivateKeyPEM))
	if err != nil {
		t.Fatalf("Failed to parse generated private key: %v", err)
	}

	// Verify the public key matches
	expectedPub := strings.TrimSpace(string(gossh.MarshalAuthorizedKey(signer.PublicKey()))) + " test-comment"
	if kp.PublicKeyAuth != expectedPub {
		t.Errorf("Public key mismatch:\nExpected: %s\nGot:      %s", expectedPub, kp.PublicKeyAuth)
	}
}

func TestConfigNormalization(t *testing.T) {
	cfg := &Config{}
	if cfg.NormalizedPort() != 22 {
		t.Errorf("Expected default port 22, got %d", cfg.NormalizedPort())
	}
	if cfg.NormalizedTimeout() != 10*time.Second {
		t.Errorf("Expected default timeout 10s, got %v", cfg.NormalizedTimeout())
	}

	cfg2 := &Config{Port: 2222, TimeoutSec: 30}
	if cfg2.NormalizedPort() != 2222 {
		t.Errorf("Expected port 2222, got %d", cfg2.NormalizedPort())
	}
	if cfg2.NormalizedTimeout() != 30*time.Second {
		t.Errorf("Expected timeout 30s, got %v", cfg2.NormalizedTimeout())
	}
}

func TestBuildClientConfig(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-ssh-secrets-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	secMgr, err := secrets.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("Failed to create secrets manager: %v", err)
	}

	mgr := NewClientManager(secMgr)

	// 1. Password Auth
	cfgPass := &Config{
		Host:     "127.0.0.1",
		User:     "admin",
		Password: "secret-password",
	}
	sshCfg, err := mgr.BuildClientConfig(cfgPass)
	if err != nil {
		t.Fatalf("BuildClientConfig with password failed: %v", err)
	}
	if sshCfg.User != "admin" {
		t.Errorf("Expected user admin, got %s", sshCfg.User)
	}

	// 2. Private Key Auth
	kp, _ := GenerateEd25519KeyPair("test-key")
	cfgKey := &Config{
		Host:       "127.0.0.1",
		User:       "keyuser",
		PrivateKey: kp.PrivateKeyPEM,
	}
	sshCfgKey, err := mgr.BuildClientConfig(cfgKey)
	if err != nil {
		t.Fatalf("BuildClientConfig with private key failed: %v", err)
	}
	if sshCfgKey.User != "keyuser" {
		t.Errorf("Expected user keyuser, got %s", sshCfgKey.User)
	}

	// 3. Vault Auth with Identity ID
	err = secMgr.Set(secrets.SecretItem{
		SecretMeta: secrets.SecretMeta{
			ID:    "identity_server1",
			Title: "Server 1 Auth",
			Type:  secrets.TypePassword,
			Scope: secrets.ScopeShared,
		},
		Value: "vault-pass-123",
	})
	if err != nil {
		t.Fatalf("Failed to save secret in vault: %v", err)
	}

	cfgVault := &Config{
		Host:       "127.0.0.1",
		User:       "vaultuser",
		IdentityID: "identity_server1",
	}
	sshCfgVault, err := mgr.BuildClientConfig(cfgVault)
	if err != nil {
		t.Fatalf("BuildClientConfig with vault identity failed: %v", err)
	}
	if cfgVault.Password != "vault-pass-123" {
		t.Errorf("Expected resolved password from vault, got: %s", cfgVault.Password)
	}
	if sshCfgVault.User != "vaultuser" {
		t.Errorf("Expected user vaultuser, got %s", sshCfgVault.User)
	}
}

// TestSSHInProcessMockServer spins up a lightweight in-memory Go SSH server
// to test Dial, Key authentication and ClientManager.Test.
func TestSSHInProcessMockServer(t *testing.T) {
	// 1. Generate host key
	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate host key: %v", err)
	}
	hostSigner, err := gossh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatalf("Failed to create signer from host key: %v", err)
	}

	// 2. Generate user key
	userPub, userPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate user key: %v", err)
	}
	userSigner, _ := gossh.NewSignerFromKey(userPriv)
	userPEMBlock, _ := gossh.MarshalPrivateKey(userPriv, "mock-user")
	userPrivPEM := string(pem.EncodeToMemory(userPEMBlock))
	userSSHPub, _ := gossh.NewPublicKey(userPub)

	serverConfig := &gossh.ServerConfig{
		PasswordCallback: func(conn gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
			if conn.User() == "testuser" && string(password) == "correct-pass" {
				return nil, nil
			}
			return nil, gossh.ErrNoAuth
		},
		PublicKeyCallback: func(conn gossh.ConnMetadata, key gossh.PublicKey) (*gossh.Permissions, error) {
			if conn.User() == "keyuser" && string(key.Marshal()) == string(userSSHPub.Marshal()) {
				return nil, nil
			}
			return nil, gossh.ErrNoAuth
		},
	}
	serverConfig.AddHostKey(hostSigner)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start mock ssh listener: %v", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port

	// Accept connections in background
	go func() {
		for {
			tcpConn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				sshConn, chans, reqs, err := gossh.NewServerConn(c, serverConfig)
				if err != nil {
					return
				}
				defer sshConn.Close()
				go gossh.DiscardRequests(reqs)
				for newChan := range chans {
					if newChan.ChannelType() != "session" {
						_ = newChan.Reject(gossh.UnknownChannelType, "unknown channel type")
						continue
					}
					ch, chReqs, err := newChan.Accept()
					if err != nil {
						continue
					}
					go func(in <-chan *gossh.Request) {
						for req := range in {
							_ = req.Reply(true, nil)
						}
					}(chReqs)
					_ = ch.Close()
				}
			}(tcpConn)
		}
	}()

	mgr := NewClientManager(nil)

	// 1. Test Password Success
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res := mgr.Test(ctx, &Config{
		Host:       "127.0.0.1",
		Port:       port,
		User:       "testuser",
		Password:   "correct-pass",
		TimeoutSec: 5,
	})
	if !res.Success {
		t.Fatalf("Expected password auth success, got error: %s", res.Error)
	}

	// 2. Test Password Failure
	resBad := mgr.Test(ctx, &Config{
		Host:       "127.0.0.1",
		Port:       port,
		User:       "testuser",
		Password:   "wrong-pass",
		TimeoutSec: 5,
	})
	if resBad.Success {
		t.Fatalf("Expected password auth failure, but succeeded")
	}

	// 3. Test Key Auth Success
	resKey := mgr.Test(ctx, &Config{
		Host:       "127.0.0.1",
		Port:       port,
		User:       "keyuser",
		PrivateKey: userPrivPEM,
		TimeoutSec: 5,
	})
	if !resKey.Success {
		t.Fatalf("Expected key auth success, got error: %s", resKey.Error)
	}

	_ = userSigner
}

func TestRealAlpineVM(t *testing.T) {
	conn, err := net.DialTimeout("tcp", "192.168.0.161:22", 1*time.Second)
	if err != nil {
		t.Skip("Alpine VM 192.168.0.161 not reachable, skipping live test")
	}
	_ = conn.Close()

	pass := os.Getenv("CS_TEST_SSH_PASSWORD")
	if pass == "" {
		t.Skip("CS_TEST_SSH_PASSWORD not set, skipping live Alpine VM test")
	}

	mgr := NewClientManager(nil)
	cfg := &Config{
		Host:     "192.168.0.161",
		Port:     22,
		User:     "root",
		Password: pass,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	testRes := mgr.Test(ctx, cfg)
	if !testRes.Success {
		t.Fatalf("Test live Alpine failed: %s", testRes.Error)
	}
	t.Logf("Live Alpine SSH Success! Server version: %s, Latency: %d ms", testRes.ServerVersion, testRes.LatencyMs)

	// Test SFTP List
	entries, err := mgr.ListDirectory(ctx, &SFTPRequest{
		Host:     "192.168.0.161",
		Port:     22,
		User:     "root",
		Password: pass,
		Path:     "/etc",
	})
	if err != nil {
		t.Fatalf("SFTP ListDirectory failed: %v", err)
	}
	t.Logf("SFTP Listed %d entries in /etc", len(entries))

	// Test SFTP Read /etc/hosts
	hostsData, err := mgr.ReadFile(ctx, &SFTPRequest{
		Host:     "192.168.0.161",
		Port:     22,
		User:     "root",
		Password: pass,
		Path:     "/etc/hosts",
	})
	if err != nil {
		t.Fatalf("SFTP ReadFile failed: %v", err)
	}
	t.Logf("SFTP Read /etc/hosts (%d bytes):\n%s", len(hostsData), string(hostsData))
}

func TestTOFUHostKeyVerification(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-tofu-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	knownHostsFile := filepath.Join(tmpDir, "known_hosts")
	mgr := NewClientManager(nil)
	mgr.SetKnownHostsPath(knownHostsFile)

	cb := mgr.buildHostKeyCallback()

	// Generate key A
	pubA, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ed25519 key: %v", err)
	}
	sshPubA, err := gossh.NewPublicKey(pubA)
	if err != nil {
		t.Fatalf("failed to parse ssh pubkey: %v", err)
	}

	remoteAddr, _ := net.ResolveTCPAddr("tcp", "10.0.0.5:22")

	// 1. First connection: TOFU should record key A and return nil
	if err := cb("10.0.0.5:22", remoteAddr, sshPubA); err != nil {
		t.Fatalf("expected TOFU to succeed on first connect, got %v", err)
	}

	// Verify file was written
	data, err := os.ReadFile(knownHostsFile)
	if err != nil || len(data) == 0 {
		t.Fatalf("expected known_hosts file to be populated, err: %v", err)
	}

	// 2. Second connection with same key: should succeed without error
	if err := cb("10.0.0.5:22", remoteAddr, sshPubA); err != nil {
		t.Fatalf("expected known key to match, got %v", err)
	}

	// 3. Third connection with DIFFERENT key B: MITM attack simulation!
	pubB, _, _ := ed25519.GenerateKey(rand.Reader)
	sshPubB, _ := gossh.NewPublicKey(pubB)

	errMismatch := cb("10.0.0.5:22", remoteAddr, sshPubB)
	if errMismatch == nil {
		t.Fatal("expected error on host key mismatch, but got nil!")
	}
	if !strings.Contains(errMismatch.Error(), "possible MITM attack") {
		t.Errorf("expected MITM error message, got: %v", errMismatch)
	}
}
