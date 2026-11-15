package fleet

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"config-studio/internal/secrets"
	"config-studio/internal/ssh"
)

// BatchInstallOptions defines parameters for multi-node agent provisioning.
type BatchInstallOptions struct {
	ServerIDs   []string            `json:"serverIds"`   // Target servers (if empty, targets all non-localhost servers)
	Concurrency int                 `json:"concurrency"` // Max parallel workers (default: 4, min: 1, max: 10)
	SkipHealthy bool                `json:"skipHealthy"` // Skip nodes that already have a functioning agent
	Options     InstallAgentOptions `json:"options"`     // Port, UseSudo, ServiceType, UpgradeOnly, AgentsDir
}

// BatchHostStatus represents progress and outcome for an individual server.
type BatchHostStatus struct {
	ServerID string   `json:"serverId"`
	Name     string   `json:"name"`
	Host     string   `json:"host"`
	Status   string   `json:"status"` // "pending", "connecting", "installing", "success", "skipped", "error"
	Step     string   `json:"step,omitempty"`
	Logs     []string `json:"logs,omitempty"`
	AgentURL string   `json:"agentUrl,omitempty"`
	Error    string   `json:"error,omitempty"`
}

// BatchInstallResult summarizes the entire batch provisioning run.
type BatchInstallResult struct {
	Total    int               `json:"total"`
	Success  int               `json:"success"`
	Failed   int               `json:"failed"`
	Skipped  int               `json:"skipped"`
	Statuses []BatchHostStatus `json:"statuses"`
}

// BatchInstallProgressFunc is called as each host changes status or outputs logs.
type BatchInstallProgressFunc func(status BatchHostStatus)

// BatchInstallAgents provisions config-studio-agent across multiple fleet servers concurrently.
func (m *Manager) BatchInstallAgents(
	ctx context.Context,
	opts BatchInstallOptions,
	sshMgr *ssh.ClientManager,
	secMgr *secrets.Manager,
	onProgress BatchInstallProgressFunc,
) (*BatchInstallResult, error) {
	var targets []*ServerNode
	seen := make(map[string]bool)

	if len(opts.ServerIDs) > 0 {
		for _, id := range opts.ServerIDs {
			id = strings.TrimSpace(id)
			if id == "" || id == "localhost" || seen[id] {
				continue
			}
			seen[id] = true
			srv, err := m.GetServer(id)
			if err == nil && srv != nil {
				targets = append(targets, srv)
			}
		}
	} else {
		for _, srv := range m.ListServers() {
			if srv.ID == "localhost" || seen[srv.ID] {
				continue
			}
			seen[srv.ID] = true
			cp := srv
			targets = append(targets, &cp)
		}
	}

	if len(targets) == 0 {
		return &BatchInstallResult{
			Total:    0,
			Statuses: make([]BatchHostStatus, 0),
		}, nil
	}

	concurrency := opts.Concurrency
	if concurrency <= 0 {
		concurrency = 4
	}
	if concurrency > 10 {
		concurrency = 10
	}
	if concurrency > len(targets) {
		concurrency = len(targets)
	}

	httpClient := &http.Client{Timeout: 2 * time.Second}

	var mu sync.Mutex
	statusMap := make(map[string]*BatchHostStatus)
	for _, srv := range targets {
		hostStr := srv.Host
		if hostStr == "" && srv.Connection.SSH != nil {
			hostStr = srv.Connection.SSH.Host
		}
		statusMap[srv.ID] = &BatchHostStatus{
			ServerID: srv.ID,
			Name:     srv.Name,
			Host:     hostStr,
			Status:   "pending",
			Step:     "В очереди",
			Logs:     make([]string, 0),
		}
	}

	emitProgress := func(st BatchHostStatus) {
		if onProgress != nil {
			onProgress(st)
		}
	}

	// Initial status emission for all targets
	for _, srv := range targets {
		emitProgress(*statusMap[srv.ID])
	}

	taskChan := make(chan *ServerNode, len(targets))
	for _, srv := range targets {
		taskChan <- srv
	}
	close(taskChan)

	var wg sync.WaitGroup
	for w := 0; w < concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for srv := range taskChan {
				select {
				case <-ctx.Done():
					mu.Lock()
					st := statusMap[srv.ID]
					st.Status = "error"
					st.Step = "Прервано"
					st.Error = "Контекст выполнения отменен"
					emitProgress(*st)
					mu.Unlock()
					continue
				default:
				}

				// Check if should skip healthy
				if opts.SkipHealthy && srv.Connection.Agent != nil && srv.Connection.Agent.Enabled && srv.Connection.Agent.URL != "" {
					checkURL := fmt.Sprintf("%s/api/health", strings.TrimRight(srv.Connection.Agent.URL, "/"))
					req, _ := http.NewRequestWithContext(ctx, "GET", checkURL, nil)
					resp, err := httpClient.Do(req)
					if err == nil && resp.StatusCode == http.StatusOK {
						_ = resp.Body.Close()
						mu.Lock()
						st := statusMap[srv.ID]
						st.Status = "skipped"
						st.Step = "Агент уже активен"
						st.AgentURL = srv.Connection.Agent.URL
						st.Logs = append(st.Logs, "Узел пропущен: обнаружен рабочий агент на "+srv.Connection.Agent.URL)
						emitProgress(*st)
						mu.Unlock()
						continue
					}
					if resp != nil {
						_ = resp.Body.Close()
					}
				}

				// Check if SSH is enabled
				if srv.Connection.SSH == nil || !srv.Connection.SSH.Enabled {
					mu.Lock()
					st := statusMap[srv.ID]
					st.Status = "error"
					st.Step = "Ошибка SSH"
					st.Error = "SSH подключение не настроено для узла"
					st.Logs = append(st.Logs, "Ошибка: SSH подключение отключено или не сконфигурировано")
					emitProgress(*st)
					mu.Unlock()
					continue
				}

				// Notify connecting
				mu.Lock()
				st := statusMap[srv.ID]
				st.Status = "connecting"
				st.Step = "Подключение..."
				emitProgress(*st)
				mu.Unlock()

				// Perform InstallAgent
				res, err := m.InstallAgent(ctx, srv.ID, opts.Options, sshMgr, secMgr)

				mu.Lock()
				st = statusMap[srv.ID]
				if err != nil {
					st.Status = "error"
					st.Step = "Сбой установки"
					st.Error = err.Error()
					if res != nil {
						st.Logs = append(st.Logs, res.Logs...)
					} else {
						st.Logs = append(st.Logs, err.Error())
					}
				} else {
					st.Status = "success"
					st.Step = "Успешно"
					st.AgentURL = res.AgentURL
					if res != nil {
						st.Logs = append(st.Logs, res.Logs...)
					}
				}
				emitProgress(*st)
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	result := &BatchInstallResult{
		Total:    len(targets),
		Statuses: make([]BatchHostStatus, 0, len(targets)),
	}

	for _, srv := range targets {
		st := statusMap[srv.ID]
		if st.Status == "success" {
			result.Success++
		} else if st.Status == "skipped" {
			result.Skipped++
		} else {
			result.Failed++
		}
		result.Statuses = append(result.Statuses, *st)
	}

	return result, nil
}
