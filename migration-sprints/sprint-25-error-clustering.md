# Sprint 25 — Week of 2026-06-22 | Analytics

## Error Pattern Root-Cause Clustering

### Deliverables
1. **Clustering pass** — extend `error_hotspots.rs`: tokenize error messages, shingle hash, union-find cluster; surface top-K clusters with member sessions + representative message.
2. New command `get_error_clusters(range, min_cluster_size)`.
3. `ErrorClustersPanel.tsx` — ranked cluster list; expand → session rows.
4. Cross-link: click cluster member → opens session at erroring chunk.

### Files
- `src-tauri/src/analysis/error_hotspots.rs` (clustering added; keeps clustering in `analysis/`, not `analytics/`)
- `src-tauri/src/lib.rs`
- `src/renderer/components/dashboard/ErrorClustersPanel.tsx` (new)
- `src/renderer/components/dashboard/ErrorHotspotsPanel.tsx` (add clusters tab)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 10 (error hotspots backend)

### Verification
- `cargo test` two near-duplicate errors land in same cluster
- Manual: cluster expand/collapse stable; navigation works
