# Sprint 46 — Week of 2026-11-16 | Hardening

## Backend Observability — Timings + Cache Metrics (merged)

### Pre-conditions
- Sprint 44 has split `commands.rs` into `commands/` dir — this sprint wraps spans in those submodules, not the monolith.
- Sprint 45 has shipped real SFTP path — timing instrumentation wraps a real code path, not a stub.

### Deliverables
1. **Timing instrumentation** — wrap top commands (`get_session_detail`, `get_session_list`, `get_cost_forecast`, `get_tool_analytics`, `get_error_hotspots`) with `tracing::span`. Emit per-call duration to an in-memory ring buffer.
2. **Cache metrics** — extend `SessionCache` (now in `shared-parsing` after sprint 44) with hit/miss/evict counters.
3. **Tunable cache capacity** — `cache_max_sessions` in `AppConfig`; hot-reload on change.
4. Commands: `get_backend_timings(limit)`, `get_cache_stats()`.
5. **`BackendDebugPanel.tsx`** — Settings > Debug section only (not a dashboard card). Shows p50/p95/p99 per command, hit rate, cache capacity slider, "clear cache" button.

### Files
- `src-tauri/src/timing.rs` (new — ring buffer + span wrapper)
- `src-tauri/src/commands/sessions.rs`, `analytics.rs`, `config.rs`, `ssh.rs` (wrap listed commands, post-sprint-44 split)
- `crates/shared-parsing/src/cache.rs` (counters, capacity setter; moved in sprint 44)
- `src-tauri/src/config/types.rs`
- `src-tauri/src/config/commands.rs`
- `src-tauri/src/lib.rs`
- `src/renderer/components/settings/sections/BackendDebugPanel.tsx` (new)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Add `tracing` crate (or use existing logging if already in tree — check `Cargo.toml`)

### Verification
- `cargo test` — ring buffer overwrites at capacity; cache hit/miss increments; capacity change evicts extras
- Manual: panel refresh every 2s; p99 outlier command identifiable

### Out of Scope (explicit)
- Dashboard card surface — Settings > Debug only per metis directive
