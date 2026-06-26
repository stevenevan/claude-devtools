# Week 5 — Port Remaining Backend + CLI + Bind Everything (Wails v3)

**Objective:** All non-pipeline domains ported, every service method bound and
generating TS, the read-only CLI rebuilt in Go.

**Prerequisites:** Week 4 parity gate green.

## Tickets

### W5-T1 — `discovery/`
- `project_scanner`, `session_lister` (paginated + sorting), `path_decoder`
  (`/Users/x/p ↔ -Users-x-p`), `subagent_resolver`/`locator`, `ongoing_detector`,
  `subproject_registry` (state → struct + `sync.RWMutex`), `content_filter`.
- Verify: project/session listing + pagination match Rust; path decode round-trips.

### W5-T2 — `analytics/`
- `aggregate`, `duration`, `productivity`, `forecasting`, `session_scan` + the
  `analysis/commands` surface (tool analytics, heatmap, error hotspots/clusters, file_graph).
- Verify: analytics outputs diff-clean vs Rust on golden sessions.

### W5-T3 — `config/` (ConfigState, atomic persist)
- 45 `config_*` operations → methods on `ConfigService`. State behind `sync.Mutex`.
- **Atomic disk writes**: write temp file + `os.Rename` (don't truncate-in-place — a
  crash mid-write corrupts user config).
- `import/export annotations`: keep the JSON schema identical for cross-version portability.
- Verify: round-trip each mutation; confirm on-disk JSON matches Rust's shape.

### W5-T4 — `notifications/`
- `manager` (state), `trigger_matcher`, `error_detector`, `webhook` (HTTP via stdlib
  `net/http`), plus system toasts via `github.com/gen2brain/beeep` (replaces
  `tauri-plugin-notification`).
- Emit `notification:new|updated|clicked` via `application.Get().Event.Emit(...)`.
- Verify: trigger matching parity on fixture sessions; `webhook_test_send` posts correctly.

### W5-T5 — `ssh/` (async → goroutines + events)
```go
func (s *SshService) Connect(cfg SSHConfig) (SSHStatus, error) {
	app := application.Get()
	app.Event.Emit("ssh-status", SSHStatus{State: "connecting", Host: &cfg.Host})

	conn, err := connectWithRetry(s.ctx, cfg, func(attempt, max int, e error) {
		app.Event.Emit("ssh-status", SSHStatus{
			State: "retrying", RetryAttempt: &attempt, MaxRetries: &max, Error: ptr(e.Error()),
		})
	})
	if err != nil {
		st := SSHStatus{State: "error", Error: ptr(err.Error())}
		app.Event.Emit("ssh-status", st)
		return st, err
	}

	s.mu.Lock(); s.conn = conn; s.mu.Unlock()   // hold lock ONLY for the swap
	st := SSHStatus{State: "connected", RemoteProjectsPath: &conn.RemotePath}
	app.Event.Emit("ssh-status", st)
	return st, nil
}
```
- `golang.org/x/crypto/ssh` + `knownhosts` (replace `russh`/`russh-keys`); `pkg/sftp`
  (replace `russh-sftp`). Port `config_parser`, `retry`, `agent_discovery`, `known_hosts`.
- No `async` keyword — Wails runs each bound call off-thread; goroutine only for the
  retry callback if it must not block.
- Verify: connect/disconnect/test/state against a real host; `ssh-status` sequence
  matches Tauri (connecting → retrying* → connected/error).

### W5-T6 — `snapshots/`
- gzip via `compress/gzip` (replace `flate2`); `snapshots_create_from_session`/`open`/
  `list`/`delete`. Keep the on-disk snapshot format identical so existing snapshots open.
- Verify: create → open round-trips to the same `SessionDetail`.

### W5-T7 — `cmd/cli` (read-only CLI)
- `cmd/cli/main.go` importing `internal/` packages (Go multi-binary is just another
  `main` package — cleaner than Cargo `[[bin]]`).
- **Preserve the security guards** from `bin/cli.rs`: ID allowlist (ASCII alnum/dash/
  underscore/dot, max len), home canonicalization (ignore `CLAUDE_HOME`/`HOME` override),
  tail rate-limit (10 MB/s, 100k lines).
- Subcommands: `list-projects`, `list-sessions`, `show-session --format json|markdown`,
  `tail`, `stats`. The `--format json` path is what feeds the parity harness.
- Verify: `go run ./cmd/cli show-session … --format json` matches the W2 golden files.

### W5-T8 — Bind all services + regenerate
```bash
wails3 generate bindings -ts
```
- Confirm every command from the Phase-1 inventory has a corresponding bound method and
  a generated TS function under `frontend/bindings/`.

## Exit criteria
- [ ] All 119 commands have bound Go equivalents; full parity harness still green.
- [ ] SSH status events, notifications, snapshots, config persist verified.
- [ ] Go CLI reproduces golden JSON; security guards intact.

## Risks this week
- **Lock across SSH I/O** (guardrail) — the `s.mu` block wraps only the handle swap.
- **`tokio::Mutex` → `sync.Mutex`**: fine for goroutines, but never hold it across a
  network call. // ceiling: single global SSH connection → per-connection lock if multiplexed.
- **Config corruption**: non-atomic writes lose user data. Temp-file + rename only.
- **beeep has no tags**: pin via pseudo-version (`go get github.com/gen2brain/beeep@<commit>`).
- **CLI security regressions**: port the ID/path/rate guards verbatim — they're a trust boundary.
