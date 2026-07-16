// Package ssh — known_hosts.go.
//
// Stores host fingerprints in ~/.claude/ssh/known_hosts (mode 0600 on Unix).
// On first contact: TOFU — the key is recorded. On subsequent connections the
// recorded key MUST match. A mismatch returns DecisionKeyChanged and the caller
// MUST refuse the connection.
//
// Uses golang.org/x/crypto/ssh/knownhosts for parsing existing OpenSSH-format
// entries and golang.org/x/crypto/ssh for PublicKey serialisation.
//
// SECURITY: this is a host-key verification boundary. Do NOT weaken it.
package ssh

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// allowedAlgorithms mirrors ALLOWED_HOST_KEY_ALGOS (blocks ssh-rsa SHA-1, DSS).
var allowedAlgorithms = map[string]bool{
	"ssh-ed25519":          true,
	"rsa-sha2-256":         true,
	"rsa-sha2-512":         true,
	"ecdsa-sha2-nistp256":  true,
	"ecdsa-sha2-nistp384":  true,
	"ecdsa-sha2-nistp521":  true,
}

// Decision mirrors the Rust Decision enum.
type Decision int

const (
	// DecisionTrustedExisting — key present and matches.
	DecisionTrustedExisting Decision = iota
	// DecisionLearnedNew — host unknown; entry written (TOFU).
	DecisionLearnedNew
	// DecisionKeyChanged — host recorded with a different key; REJECT.
	DecisionKeyChanged
	// DecisionAlgorithmRejected — algorithm not on the allowlist.
	DecisionAlgorithmRejected
)

// DecisionResult carries the Decision plus optional detail strings.
type DecisionResult struct {
	Kind                Decision
	FingerprintSHA256   string // LearnedNew
	RecordedFingerprint string // KeyChanged
	OfferedFingerprint  string // KeyChanged
	Algorithm           string // AlgorithmRejected
}

// IsAlgorithmAllowed mirrors is_algorithm_allowed.
func IsAlgorithmAllowed(algo string) bool {
	return allowedAlgorithms[algo]
}

// DefaultKnownHostsPath mirrors default_known_hosts_path.
func DefaultKnownHostsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "ssh", "known_hosts"), nil
}

// fingerprintSHA256 mirrors fingerprint_sha256 — returns "SHA256:<base64>" string.
func fingerprintSHA256(key gossh.PublicKey) string {
	h := sha256.Sum256(key.Marshal())
	return "SHA256:" + base64.StdEncoding.EncodeToString(h[:])
}

// canonicalHost mirrors canonical_host — wraps non-standard port in brackets.
func canonicalHost(host string, port uint16) string {
	if port == 22 {
		return host
	}
	return fmt.Sprintf("[%s]:%d", host, port)
}

// marshalAuthorizedKey serialises a public key in the authorized_keys format,
// returning only the base64 wire blob (not the "<algo> <b64>" prefix).
func marshalAuthorizedKey(key gossh.PublicKey) string {
	// gossh.MarshalAuthorizedKey returns "<algo> <b64> <comment>\n"
	full := strings.TrimSpace(string(gossh.MarshalAuthorizedKey(key)))
	parts := strings.Fields(full)
	if len(parts) >= 2 {
		return parts[1]
	}
	return base64.StdEncoding.EncodeToString(key.Marshal())
}

// ensureSecurePerms sets mode 0600 on Unix; no-op elsewhere.
func ensureSecurePerms(path string) error {
	return os.Chmod(path, 0o600)
}

// readRecordedEntries mirrors read_recorded_entries — returns "<algo> <b64>" for
// entries matching the given host:port.
func readRecordedEntries(path, host string, port uint16) ([]string, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	label := canonicalHost(host, port)
	var out []string
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		parts := strings.Fields(trimmed)
		if len(parts) < 3 {
			continue
		}
		hostPart, algo, b64 := parts[0], parts[1], parts[2]
		// hostPart can be comma-separated.
		for _, h := range strings.Split(hostPart, ",") {
			if h == label {
				out = append(out, algo+" "+b64)
				break
			}
		}
	}
	return out, nil
}

// appendEntry mirrors append_entry — appends one line and sets perms.
func appendEntry(path, hostLabel, algo, b64 string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, werr := fmt.Fprintf(f, "%s %s %s\n", hostLabel, algo, b64)
	cerr := f.Close()
	if werr != nil {
		return werr
	}
	if cerr != nil {
		return cerr
	}
	return ensureSecurePerms(path)
}

// CheckOrLearn mirrors check_or_learn — the primary security boundary.
// The caller receives a DecisionResult; it MUST refuse when Kind == DecisionKeyChanged.
func CheckOrLearn(path, host string, port uint16, key gossh.PublicKey) (DecisionResult, error) {
	algo := key.Type()
	if !IsAlgorithmAllowed(algo) {
		return DecisionResult{Kind: DecisionAlgorithmRejected, Algorithm: algo}, nil
	}

	offeredFP := fingerprintSHA256(key)
	offeredB64 := marshalAuthorizedKey(key)

	recorded, err := readRecordedEntries(path, host, port)
	if err != nil {
		return DecisionResult{}, fmt.Errorf("known_hosts read failed: %w", err)
	}

	for _, entry := range recorded {
		parts := strings.Fields(entry)
		if len(parts) < 2 {
			continue
		}
		recAlgo, recB64 := parts[0], parts[1]
		if recAlgo == algo && recB64 == offeredB64 {
			return DecisionResult{Kind: DecisionTrustedExisting}, nil
		}
		if recAlgo == algo {
			// Same algorithm, different key — MITM risk.
			truncated := recB64
			if len(truncated) > 20 {
				truncated = truncated[:20]
			}
			return DecisionResult{
				Kind:                DecisionKeyChanged,
				RecordedFingerprint: recAlgo + ":" + truncated,
				OfferedFingerprint:  offeredFP,
			}, nil
		}
	}

	// TOFU — record it.
	label := canonicalHost(host, port)
	if err := appendEntry(path, label, algo, offeredB64); err != nil {
		return DecisionResult{}, fmt.Errorf("known_hosts write failed: %w", err)
	}
	return DecisionResult{Kind: DecisionLearnedNew, FingerprintSHA256: offeredFP}, nil
}

// HostKeyCallbackFromFile returns an ssh.HostKeyCallback that uses our managed
// known_hosts file (TOFU + reject-on-change). The callback MUST be used in
// production ssh.ClientConfig — never InsecureIgnoreHostKey.
func HostKeyCallbackFromFile(path string) gossh.HostKeyCallback {
	return func(hostname string, _ net.Addr, key gossh.PublicKey) error {
		// Parse host:port from hostname (format Go passes as "host:port").
		host, port := splitHostPort(hostname)
		result, err := CheckOrLearn(path, host, port, key)
		if err != nil {
			return err
		}
		switch result.Kind {
		case DecisionAlgorithmRejected:
			return fmt.Errorf("SSH host key algorithm %q is not on the allowlist", result.Algorithm)
		case DecisionKeyChanged:
			return fmt.Errorf(
				"SSH host key changed for %s — possible MITM. "+
					"recorded=%s offered=%s. "+
					"Edit ~/.claude/ssh/known_hosts manually to recover.",
				hostname, result.RecordedFingerprint, result.OfferedFingerprint,
			)
		}
		return nil // TrustedExisting or LearnedNew
	}
}

// splitHostPort splits "host:port" from the address Go passes to HostKeyCallback.
// Falls back gracefully if the address doesn't contain a port.
func splitHostPort(addr string) (string, uint16) {
	// Use knownhosts.Normalize which already handles "[host]:port" notation.
	normalized := knownhosts.Normalize(addr)
	// normalized is always "host:port" or "[host]:port"
	if strings.HasPrefix(normalized, "[") {
		// IPv6 or non-standard port: "[host]:port"
		closeBracket := strings.LastIndex(normalized, "]")
		if closeBracket < 0 {
			return addr, 22
		}
		host := normalized[1:closeBracket]
		portStr := ""
		if closeBracket+2 < len(normalized) {
			portStr = normalized[closeBracket+2:]
		}
		return host, parsePort(portStr)
	}
	// Standard "host:port"
	lastColon := strings.LastIndex(normalized, ":")
	if lastColon < 0 {
		return normalized, 22
	}
	return normalized[:lastColon], parsePort(normalized[lastColon+1:])
}

func parsePort(s string) uint16 {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 22
		}
		n = n*10 + int(c-'0')
	}
	if n == 0 || n > 65535 {
		return 22
	}
	return uint16(n)
}
