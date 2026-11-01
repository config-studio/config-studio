package ssh

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	gossh "golang.org/x/crypto/ssh"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin: func(r *http.Request) bool {
		return true // Config Studio handles origin validation in auth middleware
	},
}

// wsSafeWriter serializes writes to a WebSocket connection.
type wsSafeWriter struct {
	mu sync.Mutex
	ws *websocket.Conn
}

func (w *wsSafeWriter) WriteMessage(messageType int, data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.ws.WriteMessage(messageType, data)
}

// HandleWebSocket manages an interactive PTY session over a WebSocket connection.
func (m *ClientManager) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to upgrade websocket: %v", err), http.StatusBadRequest)
		return
	}
	defer ws.Close()

	safeWS := &wsSafeWriter{ws: ws}

	// 1. Read initialization handshake message
	_ = ws.SetReadDeadline(time.Now().Add(15 * time.Second))
	_, initPayload, err := ws.ReadMessage()
	if err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Connection Error]\x1b[0m Handshake read failed: %v\r\n", err)))
		return
	}
	_ = ws.SetReadDeadline(time.Time{}) // Clear deadline

	var initMsg TerminalInitMessage
	if err := json.Unmarshal(initPayload, &initMsg); err != nil || initMsg.Type != "init" {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Connection Error]\x1b[0m Expected init message, got: %s\r\n", string(initPayload))))
		return
	}

	cfg := &Config{
		Host:       initMsg.Host,
		Port:       initMsg.Port,
		User:       initMsg.User,
		AuthType:   initMsg.AuthType,
		Password:   initMsg.Password,
		PrivateKey: initMsg.PrivateKey,
		Passphrase: initMsg.Passphrase,
		IdentityID: initMsg.IdentityID,
		JumpHost:   initMsg.JumpHost,
		TimeoutSec: 15,
	}

	// 2. Establish SSH connection
	_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\x1b[33mConnecting to %s@%s:%d...\x1b[0m\r\n", cfg.User, cfg.Host, cfg.NormalizedPort())))
	
	client, err := m.Dial(r.Context(), cfg)
	if err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Connection Failed]\x1b[0m %v\r\n", err)))
		return
	}
	defer client.Close()

	// 3. Create SSH Session
	session, err := client.NewSession()
	if err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Session Error]\x1b[0m Failed to create session: %v\r\n", err)))
		return
	}
	defer session.Close()

	cols := initMsg.Cols
	if cols <= 0 {
		cols = 120
	}
	rows := initMsg.Rows
	if rows <= 0 {
		rows = 35
	}
	term := initMsg.Term
	if term == "" {
		term = "xterm-256color"
	}

	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 14400,
		gossh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty(term, rows, cols, modes); err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH PTY Error]\x1b[0m RequestPty failed: %v\r\n", err)))
		return
	}

	stdinPipe, err := session.StdinPipe()
	if err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Error]\x1b[0m Stdin pipe failed: %v\r\n", err)))
		return
	}

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Error]\x1b[0m Stdout pipe failed: %v\r\n", err)))
		return
	}

	stderrPipe, err := session.StderrPipe()
	if err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Error]\x1b[0m Stderr pipe failed: %v\r\n", err)))
		return
	}

	if err := session.Shell(); err != nil {
		_ = safeWS.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31;1m[SSH Error]\x1b[0m Starting shell failed: %v\r\n", err)))
		return
	}

	_ = safeWS.WriteMessage(websocket.TextMessage, []byte("\x1b[32mSSH Session Connected.\x1b[0m\r\n"))

	var wg sync.WaitGroup
	wg.Add(2)

	// Pump stdout/stderr to WebSocket
	pumpOutput := func(r io.Reader) {
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			n, readErr := r.Read(buf)
			if n > 0 {
				if writeErr := safeWS.WriteMessage(websocket.BinaryMessage, buf[:n]); writeErr != nil {
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}

	go pumpOutput(io.MultiReader(stdoutPipe, stderrPipe))

	// Pump WebSocket messages to stdin & handle control messages
	go func() {
		defer wg.Done()
		defer stdinPipe.Close()

		for {
			mType, data, readErr := ws.ReadMessage()
			if readErr != nil {
				return
			}

			if mType == websocket.BinaryMessage {
				if _, err := stdinPipe.Write(data); err != nil {
					return
				}
				continue
			}

			// Text messages can be raw keystrokes or control JSON
			if len(data) > 0 && data[0] == '{' {
				var ctrl TerminalControlMessage
				if err := json.Unmarshal(data, &ctrl); err == nil && ctrl.Type != "" {
					switch ctrl.Type {
					case "resize":
						if ctrl.Cols > 0 && ctrl.Rows > 0 {
							_ = session.WindowChange(ctrl.Rows, ctrl.Cols)
						}
						continue
					case "ping":
						_ = safeWS.WriteMessage(websocket.TextMessage, []byte(`{"type":"pong"}`))
						continue
					}
				}
			}

			// Forward raw input text to stdin
			if _, err := stdinPipe.Write(data); err != nil {
				return
			}
		}
	}()

	_ = session.Wait()
	_ = safeWS.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[33m[Connection closed by remote host]\x1b[0m\r\n"))
}
