# Sprint 11 — Slash-Command Frontmatter Editor

## 1. Goal
Give global slash-command files (`~/.claude/commands/*.md`) a structured, frontmatter-aware editor
instead of the generic text editor they get today.

## 2. Gap addressed
Slash commands (gap matrix #3) — FULLY browsable/editable via the Instructions `commands` bucket
(`InstructionFileTree.tsx` + `InstructionsPanel.tsx`), but only as **generic markdown/text**
(`InstructionFileEditor.tsx` has no frontmatter awareness). This is a "deepen shallow" sprint.

## 3. Backend / parse-side (decide at sprint start — Assumption 3)
- No YAML/TOML crate is in `src-tauri/Cargo.toml`. **Decide parse-side first:** either parse YAML
  frontmatter **client-side in TS** (a tiny frontmatter split + a small YAML parse already viable in
  the renderer) — preferred, no new Rust dep — or add a Rust dep (triggers `cargo audit` per the
  security rules). Writes still go through the existing `commands`-bucket allowlist in
  `src-tauri/src/files/text_write.rs` (`INSTRUCTION_ALLOWLIST` `commands` entry is a `DirPrefix`,
  extension-agnostic, so `.md` qualifies — verified). No new write command needed.

## 4. Frontend
- Extend `frontend/src/renderer/components/maintenance/InstructionFileEditor.tsx` (used by the
  `commands` bucket): when the file has YAML frontmatter, render **structured fields + a raw
  toggle**; on save, re-serialize frontmatter + body.
- **Field vocabulary (finalize at sprint start):** reference `.md` command files (found under
  `~/.claude/plugins/cache/.../commands/*.md`, and per Claude Code docs) use `description`,
  `argument-hint`, `allowed-tools`, `disable-model-invocation`, **plus `model` and
  `hide-from-slash-command-tool`**. Enumerate the full set; **any unknown key is preserved via the
  raw round-trip, never dropped**.

## 5. Tasks (ordered)
1. **Gate (Assumption 3):** decide parse-side (TS vs Rust dep) + finalize the field list. Record
   both here.
2. **Fixture:** the global `~/.claude/commands/` bucket is EMPTY of `.md` on the dev machine (only
   `caveman-init.toml`) — author a local `commands/*.md` fixture with frontmatter to develop/test
   against; do not assume a real in-scope file exists.
3. Frontmatter parse + structured-field editing in `InstructionFileEditor.tsx` with raw toggle and
   unknown-key preservation → `bun run typecheck && bun run test`.

## 6. Verification / acceptance
- `bun run typecheck && bun run test && bun run qa` green.
- Test (renderer): a `commands/*.md` with all known keys **plus** an unknown key round-trips through
  structured→raw→save without dropping the unknown key.
- Manual: open a `commands/*.md`; edit `description`/`argument-hint`; save; frontmatter + body
  re-serialize correctly.

## 7. Dependencies
None. **Scope non-goal:** v1 covers the GLOBAL `~/.claude/commands/` bucket only (what the
`text_write.rs` allowlist confines); **project-level `.claude/commands/*.md` is out of scope** (no
project-path handling in that file).

## 8. Drift / risk notes
- **Assumption 3 (unverified):** parse-side + parser choice + final field list — all resolved at
  task 1. Unknown-key preservation is the safety net against an incomplete field list.
- This is the lowest-data sprint (empty global bucket here) — the fixture in task 2 is required, not
  optional.
