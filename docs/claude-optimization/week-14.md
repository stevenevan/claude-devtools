# Week 14 — Maintenance Health Panel

**Objective:** One glance at the runtime health of the `~/.claude` install: last cleanup
time (`.last-cleanup`), last self-update outcome (`.last-update-result.json`), daemon
liveness (`daemon.log` tail), and active mode flags (`.caveman-active`, `.ponytail-active`).
Today these are hidden dotfiles nobody reads. Read-only week — no writes, no deletes.

**Prerequisites:** week 1 (maintenance view, `maintenanceservice`). Weeks 9's log surface
provides the daemon.log path conventions.

## Tickets

### W14-T1 — Health readers
- `internal/maintenance` readers (pure, no side effects):
  - `.last-cleanup` — timestamp text; render age ("cleaned 2 days ago").
  - `.last-update-result.json` — parse status/version/time; malformed → shown raw with a
    parse-error badge, never fatal.
  - `daemon.log` — last N lines (tail without reading the whole file), plus daemon liveness
    heuristic (mtime recency).
  - Flag files (`.caveman-active`, `.ponytail-active`, and any dotfile matching a small
    known-flag allowlist) — presence + content.
- All paths through the week-1 effective-root resolver.
- Verify: fixtures for each (missing, valid, malformed) render correct states.

### W14-T2 — Health panel UI
- Panel under `components/maintenance/`: status cards (last cleanup, last update, daemon,
  active flags) + daemon.log tail viewer (read-only, monospace, follows the existing
  code-block theme vars).
- Every card links to its acting surface: cleanup card → retention panels, update card →
  nothing (informational), daemon card → week-9 log panel.
- Read-only: the panel renders in browser/server mode too (nothing here writes), consistent
  with the program's read-only-weeks rule; it exposes zero mutating actions anywhere.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

### W14-T3 — Staleness nudges
- Non-intrusive banner when `.last-cleanup` is older than 30 days or absent: "storage has
  not been reviewed in a while" linking to the scan panel. No auto-anything — a nudge, not
  an action (scheduling is week 32).
- Verify: banner logic unit-tested against fixture timestamps.

## Exit criteria

- [ ] All four surfaces render live states; missing files show "never/absent" rather than
      errors (fixture tests).
- [ ] Malformed `.last-update-result.json` shows raw content + parse badge, no crash (test).
- [ ] daemon.log tail reads last N lines without loading the full file (test with a large
      fixture).
- [ ] Panel exposes zero write/delete actions (review gate); renders read-only in browser
      mode.
- [ ] Staleness banner fires per fixture matrix (fresh/old/missing).
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Scope creep into writes** — a health panel invites "fix it" buttons (restart daemon,
  clear flag files, run cleanup now). Every one of those belongs to another week (9, 31, 32)
  or to explicit non-goals; this week any mutation — including one that could break the CLI
  by clearing a live mode flag — is a review-rejectable diff. Links, not buttons.
- **Heuristic honesty** — daemon "liveness by mtime" is a guess, not a probe; label it
  ("last wrote 3m ago"), never a green/red verdict the data can't support.
- **Flag-file privacy** — dotfiles can be arbitrary; only the known-flag allowlist is shown,
  never a raw enumeration of every dotfile (avoids surfacing stray sensitive filenames).
