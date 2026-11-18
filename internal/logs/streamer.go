package logs

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"config-studio/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
)

// StreamOptions contains parameters for starting a log stream.
type StreamOptions struct {
	HostID string            `json:"hostId,omitempty"`
	Source string            `json:"source,omitempty"`
	Cmd    string            `json:"cmd"`
	Tail   int               `json:"tail,omitempty"`
	Env    map[string]string `json:"env,omitempty"`
	Sudo   bool              `json:"sudo,omitempty"`
}

// StreamService handles running processes and streaming output as Server-Sent Events (SSE).
type StreamService struct{}

func NewStreamService() *StreamService {
	return &StreamService{}
}

// StreamSSE executes the requested command (locally or over SSH) and streams structured events to the client.
func (s *StreamService) StreamSSE(ctx context.Context, w http.ResponseWriter, sshMgr *ssh.ClientManager, sshCfg *ssh.Config, opts *StreamOptions) error {
	if opts == nil || strings.TrimSpace(opts.Cmd) == "" {
		return errors.New("command cannot be empty")
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		return errors.New("streaming unsupported by client connection")
	}

	// Set standard SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable Nginx proxy buffering

	// Disable HTTP write deadlines for streaming connection
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	flusher.Flush()

	source := opts.Source
	if source == "" {
		source = "app"
	}

	// Channel to merge stdout and stderr
	linesChan := make(chan *LogEntry, 64)
	doneChan := make(chan struct{})

	var wg sync.WaitGroup

	// Helper to send SSE event
	sendEvent := func(event string, id string, data interface{}) error {
		payload, err := json.Marshal(data)
		if err != nil {
			return err
		}
		if id != "" {
			if _, err := fmt.Fprintf(w, "id: %s\n", id); err != nil {
				return err
			}
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	// Send initial connected event
	_ = sendEvent("ready", "", map[string]interface{}{
		"source": source,
		"cmd":    opts.Cmd,
		"time":   time.Now().UTC(),
	})

	// Check if local or remote
	isLocal := sshCfg == nil ||
		sshCfg.Host == "" ||
		sshCfg.Host == "localhost" ||
		sshCfg.Host == "127.0.0.1"

	if sshCfg != nil && (sshCfg.Password != "" || sshCfg.PrivateKey != "" || sshCfg.IdentityID != "" || sshCfg.JumpHost != nil || (sshCfg.Port > 0 && sshCfg.Port != 22)) {
		isLocal = false
	}

	var exitCode = 0
	var runErr error

	// Consumer goroutine that writes to SSE must be started BEFORE executing the command
	// to prevent pipe buffer deadlocks on commands outputting >64 lines.
	go func() {
		defer close(doneChan)
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case entry, ok := <-linesChan:
				if !ok {
					return
				}
				if err := sendEvent("log", entry.ID, entry); err != nil {
					return
				}
			case <-ticker.C:
				// Keep-alive ping
				if err := sendEvent("ping", "", map[string]interface{}{}); err != nil {
					return
				}
			}
		}
	}()

	if isLocal {
		exitCode, runErr = s.runLocalCommand(ctx, opts, source, linesChan, &wg)
	} else {
		if sshMgr == nil {
			_ = sendEvent("error", "", map[string]string{"error": "SSH manager not configured"})
			close(linesChan)
			<-doneChan
			return errors.New("SSH manager not configured")
		}
		exitCode, runErr = s.runRemoteCommand(ctx, sshMgr, sshCfg, opts, source, linesChan, &wg)
	}

	// Wait for process and lines reader to finish
	wg.Wait()
	close(linesChan)
	<-doneChan

	// Send end event
	endPayload := map[string]interface{}{
		"exitCode": exitCode,
	}
	if runErr != nil {
		endPayload["error"] = runErr.Error()
	}
	_ = sendEvent("end", "", endPayload)

	return nil
}

func (s *StreamService) runLocalCommand(ctx context.Context, opts *StreamOptions, source string, ch chan<- *LogEntry, wg *sync.WaitGroup) (int, error) {
	var cmd *exec.Cmd
	cleanCmd := strings.TrimSpace(opts.Cmd)

	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd.exe", "/c", cleanCmd)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", cleanCmd)
	}

	if len(opts.Env) > 0 {
		for k, v := range opts.Env {
			cmd.Env = append(cmd.Environ(), fmt.Sprintf("%s=%s", k, v))
		}
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return -1, fmt.Errorf("stdout pipe error: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return -1, fmt.Errorf("stderr pipe error: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return -1, fmt.Errorf("command start error: %w", err)
	}

	wg.Add(2)
	go scanPipe(ctx, stdoutPipe, source, "stdout", ch, wg)
	go scanPipe(ctx, stderrPipe, source, "stderr", ch, wg)

	err = cmd.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	return exitCode, err
}

func (s *StreamService) runRemoteCommand(ctx context.Context, sshMgr *ssh.ClientManager, sshCfg *ssh.Config, opts *StreamOptions, source string, ch chan<- *LogEntry, wg *sync.WaitGroup) (int, error) {
	client, err := sshMgr.Dial(ctx, sshCfg)
	if err != nil {
		return -1, fmt.Errorf("SSH dial failed: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return -1, fmt.Errorf("SSH session creation failed: %w", err)
	}
	defer session.Close()

	for k, v := range opts.Env {
		_ = session.Setenv(k, v)
	}

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		return -1, fmt.Errorf("SSH stdout pipe error: %w", err)
	}
	stderrPipe, err := session.StderrPipe()
	if err != nil {
		return -1, fmt.Errorf("SSH stderr pipe error: %w", err)
	}

	finalCmd := strings.TrimSpace(opts.Cmd)
	if opts.Sudo && sshCfg.User != "root" && sshCfg.Password != "" {
		finalCmd = fmt.Sprintf("echo '%s' | sudo -S -p '' %s", strings.ReplaceAll(sshCfg.Password, "'", `'\''`), finalCmd)
	}

	if err := session.Start(finalCmd); err != nil {
		return -1, fmt.Errorf("SSH command start error: %w", err)
	}

	// Close session early if client disconnects context
	go func() {
		<-ctx.Done()
		_ = session.Close()
	}()

	wg.Add(2)
	go scanPipe(ctx, stdoutPipe, source, "stdout", ch, wg)
	go scanPipe(ctx, stderrPipe, source, "stderr", ch, wg)

	err = session.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*gossh.ExitError); ok {
			exitCode = exitErr.ExitStatus()
		} else {
			exitCode = -1
		}
	}

	return exitCode, err
}

func scanPipe(ctx context.Context, r io.Reader, source string, stream string, ch chan<- *LogEntry, wg *sync.WaitGroup) {
	defer wg.Done()
	scanner := bufio.NewScanner(r)
	// Support long log lines up to 256KB
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 256*1024)

	for scanner.Scan() {
		line := scanner.Text()
		entry := ParseLogLine(line, source, stream)
		select {
		case ch <- entry:
		case <-ctx.Done():
			return
		}
	}
}
