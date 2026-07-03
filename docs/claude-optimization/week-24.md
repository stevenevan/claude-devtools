# Week 24 — Config Snapshot / Export-Import

**Objective:** Whole-profile config backup and restore: capture the user-authored config
surface (settings, agents, skills, commands, rules, CLAUDE.md, memory — never caches or
session data) as restore points under `<appdata>/config-backups/`, exportable to a file and
importable with the program's strictest trust gate. **Import is the sharpest security cliff
in the roadmap: an imported profile contains hooks and permissions — arbitrary command
execution on the next CLI run.**

**Prerequisites:** weeks 15–16 (settings_write pattern, hooks toggle model), week 2
(receipt/manifest conventions). Namespace note: `<appdata>/config-backups/` — NOT
`snapshots/`, which `internal/snapshots/snapshots.go` already owns for the session-snapshot
feature; reusing that word/dir would collide.

## Tickets

### W24-T1 — Snapshot capture + restore
- Capture: copy the config allowlist (explicit file list, not a glob of `~/.claude`) into
  `<appdata>/config-backups/<id>/` with a JSON manifest (files, sizes, checksums, created
  time). Follow week-2 storage conventions (`0700`, source-relative paths).
- Restore: per-file or whole-profile, THROUGH the sanctioned writers — `settings.json` via
  `MutateSettingsJSON`, plain config files via temp+rename with `.bak`. Restore is
  file-replacement of user-authored text/config; it never touches caches, `projects/`, or
  `~/.claude.json`.
- Verify: capture → mutate live files → restore → byte-identical for plain files;
  settings.json restored through the mutator with `.bak`.

### W24-T2 — Export with secret protection
- Export = the snapshot dir packed to a single archive. **Secrets excluded by default**:
  `settings.json.env` values and credential-shaped keys are stripped (keys kept, values
  replaced with a placeholder marker) unless the user explicitly opts in via a loud
  "include secrets — this archive will contain your API keys" toggle.
- Manifest records whether secrets were included, so import can warn accordingly.
- Verify: default export contains zero credential values (test greps the archive);
  opt-in export flagged in manifest.

### W24-T3 — Import trust gate
- Import pipeline, fail-closed at every step:
  1. **Typed schema validation** — the archive must match the manifest schema and the
     per-file expected shapes; anything unknown/extra → reject, not skip.
  2. **Review screen** — enumerate EVERY hooks command string (full text, monospace) and
     EVERY permissions rule the profile would apply, each category requiring its own
     explicit confirmation. No single "import all" click.
  3. **Imported hooks land DISABLED** — written to the week-16 `hooksDisabled` key; arming
     each is a separate explicit week-16 toggle afterward. Never auto-enable imported
     hooks under any flow.
  4. Applied through the same sanctioned writers as restore; a pre-import snapshot is taken
     automatically so one click undoes the whole import.
- Dual gate: capture/restore/import `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Snapshot/restore round-trip byte-identical for plain files; settings via
      `MutateSettingsJSON` with `.bak` (tests).
- [ ] Default export contains no credential values (archive-grep test); opt-in path flagged
      in manifest and warned on import.
- [ ] Malformed/unknown-shaped archive rejected with zero disk writes (test).
- [ ] Import review screen lists every hook command + permission rule; per-category
      confirms required (UI test).
- [ ] Imported hooks arrive under `hooksDisabled`; nothing armed (test — the program's
      hardest invariant).
- [ ] Pre-import auto-snapshot exists; one-click undo restores pre-import state (test).
- [ ] All actions dual-gated; `go test ./internal/...`, `bunx tsc --noEmit`,
      `bun run test` green.

## Risks

- **Breaks the CLI itself — via imported config** — a malformed or hostile profile write
  can block CLI launch (bad settings.json) or, worse, arm commands that run on every CLI
  event. The four-step trust gate (schema fail-closed → enumerated review → hooks-disabled
  → auto-undo snapshot) is the control; skipping any step for UX smoothness is a security
  regression, not a simplification.
- **Secret exfiltration by export** — "share your config" flows leak API keys unless
  stripping is the default. Default-exclude with loud opt-in inverts the failure mode:
  forgetting the toggle produces a SAFE archive.
- **Restore-point sprawl** — config-backups accumulate like everything else in this
  program; the dir lives in appdata, visible to the week-1 scan, and week 31's retention
  covers it — stated here so this feature doesn't become next year's audit finding.
