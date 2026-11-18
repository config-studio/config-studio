package server

import (
	"io/fs"
	"net/http"
	"sync"
	"time"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	"config-studio/internal/fleet"
	appfs "config-studio/internal/fs"
	"config-studio/internal/hosts"
	"config-studio/internal/logs"
	"config-studio/internal/plugin"
	"config-studio/internal/sandbox"
	"config-studio/internal/secrets"
	"config-studio/internal/ssh"
)

type Config struct {
	AuthUser string
	AuthPass string
	WebFS    fs.FS
}

type Server struct {
	cfg          Config
	config       *config.Manager
	fs           *appfs.Service
	plugins      *plugin.Manager
	pluginRunner *plugin.Runner
	audit        *audit.Logger
	secrets      *secrets.Manager
	ssh          *ssh.ClientManager
	fleet        *fleet.Manager
	hosts        *hosts.Manager
	logs         *logs.StreamService
	sandbox      *sandbox.Service
	handler      http.Handler
	sessionsMu   sync.RWMutex
	sessions     map[string]time.Time
}

func NewServer(cfg Config, cfgMgr *config.Manager, fsSvc *appfs.Service, pMgr *plugin.Manager, pRunner *plugin.Runner, auditLogger *audit.Logger, secMgr *secrets.Manager, optFleet ...*fleet.Manager) *Server {
	var fleetMgr *fleet.Manager
	if len(optFleet) > 0 && optFleet[0] != nil {
		fleetMgr = optFleet[0]
	} else if cfgMgr != nil {
		fleetMgr, _ = fleet.NewManager(cfgMgr.DataDir())
	}

	var hostsMgr *hosts.Manager
	if cfgMgr != nil {
		hostsMgr, _ = hosts.NewManager(cfgMgr.DataDir(), secMgr)
	}

	if fleetMgr != nil && hostsMgr != nil {
		fleetMgr.SetHostResolver(func(ref string) (*fleet.HostInfo, error) {
			h, err := hostsMgr.Get(ref)
			if err != nil || h == nil {
				return nil, err
			}
			return &fleet.HostInfo{
				ID:          h.ID,
				Name:        h.Name,
				Host:        h.Host,
				Port:        h.NormalizedPort(),
				User:        h.User,
				IdentityID:  h.IdentityID,
				ProxyJump:   h.ProxyJump,
				Group:       h.Group,
				Tags:        h.Tags,
				Color:       h.Color,
				Icon:        h.Icon,
				Description: h.Description,
			}, nil
		})
	}

	s := &Server{
		cfg:          cfg,
		config:       cfgMgr,
		fs:           fsSvc,
		plugins:      pMgr,
		pluginRunner: pRunner,
		audit:        auditLogger,
		secrets:      secMgr,
		ssh:          ssh.NewClientManager(secMgr),
		fleet:        fleetMgr,
		hosts:        hostsMgr,
		logs:         logs.NewStreamService(),
		sessions:     make(map[string]time.Time),
	}
	s.sandbox = sandbox.NewService(
		sandbox.DefaultOptions(),
		s.fleet,
		s.hosts,
		s.ssh,
		&serverFSAdapter{server: s},
		s.secrets,
	)
	s.setupRoutes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}
