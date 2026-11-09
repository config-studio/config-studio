package ssh

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// ExecRequest defines parameters for a non-interactive command execution.
type ExecRequest struct {
	HostID     string            `json:"hostId,omitempty"`
	Config     *Config           `json:"config,omitempty"`
	Cmd        string            `json:"cmd"`
	TimeoutSec int               `json:"timeoutSec,omitempty"`
	Env        map[string]string `json:"env,omitempty"`
	Sudo       bool              `json:"sudo,omitempty"`
}

// ExecResult represents the output and metrics of non-interactive command execution.
type ExecResult struct {
	ExitCode   int    `json:"exitCode"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"durationMs"`
	Error      string `json:"error,omitempty"`
}

// ExecuteCommand executes a command either locally (if cfg is nil / localhost) or remotely via SSH.
func (m *ClientManager) ExecuteCommand(ctx context.Context, cfg *Config, req *ExecRequest) (*ExecResult, error) {
	if req == nil {
		return nil, errors.New("exec request cannot be nil")
	}
	cleanCmd := strings.TrimSpace(req.Cmd)
	if cleanCmd == "" {
		return nil, errors.New("command cannot be empty")
	}

	timeout := 10 * time.Second
	if req.TimeoutSec > 0 {
		timeout = time.Duration(req.TimeoutSec) * time.Second
		if timeout > 60*time.Second {
			timeout = 60 * time.Second
		}
	}

	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	start := time.Now()

	// Check if this should be executed locally
	isLocal := cfg == nil ||
		cfg.Host == "" ||
		cfg.Host == "localhost" ||
		cfg.Host == "127.0.0.1"

	// If cfg has explicit authentication, custom port, or jump host, it's not a direct local OS exec
	if cfg != nil && (cfg.Password != "" || cfg.PrivateKey != "" || cfg.IdentityID != "" || cfg.JumpHost != nil || (cfg.Port > 0 && cfg.Port != 22)) {
		isLocal = false
	}

	if isLocal {
		return executeLocalCommand(execCtx, cleanCmd, req.Env, start)
	}

	return m.executeRemoteSSHCommand(execCtx, cfg, cleanCmd, req, start)
}

func executeLocalCommand(ctx context.Context, command string, env map[string]string, start time.Time) (*ExecResult, error) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd.exe", "/c", command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}

	if len(env) > 0 {
		for k, v := range env {
			cmd.Env = append(cmd.Environ(), fmt.Sprintf("%s=%s", k, v))
		}
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err := cmd.Run()
	durationMs := time.Since(start).Milliseconds()

	exitCode := 0
	var errStr string

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
			errStr = err.Error()
		}
	}

	return &ExecResult{
		ExitCode:   exitCode,
		Stdout:     stdoutBuf.String(),
		Stderr:     stderrBuf.String(),
		DurationMs: durationMs,
		Error:      errStr,
	}, nil
}

func (m *ClientManager) executeRemoteSSHCommand(ctx context.Context, cfg *Config, command string, req *ExecRequest, start time.Time) (*ExecResult, error) {
	client, err := m.Dial(ctx, cfg)
	if err != nil {
		return &ExecResult{
			ExitCode:   -1,
			DurationMs: time.Since(start).Milliseconds(),
			Error:      fmt.Sprintf("SSH connection failed: %v", err),
		}, nil
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return &ExecResult{
			ExitCode:   -1,
			DurationMs: time.Since(start).Milliseconds(),
			Error:      fmt.Sprintf("Failed to create SSH session: %v", err),
		}, nil
	}
	defer session.Close()

	// Set environment variables if supported
	for k, v := range req.Env {
		_ = session.Setenv(k, v)
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	session.Stdout = &stdoutBuf
	session.Stderr = &stderrBuf

	finalCmd := command
	if req.Sudo && cfg.User != "root" && cfg.Password != "" {
		finalCmd = fmt.Sprintf("echo '%s' | sudo -S -p '' %s", strings.ReplaceAll(cfg.Password, "'", `'\''`), command)
	}

	runErr := session.Run(finalCmd)
	durationMs := time.Since(start).Milliseconds()

	exitCode := 0
	var errStr string

	if runErr != nil {
		if exitErr, ok := runErr.(*gossh.ExitError); ok {
			exitCode = exitErr.ExitStatus()
		} else {
			exitCode = -1
			errStr = runErr.Error()
		}
	}

	return &ExecResult{
		ExitCode:   exitCode,
		Stdout:     stdoutBuf.String(),
		Stderr:     stderrBuf.String(),
		DurationMs: durationMs,
		Error:      errStr,
	}, nil
}
