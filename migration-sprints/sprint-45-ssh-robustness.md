# Sprint 45 — Week of 2026-11-09 | Hardening

## SSH Session Robustness + SFTP Streaming

### Deliverables
1. **SFTP provider from-scratch** — `sftp_provider.rs` is currently a 1-byte stub. Implement streaming JSONL fetch: opens remote file, remembers byte offset, tails via SFTP `open + seek + read` on poll interval. Emits new lines incrementally.
2. **Auto-reconnect** — on dropped connection: exponential backoff (1s, 2s, 4s, 8s, cap 30s); infinite retries until user cancels. Existing offset preserved across reconnect.
3. **Status surfacing** — `SshStatusIndicator.tsx` in header: `connected | reconnecting | offline | authenticating`.

### Pre-conditions
- Sprint 44 workspace split must be green (SSH lives in `shared-parsing` or remains in `src-tauri` per that sprint's final decision).
- This sprint runs **before** sprint 46 observability so timing instrumentation wraps a real SSH path, not a stub (architect directive #10).

### Files
- `src-tauri/src/ssh/sftp_provider.rs` (rewrite — currently stub)
- `src-tauri/src/ssh/connection_manager.rs`
- `src-tauri/src/ssh/retry.rs`
- `src/renderer/components/layout/SshStatusIndicator.tsx` (new)
- `src/renderer/store/slices/connectionSlice.ts`
- `src/shared/types/api.ts`

### Dependencies
- Existing `ssh/` module (scaffolding only)
- Sprint 44 (workspace split clean)

### Verification
- `cargo test` backoff sequence caps at 30s; offset preserved across reconnect
- `cargo test` SFTP read appends new bytes past prior offset
- Manual: kill SSH tunnel mid-session; reconnect auto; new JSONL entries arrive
