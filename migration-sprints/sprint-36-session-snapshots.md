# Sprint 36 — Week of 2026-09-07 | Customization

## Session Snapshots

### Deliverables
1. **Snapshot engine (Rust)** — `create_session_snapshot(session_id)` writes a compressed JSON of chunks + metadata to `~/.claude-devtools/snapshots/`. Uses `flate2` gzip.
2. Commands: `list_snapshots`, `create_snapshot_from_session`, `delete_snapshot`, `open_snapshot(id)` (returns a session-detail payload).
3. `SnapshotsView.tsx` — grid of snapshots with open/delete; opened snapshot mounts in a read-only tab (badge in tab header).

### Files
- `src-tauri/src/snapshots.rs` (new)
- `src-tauri/src/lib.rs`
- `src/renderer/components/dashboard/SnapshotsView.tsx` (new)
- `src/renderer/store/slices/snapshotSlice.ts` (new)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Existing session export (`feat: session export` commit 46a1585)

### Verification
- `cargo test` snapshot write/read round-trip with compression (`flate2`)
- Manual: 500-chunk snapshot <5MB; open tab read-only indicator visible

### Out of Scope (explicit)
- Templates (named snapshot + initial prompt) — dropped per metis directive (no user need)
- Initial-prompt prefixing / session seeding from snapshot
