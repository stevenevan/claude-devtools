# Week 6 — file-history Retention

**Objective:** Put a retention policy on `file-history/` (audit: 44 MB, ~3,000 versioned
`@vN` snapshots across 156 UUID dirs) — the CLI's edit-undo store that grows unbounded and
has no UI anywhere.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`, dry-run dialog).

## Tickets

### W6-T1 — file-history category spec
- `CategorySpec` for `file-history/`: per-UUID-dir entries (bytes, snapshot count, newest
  `ModTime`); candidates = dirs whose newest snapshot is older than the cutoff (default
  30 days — undo history for edits that old is dead weight).
- Secondary matcher: empty or single-marker dirs (audit found many near-empty UUID dirs).
- Where cheaply derivable, map a UUID dir to the session/project that produced it so the UI
  can show context; when not derivable, show the UUID raw — never guess.
- Verify: fixture tree yields correct cutoff filtering + empty-dir candidates.

### W6-T2 — Retention panel
- Panel under `components/maintenance/`: cutoff selector, candidate table (dir, snapshots,
  bytes, last used, linked session when known); dry-run preview → confirm → `TrashItems`.
- Explain what the data IS in-panel: "edit undo snapshots used by the CLI's file-history;
  removing old entries only removes the ability to restore those old file versions."
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

### W6-T3 — Recurring-policy hook
- Persist the chosen cutoff in `claude-devtools-config.json` via the existing
  `internal/config` manager (app-owned file, atomic write already implemented) so week 31's
  retention engine can execute it; this week the policy runs manually only.
- Verify: cutoff survives app restart.

## Exit criteria

- [ ] Candidates derived from live `ModTime` vs cutoff; totals match `ScanClaudeDir`'s
      `file-history/` entry (live comparison, no frozen counts).
- [ ] Empty/near-empty UUID dirs surface as a separate one-click candidate group.
- [ ] Prune moves candidates under one `TrashReceipt`; restore round-trips a sample dir
      byte-identical (test).
- [ ] Cutoff persisted in `claude-devtools-config.json` and re-loaded on restart.
- [ ] Dry-run preview mandatory before any prune.
- [ ] Destructive actions dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — the CLI reads `file-history/` to power edit-undo/checkpoint
  restore; pruning a dir tied to an ACTIVE session removes its undo chain mid-flight.
  Mitigate: age cutoff excludes anything recent; never offer dirs with today's mtime.
- **Silent value loss** — unlike caches, this data is not regenerable: once trashed and
  expired, those file versions are gone. The in-panel explanation and trash-first (not
  permanent-first) default protect against surprise.
- **UUID opacity** — deleting by inscrutable UUID invites mistakes; the session/project
  mapping (when derivable) plus size/age context is the guard. Never present a bare UUID
  list as the only signal.
