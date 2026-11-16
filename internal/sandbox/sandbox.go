package sandbox

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"config-studio/internal/fleet"
	"config-studio/internal/hosts"
	"config-studio/internal/secrets"
	"config-studio/internal/ssh"
	"github.com/dop251/goja"
)

// EvalRequest defines the payload for sandbox script execution.
type EvalRequest struct {
	Code       string         `json:"code"`
	TimeoutMs  int            `json:"timeoutMs,omitempty"`  // Default 10000ms (10s), max 30000ms
	Context    map[string]any `json:"context,omitempty"`    // Custom input variables available under `context.*`
	AllowWrite bool           `json:"allowWrite,omitempty"` // Flag to allow fs.writeFile
}

// EvalResult contains the result, captured logs, and timing of an execution.
type EvalResult struct {
	Success    bool     `json:"success"`
	Value      any      `json:"value,omitempty"`
	Logs       []string `json:"logs"`
	DurationMs int64    `json:"durationMs"`
	Error      string   `json:"error,omitempty"`
}

// Options configures runtime boundaries for the ephemeral sandbox.
type Options struct {
	DefaultTimeout time.Duration
	MaxTimeout     time.Duration
	MaxStackDepth  int
}

// DefaultOptions returns recommended production-safe boundaries.
func DefaultOptions() Options {
	return Options{
		DefaultTimeout: 10 * time.Second,
		MaxTimeout:     30 * time.Second,
		MaxStackDepth:  256,
	}
}

// FleetProvider abstracts fleet inventory operations.
type FleetProvider interface {
	ListServers() []fleet.ServerNode
	GetServer(id string) (*fleet.ServerNode, error)
}

// HostsProvider abstracts Core SSH host operations.
type HostsProvider interface {
	List() []*hosts.Host
	Get(id string) (*hosts.Host, error)
}

// SSHProvider abstracts headless command execution.
type SSHProvider interface {
	ExecuteCommand(ctx context.Context, cfg *ssh.Config, req *ssh.ExecRequest) (*ssh.ExecResult, error)
}

// FSProvider abstracts filesystem operations.
type FSProvider interface {
	ReadFile(path string) ([]byte, error)
	WriteFile(path string, data []byte) error
	ListFiles(dir string) ([]string, error)
}

// VaultProvider abstracts encrypted secrets retrieval.
type VaultProvider interface {
	Get(id string) (string, error)
	List() []secrets.SecretMeta
}

// Service manages ephemeral Goja runtimes.
type Service struct {
	fleet   FleetProvider
	hosts   HostsProvider
	ssh     SSHProvider
	fs      FSProvider
	vault   VaultProvider
	opts    Options
}

// NewService creates a new sandbox Service with injected dependencies.
func NewService(opts Options, fleet FleetProvider, hosts HostsProvider, ssh SSHProvider, fs FSProvider, vault VaultProvider) *Service {
	if opts.DefaultTimeout <= 0 {
		opts.DefaultTimeout = 10 * time.Second
	}
	if opts.MaxTimeout <= 0 {
		opts.MaxTimeout = 30 * time.Second
	}
	if opts.MaxStackDepth <= 0 {
		opts.MaxStackDepth = 256
	}
	return &Service{
		fleet: fleet,
		hosts: hosts,
		ssh:   ssh,
		fs:    fs,
		vault: vault,
		opts:  opts,
	}
}

// Eval executes a JavaScript snippet inside an ephemeral, isolated Goja runtime.
func (s *Service) Eval(ctx context.Context, req EvalRequest) (*EvalResult, error) {
	start := time.Now()
	res := &EvalResult{
		Logs: make([]string, 0),
	}

	code := strings.TrimSpace(req.Code)
	if code == "" {
		res.Success = false
		res.Error = "script code cannot be empty"
		res.DurationMs = time.Since(start).Milliseconds()
		return res, nil
	}

	timeout := s.opts.DefaultTimeout
	if req.TimeoutMs > 0 {
		reqTimeout := time.Duration(req.TimeoutMs) * time.Millisecond
		if reqTimeout > s.opts.MaxTimeout {
			timeout = s.opts.MaxTimeout
		} else {
			timeout = reqTimeout
		}
	}

	evalCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Ephemeral Goja instance: created on-demand, zero heap in idle
	vm := goja.New()
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	vm.SetMaxCallStackSize(s.opts.MaxStackDepth)

	// Interrupter for runaway loops or timeouts
	interrupted := false
	var interrupterMu sync.Mutex

	timer := time.AfterFunc(timeout, func() {
		interrupterMu.Lock()
		interrupted = true
		interrupterMu.Unlock()
		vm.Interrupt("execution timeout exceeded")
	})
	defer timer.Stop()

	// Watch parent context cancellation
	go func() {
		<-evalCtx.Done()
		if evalCtx.Err() == context.Canceled {
			interrupterMu.Lock()
			interrupted = true
			interrupterMu.Unlock()
			vm.Interrupt("execution canceled by client")
		}
	}()

	// 1. Setup console logger
	var logsMu sync.Mutex
	logFn := func(prefix string) func(call goja.FunctionCall) goja.Value {
		return func(call goja.FunctionCall) goja.Value {
			parts := make([]string, len(call.Arguments))
			for i, arg := range call.Arguments {
				parts[i] = fmt.Sprint(arg.Export())
			}
			line := strings.Join(parts, " ")
			if prefix != "" {
				line = fmt.Sprintf("[%s] %s", prefix, line)
			}
			logsMu.Lock()
			res.Logs = append(res.Logs, line)
			logsMu.Unlock()
			return goja.Undefined()
		}
	}

	consoleObj := vm.NewObject()
	_ = consoleObj.Set("log", logFn(""))
	_ = consoleObj.Set("info", logFn("INFO"))
	_ = consoleObj.Set("warn", logFn("WARN"))
	_ = consoleObj.Set("error", logFn("ERROR"))
	_ = vm.Set("console", consoleObj)

	// 2. Setup user context
	if req.Context != nil {
		_ = vm.Set("context", req.Context)
	} else {
		_ = vm.Set("context", map[string]any{})
	}

	// 3. Setup safe Core facade cs.*
	csObj := vm.NewObject()

	// cs.servers
	serversObj := vm.NewObject()
	_ = serversObj.Set("list", func(call goja.FunctionCall) goja.Value {
		if s.fleet == nil {
			return vm.ToValue([]any{})
		}
		return vm.ToValue(s.fleet.ListServers())
	})
	_ = serversObj.Set("get", func(call goja.FunctionCall) goja.Value {
		if s.fleet == nil || len(call.Arguments) == 0 {
			return goja.Null()
		}
		id := call.Arguments[0].String()
		srv, err := s.fleet.GetServer(id)
		if err != nil {
			return goja.Null()
		}
		return vm.ToValue(srv)
	})
	_ = csObj.Set("servers", serversObj)

	// cs.hosts
	hostsObj := vm.NewObject()
	_ = hostsObj.Set("list", func(call goja.FunctionCall) goja.Value {
		if s.hosts == nil {
			return vm.ToValue([]any{})
		}
		return vm.ToValue(s.hosts.List())
	})
	_ = hostsObj.Set("get", func(call goja.FunctionCall) goja.Value {
		if s.hosts == nil || len(call.Arguments) == 0 {
			return goja.Null()
		}
		id := call.Arguments[0].String()
		h, err := s.hosts.Get(id)
		if err != nil || h == nil {
			return goja.Null()
		}
		return vm.ToValue(h)
	})
	_ = csObj.Set("hosts", hostsObj)

	// cs.ssh
	sshObj := vm.NewObject()
	_ = sshObj.Set("exec", func(call goja.FunctionCall) goja.Value {
		if s.ssh == nil {
			panic(vm.ToValue("ssh executor is not initialized"))
		}
		if len(call.Arguments) < 2 {
			panic(vm.ToValue("cs.ssh.exec requires at least 2 arguments: hostId, command"))
		}
		hostID := call.Arguments[0].String()
		cmdStr := call.Arguments[1].String()
		timeoutSec := 10
		if len(call.Arguments) >= 3 && call.Arguments[2].ToInteger() > 0 {
			timeoutSec = int(call.Arguments[2].ToInteger())
		}

		var cfg *ssh.Config
		if hostID != "localhost" && hostID != "local" && hostID != "" && s.hosts != nil {
			h, err := s.hosts.Get(hostID)
			if err != nil || h == nil {
				panic(vm.ToValue(fmt.Sprintf("ssh host %q not found in core inventory", hostID)))
			}
			cfg = &ssh.Config{
				Host: h.Host,
				Port: h.Port,
				User: h.User,
			}
		}

		sshRes, err := s.ssh.ExecuteCommand(evalCtx, cfg, &ssh.ExecRequest{
			Cmd:        cmdStr,
			TimeoutSec: timeoutSec,
		})
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("ssh exec failure: %v", err)))
		}
		return vm.ToValue(map[string]any{
			"stdout":   sshRes.Stdout,
			"stderr":   sshRes.Stderr,
			"exitCode": sshRes.ExitCode,
			"error":    sshRes.Error,
		})
	})
	_ = csObj.Set("ssh", sshObj)

	// cs.fs
	fsObj := vm.NewObject()
	_ = fsObj.Set("readFile", func(call goja.FunctionCall) goja.Value {
		if s.fs == nil {
			panic(vm.ToValue("fs provider is not initialized"))
		}
		if len(call.Arguments) == 0 {
			panic(vm.ToValue("cs.fs.readFile requires path argument"))
		}
		path := call.Arguments[0].String()
		data, err := s.fs.ReadFile(path)
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("failed to read file %q: %v", path, err)))
		}
		return vm.ToValue(string(data))
	})
	_ = fsObj.Set("writeFile", func(call goja.FunctionCall) goja.Value {
		if !req.AllowWrite {
			panic(vm.ToValue("cs.fs.writeFile is disabled by sandbox security policy (set allowWrite: true to enable)"))
		}
		if s.fs == nil {
			panic(vm.ToValue("fs provider is not initialized"))
		}
		if len(call.Arguments) < 2 {
			panic(vm.ToValue("cs.fs.writeFile requires path and content arguments"))
		}
		path := call.Arguments[0].String()
		content := call.Arguments[1].String()
		if err := s.fs.WriteFile(path, []byte(content)); err != nil {
			panic(vm.ToValue(fmt.Sprintf("failed to write file %q: %v", path, err)))
		}
		return vm.ToValue(true)
	})
	_ = fsObj.Set("listFiles", func(call goja.FunctionCall) goja.Value {
		if s.fs == nil {
			panic(vm.ToValue("fs provider is not initialized"))
		}
		dir := ""
		if len(call.Arguments) > 0 {
			dir = call.Arguments[0].String()
		}
		files, err := s.fs.ListFiles(dir)
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("failed to list files in %q: %v", dir, err)))
		}
		return vm.ToValue(files)
	})
	_ = csObj.Set("fs", fsObj)

	// cs.vault
	vaultObj := vm.NewObject()
	_ = vaultObj.Set("list", func(call goja.FunctionCall) goja.Value {
		if s.vault == nil {
			return vm.ToValue([]any{})
		}
		items := s.vault.List()
		resList := make([]map[string]any, len(items))
		for i, it := range items {
			resList[i] = map[string]any{
				"id":    it.ID,
				"title": it.Title,
				"type":  it.Type,
				"scope": it.Scope,
			}
		}
		return vm.ToValue(resList)
	})
	_ = vaultObj.Set("getSecret", func(call goja.FunctionCall) goja.Value {
		if s.vault == nil || len(call.Arguments) == 0 {
			return goja.Null()
		}
		id := call.Arguments[0].String()
		val, err := s.vault.Get(id)
		if err != nil {
			return goja.Null()
		}
		return vm.ToValue(val)
	})
	_ = csObj.Set("vault", vaultObj)

	_ = vm.Set("cs", csObj)

	// Execute user script
	v, err := vm.RunString(code)
	res.DurationMs = time.Since(start).Milliseconds()

	if err != nil {
		interrupterMu.Lock()
		wasInterrupted := interrupted
		interrupterMu.Unlock()

		if wasInterrupted {
			res.Success = false
			res.Error = "execution timeout exceeded"
			return res, nil
		}

		res.Success = false
		res.Error = cleanErrorMessage(err)
		return res, nil
	}

	res.Success = true
	if v != nil && !goja.IsUndefined(v) && !goja.IsNull(v) {
		res.Value = v.Export()
	}

	return res, nil
}

func cleanErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	var stackErr *goja.StackOverflowError
	if errors.As(err, &stackErr) {
		return "RangeError: Maximum call stack size exceeded"
	}
	var jsErr *goja.Exception
	if errors.As(err, &jsErr) {
		if jsErr.Value() != nil {
			valStr := jsErr.Value().String()
			if valStr != "" {
				return valStr
			}
		}
	}
	return err.Error()
}
