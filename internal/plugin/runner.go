package plugin

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os/exec"
	"sync"
	"time"
)

type RunningProcess struct {
	Info      ProcessInfo
	Cmd       *exec.Cmd
	Cancel    context.CancelFunc
	LogBuffer *RingBuffer
}

// RingBuffer keeps the last N bytes of output in memory
type RingBuffer struct {
	mu   sync.Mutex
	buf  []byte
	size int
}

func NewRingBuffer(size int) *RingBuffer {
	return &RingBuffer{size: size, buf: make([]byte, 0, size)}
}

func (r *RingBuffer) Write(p []byte) (n int, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf = append(r.buf, p...)
	if len(r.buf) > r.size {
		overflow := len(r.buf) - r.size
		r.buf = r.buf[overflow:]
	}
	return len(p), nil
}

func (r *RingBuffer) String() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return string(r.buf)
}

type Runner struct {
	mu        sync.RWMutex
	processes map[string]*RunningProcess
}

func NewRunner() *Runner {
	return &Runner{
		processes: make(map[string]*RunningProcess),
	}
}

// ExecCommand runs a single command synchronously with a 60-second timeout.
func (r *Runner) ExecCommand(ctx context.Context, req ExecRequest, unrestricted bool) (*ExecResponse, error) {
	if err := ValidateCommand(req.Command, req.Args, unrestricted, req.Confirmed); err != nil {
		if errors.Is(err, ErrConfirmationNeeded) {
			return &ExecResponse{
				RequiresConfirm: true,
				Warning:         err.Error(),
			}, nil
		}
		return &ExecResponse{
			ExitCode: 1,
			Error:    err.Error(),
		}, err
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, req.Command, req.Args...)
	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	start := time.Now()
	err := cmd.Run()
	duration := time.Since(start).Milliseconds()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	return &ExecResponse{
		ExitCode:   exitCode,
		Stdout:     stdoutBuf.String(),
		Stderr:     stderrBuf.String(),
		DurationMs: duration,
	}, nil
}

// StartProcess starts a background process tracked by Runner.
func (r *Runner) StartProcess(pluginID, command string, args []string, cwd string, port int, unrestricted bool, confirmed bool) (*ProcessInfo, error) {
	if err := ValidateCommand(command, args, unrestricted, confirmed); err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, command, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}

	logBuf := NewRingBuffer(64 * 1024) // 64 KB rolling log
	cmd.Stdout = logBuf
	cmd.Stderr = logBuf

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start process %s: %w", command, err)
	}

	b := make([]byte, 8)
	_, _ = rand.Read(b)
	procID := "proc_" + hex.EncodeToString(b)

	info := ProcessInfo{
		ID:        procID,
		PluginID:  pluginID,
		Command:   command,
		Args:      args,
		Pid:       cmd.Process.Pid,
		Port:      port,
		StartedAt: time.Now(),
		Status:    "running",
	}

	rp := &RunningProcess{
		Info:      info,
		Cmd:       cmd,
		Cancel:    cancel,
		LogBuffer: logBuf,
	}

	r.mu.Lock()
	if len(r.processes) >= 50 {
		r.pruneStoppedLocked()
	}
	r.processes[procID] = rp
	r.mu.Unlock()

	// Monitor exit in background
	go func() {
		_ = cmd.Wait()
		r.mu.Lock()
		if p, ok := r.processes[procID]; ok {
			p.Info.Status = "stopped"
		}
		r.mu.Unlock()
	}()

	return &info, nil
}

// StopProcess terminates a background process by ID.
func (r *Runner) StopProcess(procID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	rp, ok := r.processes[procID]
	if !ok {
		return fmt.Errorf("process %s not found", procID)
	}

	rp.Cancel()
	if rp.Cmd.Process != nil {
		_ = rp.Cmd.Process.Kill()
	}
	rp.Info.Status = "stopped"
	delete(r.processes, procID)
	return nil
}

// StopAllForPlugin terminates all processes started by a specific plugin.
func (r *Runner) StopAllForPlugin(pluginID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for id, rp := range r.processes {
		if rp.Info.PluginID == pluginID {
			rp.Cancel()
			if rp.Cmd.Process != nil {
				_ = rp.Cmd.Process.Kill()
			}
			delete(r.processes, id)
		}
	}
}

// ListProcesses returns all currently active processes.
func (r *Runner) ListProcesses() []ProcessInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	res := make([]ProcessInfo, 0, len(r.processes))
	for _, rp := range r.processes {
		res = append(res, rp.Info)
	}
	return res
}

// GetProcessLogs retrieves in-memory logs for a process.
func (r *Runner) GetProcessLogs(procID string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	rp, ok := r.processes[procID]
	if !ok {
		return "", fmt.Errorf("process %s not found", procID)
	}
	return rp.LogBuffer.String(), nil
}

// Shutdown terminates all managed processes.
func (r *Runner) Shutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, rp := range r.processes {
		rp.Cancel()
		if rp.Cmd.Process != nil {
			_ = rp.Cmd.Process.Kill()
		}
	}
	r.processes = make(map[string]*RunningProcess)
}

func (r *Runner) pruneStoppedLocked() {
	for id, p := range r.processes {
		if p.Info.Status == "stopped" {
			delete(r.processes, id)
		}
	}
}
