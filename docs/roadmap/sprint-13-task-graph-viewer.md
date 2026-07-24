# Sprint 13 — Background Task-Graph Viewer

## 1. Goal
Surface the per-background-task task graph under `~/.claude/tasks/{uuid}/{N}.json` — the
subject/status/blocks list a background agent maintains — which is shown **nowhere** in the app
today, read-only.

## 2. Gap addressed
`tasks/` (gap matrix #8, previously misclassified as pure runtime scratch). Verified: populated
`tasks/{uuid}/` dirs hold `1.json … N.json` with `{id, subject, description, activeForm, status,
blocks, blockedBy}` — a task graph. This is a **different source** from `TodosDashboard` (which
reads session-embedded `TodoWrite` via `AggregatedSessionTodos`), so it is not currently visible.
(Empty/live task dirs hold only `.highwatermark` + `.lock` — those are skipped.)

## 3. Backend
- New `src-tauri/src/files/task_graph_reader.rs`:
  - `pub fn list_task_graphs(root: &str) -> Result<Vec<TaskGraphMeta>, String>` — walk `tasks/{uuid}/`,
    skip dirs with no `{N}.json` (marker-only), return `TaskGraphMeta { uuid, task_count, latest_mtime }`.
  - `pub fn read_task_graph(root: &str, uuid: &str) -> Result<Vec<TaskNode>, String>` — read the
    dir's `{N}.json` files into `TaskNode { id, subject, description, active_form, status, blocks,
    blocked_by }` (ordered by N); confine `uuid`.
- Wrappers in `src-tauri/src/commands/files.rs`; register in `main.rs` `generate_handler!`.

## 4. Frontend
- New `frontend/src/renderer/components/dashboard/TaskGraphViewer.tsx` — ActivityBar view
  `activity="taskGraph"` (or nested near Todos). List of task-dirs → a task-graph detail showing
  each node's subject/status and its `blocks`/`blockedBy` edges (a simple dependency list; reuse the
  existing status/badge components used by `TodosDashboard`).
- API: `taskGraph` domain method; type `frontend/src/shared/types/api/taskGraph.ts` (`TaskGraphMeta`,
  `TaskNode`).

## 5. Tasks (ordered)
1. Backend `list_task_graphs` (skip marker-only dirs) + `read_task_graph` →
   `cargo test task_graph_reader`.
2. Command wrappers + `main.rs` registration → `bun run test:rust`.
3. Shared types + API adapter → `bun run typecheck`.
4. `TaskGraphViewer.tsx` (dir list → task nodes + blocks/blockedBy edges).

## 6. Verification / acceptance
- `cargo test task_graph_reader` — a marker-only dir is skipped; a populated dir parses to ordered
  `TaskNode`s with `{id, subject, status, blocks, blockedBy}`; `read_task_graph` rejects a traversal
  `uuid`.
- `bun run typecheck && bun run test && bun run qa` green.
- Manual: open Task-graph; a populated dir shows nodes + dependency edges; empty/live dirs don't
  appear.

## 7. Dependencies
None. (Optional sprint — opted in by the user; overlaps session TodoWrite data but is a distinct,
otherwise-unshown source.)

## 8. Drift / risk notes
- Task-node schema is version-specific — tolerant parse (skip a malformed `{N}.json`, keep the
  rest), `// confirm-at-impl`.
- These dirs are ephemeral background-agent state; the viewer is read-only and must not assume a dir
  persists between reads (handle a vanished dir gracefully).
