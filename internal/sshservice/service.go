// Package sshservice wires internal/ssh into the Wails service layer.
// The service owns the connection State and exposes the 8 frontend commands.
// Wails event emission is app-nil-guarded (mirrors notifyservice pattern).
// internal/ssh is pure — no Wails import there.
package sshservice

import (
	"context"
	"encoding/json"

	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/config"
	internalssh "claude-devtools/internal/ssh"
)

// SshService manages SSH/SFTP connections and emits ssh-status events.
type SshService struct {
	ctx    context.Context
	state  *internalssh.State
	config *config.ConfigState
}

func (s *SshService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx
	s.state = &internalssh.State{}
	s.config = &config.ConfigState{}
	return nil
}

func (s *SshService) ServiceShutdown() error {
	s.state.ClearConn()
	return nil
}

// GetState returns whether the service is live (always true after startup).
func (s *SshService) GetState() (string, error) {
	return s.state.GetStatus().State, nil
}

// ─── emit helper ─────────────────────────────────────────────────────────────

func emitSSHStatus(status internalssh.ConnectionStatus) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit("ssh-status", status)
}

// ─── 8 commands ──────────────────────────────────────────────────────────────

// SshGetConfigHosts mirrors ssh_get_config_hosts.
func (s *SshService) SshGetConfigHosts() ([]internalssh.ConfigHostEntry, error) {
	return internalssh.GetConfigHosts(), nil
}

// SshResolveHost mirrors ssh_resolve_host.
func (s *SshService) SshResolveHost(alias string) (*internalssh.ConfigHostEntry, error) {
	return internalssh.ResolveHost(alias), nil
}

// SshConnect mirrors ssh_connect.
// Sequence: emit connecting → (retry* →) emit connected or error.
func (s *SshService) SshConnect(cfg internalssh.ConnectionConfig) (internalssh.ConnectionStatus, error) {
	// Drop any live connection before dialling (matches Rust: guard.connection = None).
	s.state.ClearConn()

	emitSSHStatus(internalssh.ConnectionStatus{
		State: "connecting",
		Host:  &cfg.Host,
	})

	retryCfg := internalssh.DefaultRetryConfig()
	host := cfg.Host

	conn, err := internalssh.ConnectWithRetry(
		&cfg,
		retryCfg,
		internalssh.NetDialer{},
		func(attempt, maxRetries uint32, errMsg string) {
			emitSSHStatus(internalssh.ConnectionStatus{
				State:        "retrying",
				Host:         &host,
				Error:        &errMsg,
				RetryAttempt: &attempt,
				MaxRetries:   &maxRetries,
			})
		},
	)
	if err != nil {
		errMsg := err.Error()
		status := internalssh.ConnectionStatus{
			State: "error",
			Host:  &host,
			Error: &errMsg,
		}
		emitSSHStatus(status)
		return status, err
	}

	rp := conn.RemoteProjectsPath
	status := internalssh.ConnectionStatus{
		State:              "connected",
		Host:               &host,
		RemoteProjectsPath: &rp,
	}
	emitSSHStatus(status)

	// Swap the connection under mutex AFTER emitting (mutex not held during I/O).
	s.state.SetConn(conn)
	return status, nil
}

// SshDisconnect mirrors ssh_disconnect.
func (s *SshService) SshDisconnect() (internalssh.ConnectionStatus, error) {
	s.state.ClearConn()
	status := internalssh.Disconnected()
	emitSSHStatus(status)
	return status, nil
}

// SshGetState mirrors ssh_get_state.
func (s *SshService) SshGetState() (internalssh.ConnectionStatus, error) {
	return s.state.GetStatus(), nil
}

// SshTest mirrors ssh_test — connect and immediately drop.
func (s *SshService) SshTest(cfg internalssh.ConnectionConfig) (json.RawMessage, error) {
	err := internalssh.TestConnection(&cfg, internalssh.NetDialer{})
	if err != nil {
		msg := err.Error()
		b, _ := json.Marshal(map[string]interface{}{"success": false, "error": msg})
		return json.RawMessage(b), nil
	}
	b, _ := json.Marshal(map[string]interface{}{"success": true})
	return json.RawMessage(b), nil
}

// SshSaveLastConnection mirrors ssh_save_last_connection.
func (s *SshService) SshSaveLastConnection(lc internalssh.LastConnection) error {
	s.config.UpdateSSHLastConnection(&config.SshLastConnection{
		Host:           lc.Host,
		Port:           lc.Port,
		Username:       lc.Username,
		AuthMethod:     lc.AuthMethod,
		PrivateKeyPath: lc.PrivateKeyPath,
	})
	return nil
}

// SshGetLastConnection mirrors ssh_get_last_connection.
func (s *SshService) SshGetLastConnection() (*internalssh.LastConnection, error) {
	cfg := s.config.GetConfig()
	lc := cfg.SSH.LastConnection
	if lc == nil {
		return nil, nil
	}
	return &internalssh.LastConnection{
		Host:           lc.Host,
		Port:           lc.Port,
		Username:       lc.Username,
		AuthMethod:     lc.AuthMethod,
		PrivateKeyPath: lc.PrivateKeyPath,
	}, nil
}
