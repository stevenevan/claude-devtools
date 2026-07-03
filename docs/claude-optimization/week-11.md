# Week 11 — Runtime-State GC

**Objective:** Garbage-collect the CLI's per-session runtime droppings: `tasks/` (UUID dirs
holding mostly empty `.lock`/`.highwatermark` markers), `jobs/`, `sessions/`, `session-env/`
(audit found a lone months-old file), and `shell-snapshots/`. Individually tiny, collectively
permanent clutter with no cleanup path anywhere.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`, dry-run dialog).

## Tickets

### W11-T1 — Runtime-state category specs
- One `CategorySpec` per dir family, all age-based on `ModTime` with a conservative default
  cutoff (7 days — runtime state older than a week belongs to long-dead sessions):
  - `tasks/<uuid>/` — whole dirs; flag empty-marker-only dirs separately (candidates even
    younger, at 2 days).
  - `jobs/` — entries EXCEPT `pins.json` (protected: user pin state, not runtime droppings).
  - `sessions/`, `session-env/`, `shell-snapshots/` — per-file candidates.
- Anything with today's `ModTime` is never a candidate regardless of matcher (live session
  protection).
- Verify: fixture tree with today's + old entries yields only old candidates; `pins.json`
  never listed.

### W11-T2 — GC panel
- Panel under `components/maintenance/`: per-family groups with live counts/bytes, combined
  dry-run preview (every path) → confirm → `TrashItems` (user/CLI state — trash policy, not
  plain delete: cheap insurance for wrong-guess matchers).
- Family explanations in-panel (what tasks/ markers are, why old ones are dead) — this data
  is opaque; the UI must not present bare UUIDs without context.
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

### W11-T3 — Recurring-policy hook
- Persist per-family cutoffs in `claude-devtools-config.json` (existing `internal/config`
  atomic writer) for week 31's retention engine; manual-run only this week.
- Verify: cutoffs survive restart.

## Exit criteria

- [ ] Candidates from live `ModTime` vs cutoffs; today's files never listed (test).
- [ ] `jobs/pins.json` protected in all cases (test).
- [ ] GC produces one `TrashReceipt`; restore recreates dirs/files at exact `OrigPath`
      (test).
- [ ] Re-run immediately after reports zero candidates (idempotence, live).
- [ ] Cutoffs persisted and reloaded.
- [ ] Dry-run preview mandatory; destructive actions dual-gated; hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — `.lock` files and highwatermarks coordinate live CLI
  background tasks; trashing a LIVE session's markers can wedge or duplicate its background
  work. The today-mtime hard exclusion plus 7-day default keeps candidates far from live
  state; trash-not-delete makes even a wrong guess reversible.
- **Semantics guessed, not documented** — these dirs are undocumented CLI internals; the
  matchers encode assumptions (old == dead) that a CLI update can invalidate. Conservative
  cutoffs, per-family toggles, and reversibility are the posture; never "clean" a family the
  scan can't classify.
- **pins.json lookalikes** — protecting one known file by name is brittle; if new
  non-droppings appear in these dirs, they'll be candidates. The dry-run preview showing
  every path is the human backstop.
