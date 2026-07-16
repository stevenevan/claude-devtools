// Package ssh — agent_discovery.go.
// Discovers the SSH agent socket using env var, launchctl (macOS), or well-known paths.
package ssh

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// DiscoverAgentSocket mirrors discover_agent_socket.
// Returns the socket path, or "" if none found.
func DiscoverAgentSocket() string {
	// 1. SSH_AUTH_SOCK env var.
	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		if _, err := os.Stat(sock); err == nil {
			return sock
		}
	}

	// 2. macOS: launchctl knows the socket even when the app didn't inherit env.
	if runtime.GOOS == "darwin" {
		if sock := queryLaunchctl(); sock != "" {
			return sock
		}
	}

	// 3. Well-known paths.
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	candidates := []string{}
	if runtime.GOOS == "darwin" {
		candidates = append(candidates,
			filepath.Join(home, "Library", "Group Containers",
				"2BUA8C4S2C.com.1password", "agent.sock"),
		)
	}
	candidates = append(candidates,
		filepath.Join(home, ".1password", "agent.sock"),
		filepath.Join(home, ".ssh", "agent.sock"),
	)
	// Linux systemd/gnome-keyring paths.
	if runtime.GOOS == "linux" {
		uid := os.Getuid()
		candidates = append(candidates,
			// #nosec G204 — UID is from os.Getuid(), not user input.
			filepath.Join("/run/user", strconv.Itoa(uid), "ssh-agent.socket"),
			filepath.Join("/run/user", strconv.Itoa(uid), "keyring", "ssh"),
		)
	}

	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	return ""
}

// queryLaunchctl mirrors query_launchctl — macOS GUI app SSH_AUTH_SOCK fallback.
func queryLaunchctl() string {
	out, err := exec.Command("/bin/launchctl", "getenv", "SSH_AUTH_SOCK").Output()
	if err != nil {
		return ""
	}
	sock := strings.TrimSpace(string(out))
	if sock == "" {
		return ""
	}
	if _, err := os.Stat(sock); err == nil {
		return sock
	}
	return ""
}

