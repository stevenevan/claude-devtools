# Sprint 02 — Subagent Transcripts Viewer

## 1. Goal
Browse and read the subagent/background-run transcripts under `~/.claude/transcripts/ses_*.jsonl`,
rendered with the same chat UI used for project sessions.

## 2. Gap addressed
`transcripts/` (gap matrix #8). Today `maintenance/TranscriptsCleanupPanel.tsx` +
`cat_transcripts.rs::scan_transcripts` only measure/delete them. There is no content viewer. On the
dev machine this is **2215** `ses_*.jsonl` files (~1.2 GB) — the list must be lazy; a transcript
body is parsed only when selected.

## 3. Backend
- New `src-tauri/src/files/transcripts_reader.rs`:
  - `pub fn list_transcripts(root: &str) -> Result<Vec<TranscriptMeta>, String>` — scan
    `transcripts/ses_*.jsonl` (dir-walk style from `files/skills_inventory.rs`); return
    `TranscriptMeta { id, size_bytes, mtime, first_message }` without reading full bodies.
  - `pub fn read_transcript(root: &str, id: &str) -> Result<ParsedSession, String>` — **reuse
    `parse_session_file`** (`src-tauri/src/parsing/session_parser/mod.rs:85`) on the resolved
    `ses_*.jsonl` path. Confine `id` to `transcripts/` (reject path separators / `..`).
- Wrappers `list_transcripts` / `read_transcript` in `src-tauri/src/commands/files.rs`; register in
  `main.rs` `generate_handler!`.

## 4. Frontend
- New `frontend/src/renderer/components/dashboard/TranscriptsViewer.tsx` — ActivityBar view
  `activity="transcripts"` (list + detail). **List is virtualized** (reuse
  `ChatHistoryVirtualizer.tsx`); metadata loads via `list_transcripts`; selecting one calls
  `read_transcript` and renders it through the existing chat renderer / display-item builder
  (`DisplayItemList.tsx`), the same path project sessions use.
- API: `transcripts` domain in `frontend/src/renderer/api/tauri/domain/files.ts` (or new
  `transcripts.ts`); type `frontend/src/shared/types/api/transcripts.ts` (`TranscriptMeta`).

## 5. Tasks (ordered)
1. **Premise gate (Assumption 1):** `cargo test` a fixture calling `parse_session_file` on one real
   `ses_*.jsonl`; confirm it yields non-empty messages. If the schema diverges, add a thin adapter
   in `transcripts_reader.rs` rather than a whole new parser — stop and report if divergence is deep.
2. Backend `list_transcripts` + `read_transcript` → `cargo test transcripts_reader`.
3. Command wrappers + `main.rs` registration → `bun run test:rust`.
4. Shared types + API adapter → `bun run typecheck`.
5. `TranscriptsViewer.tsx` (virtualized list + detail reusing the chat renderer) + `activity` wiring.

## 6. Verification / acceptance
- Gate test (task 1) green — proves parser reuse.
- `cargo test transcripts_reader` — `list_transcripts` returns metadata for a fixture dir without
  reading bodies; `read_transcript` rejects a traversal `id`.
- `bun run typecheck && bun run test && bun run qa` green.
- Manual: open Transcripts; the ~2200-file list scrolls smoothly; selecting one renders messages;
  no eager full-dir read (watch that switching the view is instant).

## 7. Dependencies
None. (Gated by Assumption 1 — resolve at task 1.)

## 8. Drift / risk notes
- **Assumption 1 (unverified):** transcript↔session parser compatibility. Resolved by the task-1
  gate before any UI work. Fallback: thin adapter, not a new parser.
- This sprint **owns** transcript-list virtualization; Sprint 12 only regression-checks it.
