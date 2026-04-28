# Sprint 30 — Week of 2026-07-27 | Playback

## File Dependency Graph from Tool Calls

### Deliverables
1. **Graph builder (Rust)** — scan Read/Edit/Write tool inputs+outputs per session; emit nodes (files) and edges (Read→Edit, Edit→Write). New command `get_file_graph(session_id)`.
2. `FileGraphView.tsx` — force-directed layout via `d3-force`; node size = interaction count, edge colour = op type.
3. Hover node → show list of turn indices where file was touched; click → scroll chat.

### Files
- `src-tauri/src/analysis/file_graph.rs` (new)
- `src-tauri/src/analysis/mod.rs`
- `src-tauri/src/lib.rs`
- `src/renderer/components/chat/FileGraphView.tsx` (new)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Existing `tool_linking.rs`
- Add `d3-force` dep (`bun add d3-force @types/d3-force`)

### Verification
- `cargo test` graph has 3 nodes / 2 edges for Read→Edit→Write on same file
- Manual: layout stabilizes under 2s for 200-file session
