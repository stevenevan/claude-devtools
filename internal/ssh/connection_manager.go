// Package ssh — connection_manager.go ports src-tauri/src/ssh/connection_manager.rs.
//
// Concurrency contract (arch H4):
//   - s.mu guards ONLY the in-memory conn pointer swap.
//   - s.mu is acquired, conn is read/swapped, then s.mu is released BEFORE any
//     network I/O (dial, auth, SFTP). Network calls are never made while holding
//     the mutex. This prevents the "mutex held across await" anti-pattern from
//     the original Rust tokio::sync::Mutex usage.
//
// The Dialer interface isolates network calls so tests inject a fake.
package ssh

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"github.com/pkg/sftp"
)

// Dialer is the network abstraction injected by callers (real or fake in tests).
// Dial opens a TCP connection to addr. In production: net.Dial("tcp", addr).
type Dialer interface {
	Dial(network, addr string) (net.Conn, error)
}

// NetDialer is the production Dialer.
type NetDialer struct{}

func (NetDialer) Dial(network, addr string) (net.Conn, error) {
	return net.DialTimeout(network, addr, 30*time.Second)
}

// Connection holds the live SSH+SFTP session.
type Connection struct {
	client             *gossh.Client
	sftp               *sftp.Client
	RemoteProjectsPath string
	remoteTodosPath    string
	host               string
}

// close tears down the SFTP client and the SSH client.
func (c *Connection) close() {
	if c.sftp != nil {
		_ = c.sftp.Close()
	}
	if c.client != nil {
		_ = c.client.Close()
	}
}

// State mirrors SshState — holds the current (optional) live Connection.
// The mutex only guards the conn pointer; it is never held across I/O.
type State struct {
	mu   sync.Mutex
	conn *Connection
}

// GetStatus mirrors SshState::get_status — snapshot under lock.
func (s *State) GetStatus() ConnectionStatus {
	s.mu.Lock()
	conn := s.conn
	s.mu.Unlock()

	if conn == nil {
		return Disconnected()
	}
	rp := conn.RemoteProjectsPath
	h := conn.host
	return ConnectionStatus{
		State:              "connected",
		Host:               &h,
		RemoteProjectsPath: &rp,
	}
}

// SetConn replaces the live connection under lock. Previous connection is
// closed after the lock is released (closing is I/O, so must happen outside).
func (s *State) SetConn(c *Connection) {
	s.mu.Lock()
	old := s.conn
	s.conn = c
	s.mu.Unlock()

	if old != nil {
		old.close()
	}
}

// ClearConn sets the connection to nil and closes the old one.
func (s *State) ClearConn() {
	s.SetConn(nil)
}

// Connect dials and authenticates; returns a live Connection.
// The dialer is injected so tests can supply a fake.
// NEVER called while holding s.mu.
func Connect(cfg *ConnectionConfig, dialer Dialer) (*Connection, error) {
	// Resolve SSH config overrides.
	entry := ResolveHost(cfg.Host)

	actualHost := cfg.Host
	if entry != nil && entry.HostName != nil {
		actualHost = *entry.HostName
	}

	actualPort := cfg.Port
	if actualPort == 22 && entry != nil && entry.Port != nil {
		actualPort = *entry.Port
	}

	username := cfg.Username
	if username == "" {
		if entry != nil && entry.User != nil {
			username = *entry.User
		} else {
			username = os.Getenv("USER")
			if username == "" {
				username = "root"
			}
		}
	}

	// Build known-hosts callback (security boundary — never InsecureIgnoreHostKey).
	khPath, err := DefaultKnownHostsPath()
	if err != nil {
		return nil, fmt.Errorf("known_hosts path: %w", err)
	}
	hostKeyCallback := HostKeyCallbackFromFile(khPath)

	// Build auth methods.
	authMethods, err := buildAuthMethods(cfg, entry)
	if err != nil {
		return nil, err
	}

	clientCfg := &gossh.ClientConfig{
		User:            username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         120 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", actualHost, actualPort)
	tcpConn, err := dialer.Dial("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("SSH connection failed: %w", err)
	}

	sshConn, chans, reqs, err := gossh.NewClientConn(tcpConn, addr, clientCfg)
	if err != nil {
		_ = tcpConn.Close()
		return nil, fmt.Errorf("SSH connection failed: %w", err)
	}
	client := gossh.NewClient(sshConn, chans, reqs)

	// Open SFTP subsystem.
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("failed to start SFTP session: %w", err)
	}

	// Resolve remote paths.
	remoteHome := resolveRemoteHome(client)
	remoteProjectsPath := findRemoteProjectsPath(sftpClient, username, remoteHome)
	remoteTodosPath := ""
	if remoteHome != "" {
		remoteTodosPath = remoteHome + "/.claude/todos"
	} else {
		remoteTodosPath = "/home/" + username + "/.claude/todos"
	}

	return &Connection{
		client:             client,
		sftp:               sftpClient,
		RemoteProjectsPath: remoteProjectsPath,
		remoteTodosPath:    remoteTodosPath,
		host:               cfg.Host,
	}, nil
}

// TestConnection mirrors test_connection — connect then immediately drop.
func TestConnection(cfg *ConnectionConfig, dialer Dialer) error {
	conn, err := Connect(cfg, dialer)
	if err != nil {
		return err
	}
	conn.close()
	return nil
}

// ConnectWithRetry mirrors connect_with_retry — exponential back-off on transient errors.
// onRetry is called before each sleep so the caller can emit status events.
// NEVER called while holding s.mu.
func ConnectWithRetry(
	cfg *ConnectionConfig,
	retryCfg RetryConfig,
	dialer Dialer,
	onRetry func(attempt, maxRetries uint32, errMsg string),
) (*Connection, error) {
	state := RetryState{}
	for {
		conn, err := Connect(cfg, dialer)
		if err == nil {
			return conn, nil
		}
		if !IsTransientError(err.Error()) || !state.CanRetry(retryCfg) {
			return nil, err
		}
		delay := state.NextDelay(retryCfg)
		state.Advance(err.Error())
		if onRetry != nil {
			onRetry(state.Attempt, retryCfg.MaxRetries, err.Error())
		}
		time.Sleep(delay)
	}
}

// buildAuthMethods constructs the []gossh.AuthMethod slice.
// Mirrors the authenticate() function in the Rust source.
func buildAuthMethods(cfg *ConnectionConfig, entry *ConfigHostEntry) ([]gossh.AuthMethod, error) {
	switch cfg.AuthMethod {
	case "password":
		if cfg.Password == nil {
			return nil, fmt.Errorf("password required")
		}
		return []gossh.AuthMethod{gossh.Password(*cfg.Password)}, nil

	case "privateKey":
		keyPath := "~/.ssh/id_rsa"
		if cfg.PrivateKeyPath != nil {
			keyPath = *cfg.PrivateKeyPath
		}
		signer, err := loadPrivateKey(expandTilde(keyPath))
		if err != nil {
			return nil, fmt.Errorf("cannot read private key at %s: %w", keyPath, err)
		}
		return []gossh.AuthMethod{gossh.PublicKeys(signer)}, nil

	case "agent":
		sock := DiscoverAgentSocket()
		if sock == "" {
			return nil, fmt.Errorf("SSH agent socket not found")
		}
		conn, err := net.Dial("unix", sock)
		if err != nil {
			return nil, fmt.Errorf("cannot connect to SSH agent: %w", err)
		}
		ag := agent.NewClient(conn)
		return []gossh.AuthMethod{gossh.PublicKeysCallback(ag.Signers)}, nil

	default:
		// "auto" — try config identity file, then agent, then default key files.
		var methods []gossh.AuthMethod

		if entry != nil && entry.HasIdentityFile {
			for _, name := range []string{"id_ed25519", "id_rsa", "id_ecdsa"} {
				home, _ := os.UserHomeDir()
				if signer, err := loadPrivateKey(filepath.Join(home, ".ssh", name)); err == nil {
					methods = append(methods, gossh.PublicKeys(signer))
				}
			}
		}

		if sock := DiscoverAgentSocket(); sock != "" {
			if conn, err := net.Dial("unix", sock); err == nil {
				ag := agent.NewClient(conn)
				methods = append(methods, gossh.PublicKeysCallback(ag.Signers))
			}
		}

		for _, name := range []string{"id_ed25519", "id_rsa", "id_ecdsa"} {
			home, _ := os.UserHomeDir()
			if signer, err := loadPrivateKey(filepath.Join(home, ".ssh", name)); err == nil {
				methods = append(methods, gossh.PublicKeys(signer))
			}
		}

		if len(methods) == 0 {
			return nil, fmt.Errorf("no authentication method succeeded")
		}
		return methods, nil
	}
}

// loadPrivateKey reads and parses a PEM private key file (no passphrase).
func loadPrivateKey(path string) (gossh.Signer, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return gossh.ParsePrivateKey(data)
}

// expandTilde replaces a leading ~ with the home directory.
func expandTilde(path string) string {
	if !strings.HasPrefix(path, "~") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return home + path[1:]
}

// resolveRemoteHome mirrors resolve_remote_home — runs `printf %s "$HOME"` via exec.
func resolveRemoteHome(client *gossh.Client) string {
	sess, err := client.NewSession()
	if err != nil {
		return ""
	}
	defer sess.Close()
	out, err := sess.Output(`printf %s "$HOME"`)
	if err != nil {
		return ""
	}
	trimmed := strings.TrimSpace(string(out))
	if strings.HasPrefix(trimmed, "/") {
		return trimmed
	}
	return ""
}

// findRemoteProjectsPath mirrors find_remote_projects_path — checks candidates via SFTP Stat.
func findRemoteProjectsPath(sftpClient *sftp.Client, username, remoteHome string) string {
	var candidates []string
	if remoteHome != "" {
		candidates = append(candidates, remoteHome+"/.claude/projects")
	}
	// Deduplicate via seen set (map iteration randomized — sort not needed here
	// since order matters for preference, not for correctness).
	seen := map[string]bool{}
	for _, c := range []string{
		"/home/" + username + "/.claude/projects",
		"/Users/" + username + "/.claude/projects",
		"/root/.claude/projects",
	} {
		if !seen[c] {
			seen[c] = true
			candidates = append(candidates, c)
		}
	}

	for _, c := range candidates {
		if _, err := sftpClient.Stat(c); err == nil {
			return c
		}
	}

	if remoteHome != "" {
		return remoteHome + "/.claude/projects"
	}
	return "/home/" + username + "/.claude/projects"
}
