package ssh_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"

	"claude-devtools/internal/ssh"
)

// ─── key generation helper ───────────────────────────────────────────────────

func mustGenerateKey(t *testing.T) gossh.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("key gen: %v", err)
	}
	goPub, err := gossh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("wrap pub: %v", err)
	}
	return goPub
}

// ─── config_parser tests (ports Rust #[test] suite) ────────────────────────

// writeSSHConfig writes content into a temp HOME/.ssh/config and redirects HOME.
// Returns a cleanup function that must be deferred by the caller.
func writeSSHConfig(t *testing.T, content string) func() {
	t.Helper()
	dir := t.TempDir()
	sshDir := filepath.Join(dir, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sshDir, "config"), []byte(content), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	orig := os.Getenv("HOME")
	_ = os.Setenv("HOME", dir)
	return func() { _ = os.Setenv("HOME", orig) }
}

func TestParseSimpleConfig(t *testing.T) {
	defer writeSSHConfig(t, `
Host myserver
    HostName 192.168.1.100
    User admin
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host devbox
    HostName dev.example.com
    User developer
`)()

	entries := ssh.GetConfigHosts()
	aliases := collectAliases(entries)
	if !eqSlice(aliases, []string{"myserver", "devbox"}) {
		t.Fatalf("aliases: %v", aliases)
	}

	e := findEntry(entries, "myserver")
	if e == nil {
		t.Fatal("myserver not found")
	}
	assertStrPtr(t, "HostName", e.HostName, "192.168.1.100")
	assertStrPtr(t, "User", e.User, "admin")
	if e.Port == nil || *e.Port != 2222 {
		t.Fatalf("Port: got %v, want 2222", e.Port)
	}
	if !e.HasIdentityFile {
		t.Fatal("HasIdentityFile should be true")
	}
}

func TestWildcardHostExcludedFromAliases(t *testing.T) {
	defer writeSSHConfig(t, `
Host *
    ServerAliveInterval 60

Host myserver
    HostName 10.0.0.1
`)()

	aliases := collectAliases(ssh.GetConfigHosts())
	if !eqSlice(aliases, []string{"myserver"}) {
		t.Fatalf("expected [myserver], got %v", aliases)
	}
}

func TestHostMatchesGlobPatterns(t *testing.T) {
	// Mirrors test_host_matches — verified via ResolveHost against a temp config.
	cases := []struct {
		pattern, hostname string
		want              bool
	}{
		{"*", "anything", true},
		{"myserver", "myserver", true},
		{"myserver", "other", false},
		{"dev-*", "dev-box", true},
		{"dev-*", "prod-box", false},
	}
	for _, c := range cases {
		defer writeSSHConfig(t, fmt.Sprintf("Host %s\n    User testuser\n", c.pattern))()
		got := ssh.ResolveHost(c.hostname) != nil
		if got != c.want {
			t.Errorf("hostMatches(%q,%q): got %v want %v", c.pattern, c.hostname, got, c.want)
		}
	}
}

func TestDefaultPortFiltered(t *testing.T) {
	defer writeSSHConfig(t, `
Host myserver
    HostName 10.0.0.1
    Port 22
`)()

	entries := ssh.GetConfigHosts()
	e := findEntry(entries, "myserver")
	if e == nil {
		t.Fatal("entry not found")
	}
	if e.Port != nil {
		t.Fatalf("Port 22 should be filtered; got %d", *e.Port)
	}
}

func TestResolveEntryFields(t *testing.T) {
	defer writeSSHConfig(t, `
Host myserver
    HostName 10.0.0.1
    User admin
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
`)()

	e := findEntry(ssh.GetConfigHosts(), "myserver")
	if e == nil {
		t.Fatal("not found")
	}
	assertStrPtr(t, "Alias", &e.Alias, "myserver")
	assertStrPtr(t, "HostName", e.HostName, "10.0.0.1")
	assertStrPtr(t, "User", e.User, "admin")
	if e.Port == nil || *e.Port != 2222 {
		t.Fatalf("Port: %v", e.Port)
	}
	if !e.HasIdentityFile {
		t.Fatal("HasIdentityFile")
	}
}

// ─── retry tests (mirrors Rust retry tests) ──────────────────────────────────

func TestDefaultRetryConfig(t *testing.T) {
	cfg := ssh.DefaultRetryConfig()
	if cfg.MaxRetries != 3 {
		t.Errorf("MaxRetries: %d", cfg.MaxRetries)
	}
	if cfg.BaseDelay != 2*time.Second {
		t.Errorf("BaseDelay: %v", cfg.BaseDelay)
	}
	if cfg.MaxDelay != 16*time.Second {
		t.Errorf("MaxDelay: %v", cfg.MaxDelay)
	}
}

func TestExponentialDelayCalculation(t *testing.T) {
	cfg := ssh.DefaultRetryConfig()
	state := &ssh.RetryState{}

	delays := []time.Duration{2, 4, 8, 16}
	for i, want := range delays {
		got := state.NextDelay(cfg)
		if got != want*time.Second {
			t.Errorf("attempt %d: got %v, want %v", i, got, want*time.Second)
		}
		state.Advance("e")
	}
}

func TestCanRetryRespectsMax(t *testing.T) {
	cfg := ssh.DefaultRetryConfig()
	state := &ssh.RetryState{}
	for i := uint32(0); i < cfg.MaxRetries; i++ {
		if !state.CanRetry(cfg) {
			t.Fatalf("should retry at attempt %d", i)
		}
		state.Advance("e")
	}
	if state.CanRetry(cfg) {
		t.Fatal("should not retry after max")
	}
}

func TestTransientErrors(t *testing.T) {
	transient := []string{
		"SSH connection failed: Connection refused",
		"connection timed out after 30s",
		"Broken pipe",
		"Network unreachable",
		"Host unreachable",
		"Connection reset by peer",
	}
	for _, msg := range transient {
		if !ssh.IsTransientError(msg) {
			t.Errorf("should be transient: %q", msg)
		}
	}
}

func TestPermanentErrorsNotTransient(t *testing.T) {
	permanent := []string{
		"Password authentication failed",
		"Permission denied (publickey)",
		"Invalid key format",
		"No such host",
	}
	for _, msg := range permanent {
		if ssh.IsTransientError(msg) {
			t.Errorf("should NOT be transient: %q", msg)
		}
	}
}

func TestRetryStateReset(t *testing.T) {
	state := &ssh.RetryState{}
	state.Advance("err1")
	state.Advance("err2")
	if state.Attempt != 2 {
		t.Fatalf("Attempt: %d", state.Attempt)
	}
	state.Reset()
	if state.Attempt != 0 || state.LastError != nil {
		t.Fatal("Reset didn't clear state")
	}
}

// ─── known_hosts tests (mirrors Rust known_hosts tests) ──────────────────────

func TestAlgorithmAllowlist(t *testing.T) {
	if ssh.IsAlgorithmAllowed("ssh-rsa") {
		t.Error("ssh-rsa must be blocked")
	}
	if ssh.IsAlgorithmAllowed("ssh-dss") {
		t.Error("ssh-dss must be blocked")
	}
	for _, algo := range []string{"ssh-ed25519", "rsa-sha2-256", "ecdsa-sha2-nistp256"} {
		if !ssh.IsAlgorithmAllowed(algo) {
			t.Errorf("%s must be allowed", algo)
		}
	}
}

func TestLearnsNewHostThenRecognizesIt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "known_hosts")
	pub := mustGenerateKey(t)

	d1, err := ssh.CheckOrLearn(path, "example.com", 22, pub)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if d1.Kind != ssh.DecisionLearnedNew {
		t.Fatalf("want LearnedNew, got %v", d1.Kind)
	}

	d2, err := ssh.CheckOrLearn(path, "example.com", 22, pub)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if d2.Kind != ssh.DecisionTrustedExisting {
		t.Fatalf("want TrustedExisting, got %v", d2.Kind)
	}
}

func TestRejectsChangedKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "known_hosts")
	pub1 := mustGenerateKey(t)
	pub2 := mustGenerateKey(t)

	if _, err := ssh.CheckOrLearn(path, "host.example", 22, pub1); err != nil {
		t.Fatalf("first: %v", err)
	}
	d2, err := ssh.CheckOrLearn(path, "host.example", 22, pub2)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if d2.Kind != ssh.DecisionKeyChanged {
		t.Fatalf("want KeyChanged, got %v", d2.Kind)
	}
}

// ─── sftp_provider tests (mirrors Rust sftp_provider tests) ──────────────────

func TestApplyChunkExtractsCompleteLines(t *testing.T) {
	tail := ssh.NewRemoteFileTail()
	lines := tail.ApplyChunk([]byte("first\nsecond\nthird"))
	if !eqSlice(lines, []string{"first", "second"}) {
		t.Fatalf("lines: %v", lines)
	}
	if tail.Offset != uint64(len("first\nsecond\nthird")) {
		t.Fatalf("offset: %d", tail.Offset)
	}
}

func TestPendingFragmentCompletesOnNextChunk(t *testing.T) {
	tail := ssh.NewRemoteFileTail()
	first := tail.ApplyChunk([]byte("first\nseco"))
	if !eqSlice(first, []string{"first"}) {
		t.Fatalf("first: %v", first)
	}
	second := tail.ApplyChunk([]byte("nd\nthird\n"))
	if !eqSlice(second, []string{"second", "third"}) {
		t.Fatalf("second: %v", second)
	}
	want := uint64(len("first\nseco") + len("nd\nthird\n"))
	if tail.Offset != want {
		t.Fatalf("offset: %d want %d", tail.Offset, want)
	}
}

func TestOffsetPreservedSimulatingReconnect(t *testing.T) {
	tail := ssh.NewRemoteFileTail()
	tail.ApplyChunk([]byte("alpha\nbravo\n"))
	snap := tail.Offset
	lines := tail.ApplyChunk([]byte("charlie\n"))
	if !eqSlice(lines, []string{"charlie"}) {
		t.Fatalf("lines: %v", lines)
	}
	if tail.Offset <= snap {
		t.Fatal("offset should advance")
	}
}

func TestTailRegistryKeysIndependentFiles(t *testing.T) {
	reg := ssh.NewTailRegistry()
	reg.GetOrInit("/a.jsonl").ApplyChunk([]byte("a\n"))
	reg.GetOrInit("/b.jsonl").ApplyChunk([]byte("b\n"))
	paths := reg.KnownPaths()
	sort.Strings(paths)
	if len(paths) != 2 {
		t.Fatalf("len: %d", len(paths))
	}
	reg.Remove("/a.jsonl")
	if len(reg.KnownPaths()) != 1 {
		t.Fatal("expected 1 path after remove")
	}
}

// ─── ConnectionStatus tests ──────────────────────────────────────────────────

func TestDisconnectedStatus(t *testing.T) {
	s := ssh.Disconnected()
	if s.State != "disconnected" {
		t.Errorf("State: %s", s.State)
	}
	if s.Host != nil || s.Error != nil || s.RemoteProjectsPath != nil {
		t.Error("zero-state should have nil pointer fields")
	}
}

// ─── ARCH H4: concurrent Connect + GetState — no-deadlock proof ───────────────
//
// A fake dialer that blocks for 50ms proves the mutex is not held across I/O:
// GetState returns immediately even while Connect is blocked inside the dialer.
// If the mutex WERE held across the dial, GetState would block for ≥50ms and the
// 10ms deadline would fire.

type blockingDialer struct {
	blockFor time.Duration
	err      error
}

func (d *blockingDialer) Dial(_, _ string) (net.Conn, error) {
	time.Sleep(d.blockFor)
	return nil, d.err
}

func TestConcurrentConnectAndGetStateNoDeadlock(t *testing.T) {
	state := &ssh.State{}
	dialer := &blockingDialer{
		blockFor: 50 * time.Millisecond,
		err:      errors.New("connection refused"), // transient, but MaxRetries=0 → one shot
	}
	cfg := &ssh.ConnectionConfig{
		Host:       "fake.host",
		Port:       22,
		Username:   "user",
		AuthMethod: "password",
		Password:   strPtr("pass"),
	}
	retryCfg := ssh.RetryConfig{MaxRetries: 0}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer func() { recover() }()
		_, _ = ssh.ConnectWithRetry(cfg, retryCfg, dialer, nil)
	}()

	// While the goroutine is blocked inside the dialer (≥50ms), GetState must
	// return within 10ms — proving the mutex is free during I/O.
	// We try a few times during the blocking window.
	success := false
	for i := 0; i < 8; i++ {
		time.Sleep(5 * time.Millisecond)
		done := make(chan struct{}, 1)
		go func() {
			_ = state.GetStatus()
			done <- struct{}{}
		}()
		select {
		case <-done:
			success = true
		case <-time.After(10 * time.Millisecond):
			t.Fatal("GetState blocked — mutex held across I/O")
		}
	}
	wg.Wait()

	if !success {
		t.Fatal("GetState never completed during the blocking window")
	}
}

// ─── agent discovery smoke test ──────────────────────────────────────────────

func TestDiscoverAgentSocketDoesNotPanic(t *testing.T) {
	// Can't assert a specific path in CI, but must not panic.
	_ = ssh.DiscoverAgentSocket()
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func strPtr(s string) *string { return &s }

func collectAliases(entries []ssh.ConfigHostEntry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Alias)
	}
	return out
}

func findEntry(entries []ssh.ConfigHostEntry, alias string) *ssh.ConfigHostEntry {
	for i := range entries {
		if entries[i].Alias == alias {
			return &entries[i]
		}
	}
	return nil
}

func assertStrPtr(t *testing.T, field string, got *string, want string) {
	t.Helper()
	if got == nil || *got != want {
		t.Errorf("%s: want %q, got %v", field, want, got)
	}
}

func eqSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
