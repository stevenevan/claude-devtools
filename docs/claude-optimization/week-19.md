# Week 19 — Permissions Consolidation Editor

**Objective:** One UI over every permission list: global `settings.json`
`permissions.allow/deny/ask` (already editable via the existing settings editor) PLUS
project `.claude/settings.local.json` grants — merged view with the ability to move rules
between files. The audit found grants scattered across files users forgot existed.

**Prerequisites:** week 15 (`MutateSettingsJSON`, editor kit), week 18 (source discovery +
merged provenance — this week adds the write half). Existing code:
- `internal/files/settings_write.go` — the existing settings editor's typed
  env/permissions patch (this week extends that surface, not replaces it)

## Tickets

### W19-T1 — Multi-file permission writes
- Global file: rule add/remove/move through `MutateSettingsJSON` (settings_write pattern,
  the single `settingsWriteMu`).
- Project `settings.local.json`: a per-file mutator with the SAME mechanics (read-fresh,
  `.bak`, temp+rename) but its OWN per-file mutex — never share `settingsWriteMu` across
  files (per-file locking rule). Only `permissions.allow/deny/ask` keys are touched;
  everything else preserved at every level.
- **Move rule** = add-to-target THEN remove-from-source, two atomic writes with the add
  first — a crash between them leaves a harmless duplicate, never a lost rule.
- Verify: `go test ./internal/files/...` — move round-trips; crash-between-writes fixture
  leaves the rule present in at least one file; unknown keys preserved.

### W19-T2 — Consolidation panel
- Panel on `<ConfigEditorShell>`: merged rule table (rule, list, source file chip), add/
  remove per list, drag-or-picker move between files, filter by allow/deny/ask.
- Rule strings are opaque to the app (no validation of `Bash(rm:*)` semantics — the CLI
  owns that grammar); the editor only guarantees faithful placement. A syntax cheat-sheet
  link is fine; a validator is out of scope.
- Reserved slot: a suggestions drawer fed by week 30's analyzer (display-only; per-rule
  explicit approval writes through THIS week's paths). Ship the drawer empty behind the
  analyzer's absence.
- Dual gate: all writes `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Merged table shows every rule with correct source provenance (fixture with rules in
      3 files).
- [ ] Add/remove/move round-trip on both file kinds; unrelated keys byte-preserved (tests).
- [ ] Move is add-then-remove; interrupted move never loses a rule (test).
- [ ] `settings.local.json` writes use their own mutex + `.bak` (review gate + test).
- [ ] Fresh `claude` session honors a rule added in-app (manual sanity: deny rule blocks
      the matching action).
- [ ] Writes dual-gated; tab `electronOnly: true`.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — permissions gate what the CLI may execute; a corrupted
  permissions block can fail CLI startup, and a mangled `deny` list silently REMOVES a
  safety rail the user relied on. Atomic writes + `.bak` + typed key-scoped patches bound
  corruption; the add-before-remove move ordering guarantees no rule ever vanishes.
- **Cross-file lost updates** — two files, two locks; a shared-mutex shortcut or a
  read-stale write reintroduces the lost-update bug the settings_write pattern exists to
  kill. Per-file mutex + read-fresh is the review gate.
- **Semantic overreach** — validating or "correcting" rule strings the app doesn't fully
  understand could rewrite a rule's meaning. The app is a faithful courier of opaque
  strings, nothing more.
