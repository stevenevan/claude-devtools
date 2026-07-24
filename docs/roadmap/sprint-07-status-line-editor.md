# Sprint 07 — Status-Line Config Editor

## 1. Goal
A dedicated editor for the status-line configuration — the `statusLine` object in settings and,
when safely possible, the status-line script it points to — instead of editing raw `settings.json`.

## 2. Gap addressed
Status line (gap matrix #12). Today only binary rollback (`maintenance/rollback.rs` +
`BackupsCleanupPanel.tsx`) and raw settings reference exist. Verified real value:
`statusLine.command` = `{"type":"command","command":"/Users/…/.claude/status-line"}`.

## 3. Backend
- **Settings object (clean — lives under root):** read the `statusLine` object via
  `read_global_settings` and write it via `update_global_settings`
  (`src-tauri/src/files/settings_write.rs`). No new file I/O needed for the config itself.
- **Script editing has a safety caveat (metis):** two problems, both handled here —
  1. The top-level `status-line` file is **not on** `text_write.rs::INSTRUCTION_ALLOWLIST`
     (allowlist = CLAUDE.md, RTK.md, `rules/`, `commands/`, `tools/`), so `read_text_file` /
     `write_text_file` reject it as-is.
  2. `statusLine.command` is a **user-set absolute path** and is NOT guaranteed under `~/.claude`
     root — `resolve_instruction_path`'s whole model is root-confinement.
  - **v1 rule:** canonicalize the command path; **only if it resolves UNDER root**, add a
    `status-line` allowlist entry and allow in-app script editing through the confined helpers. **If
    it resolves outside root**, show the script read-only + an "open in external editor" action
    (reuse `config_open_in_editor`). Never write an arbitrary absolute path through the confined
    helpers.

## 4. Frontend
- New `frontend/src/renderer/components/settings/sections/claudeCode/StatusLinePanel.tsx` (a
  Claude-Code settings section, alongside `HooksPanel.tsx`) — a form (type / command / padding),
  a live preview, and a **conditional** script editor **reusing
  `frontend/src/renderer/components/maintenance/useFileBackedEditor.ts`** (rendered only when the
  path resolves under root; otherwise the read-only + external-open variant).
- API: reuse existing settings domain methods; add a `statusLineScript` read/write method only for
  the under-root case; type additions in `frontend/src/shared/types/api/`.

## 5. Tasks (ordered)
1. Backend: `statusLine` read/write via existing settings helpers → `cargo test` the round-trip.
2. Backend: path-canonicalization guard + conditional `status-line` allowlist entry + confined
   script read/write (under-root only) → `cargo test` the outside-root path is rejected/read-only.
3. Shared types + API adapter → `bun run typecheck`.
4. `StatusLinePanel.tsx` — form + preview + conditional script editor / external-open.

## 6. Verification / acceptance
- `cargo test` — `statusLine` object round-trips through settings; an outside-root script path is
  never written via confined helpers (rejected → read-only path taken).
- `bun run typecheck && bun run test && bun run qa` green (QA grep gate must still pass — no new
  unconfined home/write access).
- Manual: edit type/command/padding → persists to `settings.json`; under-root script edits save;
  an outside-root script shows read-only + external-open.

## 7. Dependencies
None.

## 8. Drift / risk notes
- The absolute-path confinement rule is a **security boundary**, not a convenience — do not relax
  it. `settings.json` is strict-validated by Claude Code; only write the `statusLine` key, nothing
  invented.
