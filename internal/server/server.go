package server

import (
	"crypto/tls"
	"io/fs"
	"net"
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
	proxyClient  *http.Client
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

	proxyTransport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
	}
	s.proxyClient = &http.Client{
		Timeout:   30 * time.Second,
		Transport: proxyTransport,
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

func (s *Server) getProxyClient() *http.Client {
	if s != nil && s.proxyClient != nil {
		return s.proxyClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}
