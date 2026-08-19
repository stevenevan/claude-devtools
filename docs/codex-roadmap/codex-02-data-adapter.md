# CDX-02 — Sessions, transcripts, and task graph

Rail visibility: History · Depends on: CDX-01 · See `docs/ux-roadmap/ux-02-conversations.md`, `docs/ux-roadmap/ux-03-session-view.md`, `docs/ux-roadmap/ux-05-tasks.md`, `docs/ux-roadmap/ux-14-task-graph.md`

## 1. Goal

Purpose: bring Codex Sessions/History, Transcripts, and Task Graph into the app as one read-only execution-inspection week. The adapter should let existing views render Codex data without copying Codex-specific parsing rules into React.

## 2. Today

The Rust pipeline is organized around the current Claude project and session layout. The app already has `HistoryBrowser`, `TranscriptsViewer`, `TaskGraphViewer`, session stores, and typed Tauri API adapters, but no Codex reader for the product’s `history.jsonl`, project/session JSONL, `transcripts/`, or `tasks/` data.

## 3. Simple view

The existing navigation should gain a Codex source label and three related views:

```text
Codex workspace                 [Codex]

History · 12 sessions
Transcripts · 8 files
Task Graph · 3 graphs

Build dashboard       10:42       14 turns
Fix parser             09:18        6 turns
```

Rules:

- Show Codex history entries, sessions, transcripts, and task graphs with the same scan, empty, loading, and error states as existing views.
- A session opens from History into its transcript and related task graph when those records exist.
- Do not expose raw JSONL by default.
- Keep the user’s current source selection when navigating between the three views.

## 4. Nerd view

Add source and provenance to each domain model:

| Record | Required fields |
| --- | --- |
| History entry | session ID, project, timestamp, display title, source file |
| Session | stable ID, project, turns, event count, parse diagnostics |
| Transcript | session link, ordered messages, source offsets, truncation state |
| Task graph | graph ID, nodes, edges, status, source file |

Malformed records are counted and reported. One bad line or graph must not hide the rest of a project.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| JSONL record | Session event | Parsed event with source offset |
| History row | Session | Indexed session entry |
| Transcript file | Transcript | Ordered transcript stream |
| Task list | Task graph | Graph nodes and dependency edges |
| Parse warning | Some details could not load | N records skipped; see diagnostics |

## 6. Files touched

- `src-tauri/src/files/` — add Codex readers for history, session JSONL, transcripts, and task graphs.
- `src-tauri/src/commands/files.rs` — add source-aware history, transcript, session, and task-graph commands.
- `frontend/src/shared/types/api/` — extend shared models with source and provenance fields.
- `frontend/src/renderer/api/tauri/domain/session.ts` — map source-aware session commands into the typed API.
- `frontend/src/renderer/components/dashboard/HistoryBrowser.tsx` — render Codex history entries.
- `frontend/src/renderer/components/dashboard/TranscriptsViewer.tsx` — render Codex transcripts.
- `frontend/src/renderer/components/dashboard/TaskGraphViewer.tsx` — render Codex task graphs.
- `frontend/src/renderer/store/slices/sessionSlice/` — isolate Codex session cache and selection state.
- Existing Rust parity fixtures and frontend API tests — add small Codex examples.

## 7. Tasks (ordered)

1. Inventory the Codex files and map `history.jsonl`, project sessions, transcripts, and tasks to domain models.
2. Define normalized source-aware contracts before writing parsers.
3. Implement tolerant History and session JSONL parsing with line-level diagnostics and bounded memory use.
4. Implement transcript loading with stable message ordering, unknown-event preservation, and truncation state.
5. Implement task-graph loading with safe node/edge validation and missing-directory empty states.
6. Thread source identity through Rust commands, the DesktopAPI adapter, stores, and route loaders.
7. Connect History → Session → Transcript/Task Graph navigation without duplicating the view hierarchy.
8. Add representative fixtures for empty files, mixed event types, truncated lines, unknown fields, and malformed graph edges.

## 8. Verification / acceptance

- A valid Codex History entry appears and opens its session.
- A session can show its transcript and related task graph when available.
- Unknown event types remain visible as safe, labeled records or diagnostics.
- Truncated JSONL does not crash the command or discard valid earlier events.
- Missing transcripts or task graphs produce explicit empty states, not a broken route.
- Claude fixtures and snapshots keep their current output.
- `bun run typecheck`, `bun run test`, and `bun run test:rust` pass.

## 9. Accessibility

- Source badges must have text, not color-only meaning.
- Parse warnings and empty states must be announced in the page status region.
- History, transcript, and graph selections must preserve keyboard focus and readable names.
- Task-graph relationships need a text/list representation in addition to the visual graph.

## 10. Dependencies

- CDX-01 root resolution and path guards.
- Existing session, transcript, task, and graph types.
- Existing History, Transcripts, Task Graph, stores, and route contracts.

## 11. Risks / open questions

- Codex event names and file layouts may vary across CLI versions; unknown fields must be tolerated and version diagnostics retained.
- A single normalized model may hide useful Codex-only metadata. Keep an optional source-specific metadata field rather than forking every view.
- Large histories need bounded scans and pagination before they are enabled by default.
- Graph files may be incomplete while a session is still running; label partial graphs instead of treating them as final.

## 12. References

- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
