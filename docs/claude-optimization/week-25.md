# Week 25 — Instruction-File Editors

**Objective:** In-app editing for the small user-authored text files that steer every
session: global `CLAUDE.md`, `RTK.md`, `rules/*.md`, `commands/*.toml`, and `tools/`
scripts (audit: one TOML + one JS — same small-text-editor shape, merged here rather than
padding a week of their own). With size warnings: these files are injected into context, so
bytes are tokens.

**Prerequisites:** week 15 (`useFileBackedEditor`, `<ConfigEditorShell>`). Existing readers:
- `internal/files/pathutil.go:150-172` — `ReadClaudeMdFiles` (global + project CLAUDE.md,
  rules)

## Tickets

### W25-T1 — Text-file write path
- Generic small-text writer in `internal/files`: read-fresh, `.bak`, temp+rename (the
  settings_write pattern's mechanics applied to plain text; per-path mutex map). Allowlist
  of editable roots: `CLAUDE.md`, `RTK.md`, `rules/`, `commands/`, `tools/` under the
  effective root — the writer rejects paths outside it (`Confine()`).
- No format transformation ever: bytes in, bytes out, trailing newline preserved.
- Verify: `go test ./internal/files/...` — round-trip byte-identity, `.bak`, out-of-
  allowlist rejection.

### W25-T2 — Editor panel
- Panel on `<ConfigEditorShell>`: file tree of the allowlist (existing files + "create
  rules file" for `rules/`), plain-text editor (monospace, markdown preview toggle for
  `.md` — read-only preview, no WYSIWYG), dirty state + save via `useFileBackedEditor`.
- **Context-cost meter**: live byte/approx-token count per file with a warning threshold
  (CLAUDE.md is injected into EVERY session; the audit's 2.3 KB global file costs tokens on
  every prompt). Total instruction-payload rollup across the allowlist.
- Delete (rules/commands/tools files only, never CLAUDE.md/RTK.md) routes through
  `TrashItems` — user-authored content, trash policy.
- Dual gate: writes `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Round-trip edit of each file kind is byte-faithful outside the edited range; `.bak`
      created (tests).
- [ ] Out-of-allowlist path rejected by the writer (test).
- [ ] Context-cost meter shows live sizes; warning fires above threshold (test with a
      fixture crossing it).
- [ ] Deleting a rules file lands in trash and restores cleanly (test); CLAUDE.md/RTK.md
      expose no delete affordance (review gate).
- [ ] Fresh `claude` session picks up an edited CLAUDE.md rule (manual sanity).
- [ ] Writes dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — a corrupted `commands/*.toml` can break slash-command loading,
  and a mangled CLAUDE.md silently rewrites the user's standing instructions for every
  future session (worse than a crash: wrong behavior with no error). Byte-faithful writes,
  `.bak`, and the no-transformation rule are the containment.
- **Editor "helpfulness"** — auto-formatting, whitespace normalization, or markdown
  "fixing" would corrupt files whose exact bytes matter. The editor is a dumb pipe with a
  preview, enforced in tests by byte-identity.
- **Token-cost blindness** — without the meter, an in-app editor makes it EASIER to bloat
  context-injected files; the meter and rollup turn the hidden cost visible, which is half
  this week's value.
