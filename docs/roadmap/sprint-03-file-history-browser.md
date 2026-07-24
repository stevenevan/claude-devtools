# Sprint 03 — File-History Checkpoint Browser (read)

## 1. Goal
Browse the per-file version snapshots Claude Code keeps under
`~/.claude/file-history/{sessionUuid}/{fileHash}@vN` — session → file → versions — read-only.

## 2. Gap addressed
`file-history/` (gap matrix #9). Today `maintenance/FileHistoryCleanupPanel.tsx` +
`maintenance/cat_filehistory.rs::scan_file_history` only reclaim space. Verified on-disk layout:
each session UUID dir holds leaves named `{fileHash}@v1`, `{fileHash}@v2`, … and **each leaf is a
full snapshot of that file's content at that version** (confirmed: a leaf contained complete SQL).

## 3. Backend
- New `src-tauri/src/files/filehistory_reader.rs`:
  - `pub fn list_file_history(root: &str) -> Result<Vec<CheckpointGroup>, String>` — walk
    `file-history/{uuid}/`, group leaves by `{fileHash}`, order by `@vN`; return
    `CheckpointGroup { session_uuid, file_hash, versions: Vec<u32>, latest_mtime, latest_size }`.
  - `pub fn read_checkpoint(root: &str, session_uuid: &str, file_hash: &str, version: u32) -> Result<String, String>`
    — read one leaf's bytes (reuse `files::text_write::read_text_file`-style confined read; confine
    all three id parts, reject separators/`..`).
  - **This is new code.** `cat_filehistory.rs::scan_file_history` (top-level
    `src-tauri/src/maintenance/`, not `commands/maintenance/`) only computes per-UUID aggregate
    `subtree_stats` for cleanup bucketing — it never lists `{hash}@vN` leaves nor groups by hash.
    Reuse is limited to the UUID-dir discovery precedent.
- Wrappers in `src-tauri/src/commands/files.rs`; register in `main.rs` `generate_handler!`.

## 4. Frontend
- New `frontend/src/renderer/components/maintenance/FileHistoryBrowserPanel.tsx` (Maintenance tab,
  alongside `FileHistoryCleanupPanel.tsx`) — a three-level list: session UUID → file (by hash) →
  version. Selecting a version calls `read_checkpoint` and shows the snapshot content in a
  read-only code view (reuse the existing code-block renderer).
- API: `fileHistory` domain method; type `frontend/src/shared/types/api/fileHistory.ts`
  (`CheckpointGroup`).

## 5. Tasks (ordered)
1. Backend `list_file_history` (walk + group + version-order) → `cargo test filehistory_reader`.
2. Backend `read_checkpoint` (confined single-leaf read) → same test file.
3. Command wrappers + `main.rs` registration → `bun run test:rust`.
4. Shared type + API adapter → `bun run typecheck`.
5. `FileHistoryBrowserPanel.tsx` (session → file → version list + read-only content view).

## 6. Verification / acceptance
- `cargo test filehistory_reader` — grouping/version-ordering on a fixture dir with multiple
  `{hash}@vN`; `read_checkpoint` rejects a traversal id and returns exact leaf bytes.
- `bun run typecheck && bun run test && bun run qa` green.
- Manual: open the panel on the real dir; navigate session → file → versions; content displays.

## 7. Dependencies
None. Precursor to Sprint 04 (diff + export/restore).

## 8. Drift / risk notes
- `{fileHash}` is opaque (likely a hash **of the path**, not reversible) — Sprint 03 shows content
  keyed by hash and does **not** attempt to resolve the real path; that resolution is Sprint 04's
  gated concern.
- Snapshot storage format is version-specific — reader tolerant, `// confirm-at-impl`.
