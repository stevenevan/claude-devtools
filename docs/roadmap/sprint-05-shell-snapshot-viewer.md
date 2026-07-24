# Sprint 05 — Shell-Snapshot Viewer

## 1. Goal
Read and display the shell environment snapshots under `~/.claude/shell-snapshots/*.sh` (the shell
state Claude Code captures per run), read-only.

## 2. Gap addressed
`shell-snapshots/` (gap matrix #10). Today only `cat_runtime.rs::scan_runtime_shell_snapshots`
(category `runtime-shell-snapshots`) + `maintenance/RuntimeCleanupPanel.tsx` reclaim them. Files are
plain shell scripts named `snapshot-zsh-{ts}-{rand}.sh` (verified). Small, read-only — a
single-week sprint.

## 3. Backend
- New `src-tauri/src/files/shell_snapshots_reader.rs`:
  - `pub fn list_shell_snapshots(root: &str) -> Result<Vec<SnapshotMeta>, String>` — dir-walk
    `shell-snapshots/*.sh` (style from `files/skills_inventory.rs`); return
    `SnapshotMeta { name, size_bytes, mtime }`.
  - `pub fn read_shell_snapshot(root: &str, name: &str) -> Result<String, String>` — confined read
    via `files::text_write::read_text_file` semantics; confine `name` to `shell-snapshots/`.
- Wrappers in `src-tauri/src/commands/files.rs`; register in `main.rs` `generate_handler!`.

## 4. Frontend
- New `frontend/src/renderer/components/maintenance/ShellSnapshotPanel.tsx` (Maintenance tab,
  alongside `RuntimeCleanupPanel.tsx`) — a list (name/mtime/size) + a read-only, syntax-highlighted
  shell view (reuse the existing code-block renderer with `language="bash"`).
- API: `shellSnapshots` domain method; type
  `frontend/src/shared/types/api/shellSnapshots.ts` (`SnapshotMeta`).

## 5. Tasks (ordered)
1. Backend `list_shell_snapshots` + `read_shell_snapshot` → `cargo test shell_snapshots_reader`.
2. Command wrappers + `main.rs` registration → `bun run test:rust`.
3. Shared type + API adapter → `bun run typecheck`.
4. `ShellSnapshotPanel.tsx` (list + read-only highlighted content).

## 6. Verification / acceptance
- `cargo test shell_snapshots_reader` — lists a fixture dir; `read_shell_snapshot` rejects a
  traversal `name` and returns exact bytes.
- `bun run typecheck && bun run test && bun run qa` green.
- Manual: open the panel on the real dir; pick a snapshot; the `.sh` content renders highlighted.

## 7. Dependencies
None.

## 8. Drift / risk notes
- File naming/format is stable shell script — low drift. Reader still tolerant of an unreadable file
  (skip with a labeled error row, never fail the list).
