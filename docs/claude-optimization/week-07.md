# Week 7 — Binary Backup Dedupe

**Objective:** Clean up the hand-rolled binary backup sprawl: `status-line` plus THREE
distinct ~2.8 MB backup binaries (`status-line.bin.bak`, `status-line.pre-ponytail.bak`,
`status-line.sh.bak`) and `hooks/` (audit: 12 MB, versioned `.bak` duplicates like
`caveman-hooks.v1.6.0.bak`). Offer keep-active + rollback instead of manual file juggling.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`, dry-run dialog). Existing
context: `settings.json.statusLine` and `settings.json.hooks` reference the ACTIVE binaries
by path — read them to know what is live (read-only this week; hook/settings edits are
weeks 15–16).

## Tickets

### W7-T1 — Backup-binary category spec
- `CategorySpec` matching backup-suffixed siblings of active binaries: `*.bak`, `*.bin.bak`,
  `*.sh.bak`, `*.pre-*`, versioned `name.vX.Y.Z.bak` patterns, in the root and `hooks/`.
- For each candidate: size, `ModTime`, checksum, and an `active` cross-reference — a file is
  ACTIVE if `settings.json.statusLine` or any `settings.json.hooks` entry references its
  path. Active files are NEVER candidates.
- Distinct-content detection (audit found 3 different md5s for status-line): show whether a
  backup differs from the active binary — identical copies are pure waste; distinct ones are
  real rollback points.
- Verify: fixture with active + identical-bak + distinct-bak yields correct grouping and
  never lists the active file.

### W7-T2 — Dedupe panel with rollback
- Panel under `components/maintenance/`: per-binary group (active file + its backups, each
  with size/mtime/same-or-different badge); actions:
  - **Trash backups** — selected `.bak`s → dry-run preview → `TrashItems`.
  - **Rollback** — replace the active binary with a chosen backup: copy backup over active
    via temp+rename (atomic), after first trashing a copy of the current active as its own
    receipt (so rollback is itself reversible). File contents only — never edits
    `settings.json` paths.
- Preserve executable permission bits on rollback.
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Active binaries (referenced by live `settings.json`) never appear as trash candidates
      (test with fixture settings).
- [ ] Identical-content backups flagged as duplicates; distinct ones flagged as rollback
      points (checksum comparison, live).
- [ ] Trashing backups reclaims bytes (live `ScanClaudeDir` delta) and round-trips via
      `RestoreTrash` byte-identical (test).
- [ ] Rollback: active binary replaced atomically, previous active preserved in trash,
      executable bit intact, `settings.json` untouched (test).
- [ ] Dry-run preview mandatory before trash and before rollback.
- [ ] Destructive actions dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — the status-line binary runs on every prompt render and hook
  binaries run on every matched CLI event; trashing or corrupting the ACTIVE one breaks the
  CLI visibly on next launch. The `active` cross-reference is the hard gate: candidates are
  backups only, and rollback is atomic with an escape hatch.
- **Wrong-file identity** — path-based matching of "backup siblings" can false-positive on
  unrelated files ending in `.bak`. Checksums + explicit per-file listing in the dry-run
  preview (never a blind glob delete) keep the user in the loop.
- **Executable-bit loss** — a rollback that drops `+x` bricks the status line silently until
  next prompt. The permission-preserving copy is a test, not an assumption.
