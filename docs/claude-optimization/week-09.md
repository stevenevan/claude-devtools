# Week 9 — Log Rotation

**Objective:** Put size caps and clear buttons on the app-and-CLI log surfaces: `logs/`
(devtools JSONL logs) and `daemon.log`. Regenerable diagnostics — this week uses the
**plain-delete policy** (confirm dialog, no trash), per the program's deletion policy.

**Prerequisites:** week 1 (`ScanCategory`, maintenance view). Week 2's trash engine is NOT
used here — logs are regenerable, app/daemon-owned diagnostics; plain delete is the
sanctioned path. Existing context: `internal/systemservice` `LogRendererEvent` writes the
devtools logs.

## Tickets

### W9-T1 — Log category spec
- `CategorySpec` for log files: `logs/*.jsonl`, `daemon.log` (+ rotated siblings
  `daemon.log.1…` if present), each with bytes, `ModTime`, and line count where cheap.
- Classification: app-owned (devtools logs — safe to truncate any time the app chooses) vs
  CLI/daemon-owned (`daemon.log` — safe to clear, but the daemon may hold the file handle;
  see risks).
- Verify: fixture logs dir yields correct classification + sizes.

### W9-T2 — Rotation + clear UI
- Panel under `components/maintenance/`: log table (file, size, last write), per-file
  **Clear** (plain delete/truncate with confirm dialog — explicitly NOT the trash path) and
  **Clear all app logs**.
- Rotation policy for the app's OWN logs: size cap (default 10 MB) enforced at write time in
  the Go logging path — rotate to a single `.1` sibling, drop older. The app stops being a
  log-bloat producer itself.
- `daemon.log`: clear via truncate (`os.Truncate`), not unlink — a daemon holding the fd
  keeps writing to an unlinked inode and the space never frees.
- Dual gate: clear actions `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

### W9-T3 — Cap persistence
- Persist the size cap in `claude-devtools-config.json` via `internal/config` (existing
  atomic writer); week 31's retention engine picks it up later.
- Verify: cap survives restart; write-time rotation triggers at the configured size (test
  with a tiny cap).

## Exit criteria

- [ ] Log table shows live sizes from `ScanCategory` (no frozen numbers).
- [ ] Clear uses plain delete/truncate with a confirm dialog; nothing appears in
      `ListTrash` afterward (explicit plain-delete policy assertion).
- [ ] `daemon.log` cleared by truncate; file handle stays valid (write after clear appends
      to the same inode — test).
- [ ] App-log rotation triggers at the cap and keeps exactly one `.1` sibling (test).
- [ ] Cap persisted and reloaded from `claude-devtools-config.json`.
- [ ] Clear actions dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — clearing `daemon.log` by unlink while the daemon holds the fd
  wastes the space until daemon restart and can confuse crash diagnostics right when they're
  needed. Truncate-in-place is the rule; and never touch log files outside the matched set
  (a `*.log` glob could catch something load-bearing).
- **Diagnostic loss** — logs are the first thing needed when something breaks; a
  too-aggressive default cap destroys evidence. 10 MB default + confirm-before-clear keeps
  this user-intentional.
- **Policy confusion** — this is the first plain-delete week after two trash weeks; the UI
  copy must say "deleted immediately, not moved to trash" so the week-2 mental model isn't
  silently violated.
