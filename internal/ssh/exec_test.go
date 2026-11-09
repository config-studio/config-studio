package ssh

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"net"
	"runtime"
	"strings"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

func TestExecuteCommand_Localhost(t *testing.T) {
	mgr := NewClientManager(nil)

	// 1. Success execution
	cmd := "echo hello-world"
	if runtime.GOOS == "windows" {
		cmd = "echo hello-world"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := mgr.ExecuteCommand(ctx, nil, &ExecRequest{
		Cmd:        cmd,
		TimeoutSec: 5,
	})
	if err != nil {
		t.Fatalf("ExecuteCommand local failed: %v", err)
	}

	if res.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", res.ExitCode)
	}
	if !strings.Contains(strings.TrimSpace(res.Stdout), "hello-world") {
		t.Errorf("Expected 'hello-world' in stdout, got: %q", res.Stdout)
	}
	if res.DurationMs < 0 {
		t.Errorf("Expected non-negative duration, got %d", res.DurationMs)
	}

	// 2. Command failure
	failCmd := "exit 42"
	if runtime.GOOS == "windows" {
		failCmd = "cmd /c exit 42"
	}

	resFail, err := mgr.ExecuteCommand(ctx, nil, &ExecRequest{
		Cmd:        failCmd,
		TimeoutSec: 5,
	})
	if err != nil {
		t.Fatalf("Unexpected error for failing command: %v", err)
	}
	if resFail.ExitCode != 42 {
		t.Errorf("Expected exit code 42, got %d", resFail.ExitCode)
	}

	// 3. Timeout handling
	sleepCmd := "sleep 5"
	if runtime.GOOS == "windows" {
		sleepCmd = "powershell -Command Start-Sleep -Seconds 5"
	}

	resTimeout, err := mgr.ExecuteCommand(ctx, nil, &ExecRequest{
		Cmd:        sleepCmd,
		TimeoutSec: 1, // 1 second timeout
	})
	if err == nil && resTimeout.ExitCode == 0 {
		t.Errorf("Expected command to timeout, got success with code 0")
	}
	if resTimeout != nil && !strings.Contains(strings.ToLower(resTimeout.Error), "deadline") && !strings.Contains(strings.ToLower(resTimeout.Error), "timed out") && !strings.Contains(strings.ToLower(resTimeout.Error), "timeout") {
		t.Logf("Timeout error received: %s", resTimeout.Error)
	}
}

func TestExecuteCommand_MockSSHServer(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate host key: %v", err)
	}
	privBytes, _ := gossh.MarshalPrivateKey(priv, "")
	privPEM := pem.EncodeToMemory(privBytes)
	hostSigner, err := gossh.ParsePrivateKey(privPEM)
	if err != nil {
		t.Fatalf("Failed to parse host key: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to listen: %v", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port

	serverConfig := &gossh.ServerConfig{
		PasswordCallback: func(conn gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
			if conn.User() == "testuser" && string(password) == "secret" {
				return nil, nil
			}
			return nil, fmt.Errorf("password rejected")
		},
	}
	serverConfig.AddHostKey(hostSigner)

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
							switch req.Type {
							case "exec":
								// payload has 4-byte length prefix then command
								cmdPayload := string(req.Payload[4:])
								_ = req.Reply(true, nil)
								if strings.Contains(cmdPayload, "traefik healthcheck") {
									_, _ = ch.Write([]byte("OK: healthcheck passed\n"))
									// send exit status 0
									_, _ = ch.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
								} else if strings.Contains(cmdPayload, "fail") {
									_, _ = ch.Stderr().Write([]byte("Error: broken config\n"))
									// send exit status 1
									_, _ = ch.SendRequest("exit-status", false, []byte{0, 0, 0, 1})
								} else {
									_, _ = ch.Write([]byte(fmt.Sprintf("Executed: %s\n", cmdPayload)))
									_, _ = ch.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
								}
								_ = ch.Close()
							default:
								_ = req.Reply(true, nil)
							}
						}
					}(chReqs)
				}
			}(tcpConn)
		}
	}()

	mgr := NewClientManager(nil)

	// 1. Remote SSH execution success
	ctx1, cancel1 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel1()

	cfg := &Config{
		Host:       "127.0.0.1",
		Port:       port,
		User:       "testuser",
		Password:   "secret",
		TimeoutSec: 5,
	}

	res, err := mgr.ExecuteCommand(ctx1, cfg, &ExecRequest{
		Cmd:        "traefik healthcheck",
		TimeoutSec: 5,
	})
	if err != nil {
		t.Fatalf("ExecuteCommand remote failed: %v", err)
	}

	if res.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", res.ExitCode)
	}
	if !strings.Contains(res.Stdout, "OK: healthcheck passed") {
		t.Errorf("Expected 'OK: healthcheck passed' in stdout, got: %q", res.Stdout)
	}

	// 2. Remote SSH execution failure exit code
	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()

	resFail, err := mgr.ExecuteCommand(ctx2, cfg, &ExecRequest{
		Cmd:        "run fail",
		TimeoutSec: 5,
	})
	if err != nil {
		t.Fatalf("ExecuteCommand remote fail check failed: %v", err)
	}

	if resFail.ExitCode != 1 {
		t.Errorf("Expected exit code 1, got %d (error: %s, stdout: %q, stderr: %q)", resFail.ExitCode, resFail.Error, resFail.Stdout, resFail.Stderr)
	}
	if !strings.Contains(resFail.Stderr, "Error: broken config") {
		t.Errorf("Expected 'Error: broken config' in stderr, got: %q", resFail.Stderr)
	}
	_ = pub
}
