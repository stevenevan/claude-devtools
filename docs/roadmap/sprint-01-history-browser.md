# Sprint 01 — Prompt/Command History Browser

## 1. Goal
A first-class, searchable viewer for `~/.claude/history.jsonl` — the log of every prompt/command
the user has submitted — replacing today's analyze-and-prune-only surface.

## 2. Gap addressed
`history.jsonl` (gap matrix #5). Today `maintenance/HistoryPanel.tsx` +
`analyze_history`/`prune_history` expose only prunable line/byte statistics. There is no way to
**read** the history. Each line is `{display, pastedContents, project, timestamp}` (verified on
disk). The file is ~4 MB, so the reader must paginate — never load it whole into the renderer.

## 3. Backend
- New `src-tauri/src/files/history_reader.rs`:
  - `pub fn read_history_page(root: &str, offset: usize, limit: usize, query: Option<&str>) -> Result<HistoryPage, String>`
    — streams `history.jsonl` line-by-line (reuse the streaming reader style of
    `parsing/session_parser/streaming.rs`), parses `{display, pastedContents, project, timestamp}`,
    filters by substring/regex on `display`+`project` when `query` is set, returns newest-first.
  - `HistoryPage { entries: Vec<HistoryEntry>, total_matched: usize, has_more: bool }`,
    `HistoryEntry { display: String, project: String, timestamp: i64, pasted_count: usize }`
    (surface `pastedContents` as a count only in the list; full pasted bodies load on demand).
  - Tolerant: skip malformed lines, never fail the page; `// confirm-at-impl` note on the schema.
- Wrapper `read_history_page` in `src-tauri/src/commands/files.rs`; register in
  `src-tauri/src/main.rs` `generate_handler!`.
- Regex from `query` validated at the boundary (reuse the existing regex-validation util pattern
  used by ignore-regex config).

## 4. Frontend
- New `frontend/src/renderer/components/dashboard/HistoryBrowser.tsx` — a first-class ActivityBar
  view `activity="history"` (add to the `ActivityView` union + `ActivityBar.tsx`, following the
  `SkillsManager`/`TodosDashboard` pattern). Virtualized list (reuse the virtualization approach
  from `ChatHistoryVirtualizer.tsx`), a search box (debounced → `read_history_page` with `query`),
  a project filter, per-entry copy, and a detail drawer that lazy-loads `pastedContents`.
- API: `history` domain method in `frontend/src/renderer/api/tauri/domain/files.ts` (or a new
  `history.ts` domain); type `frontend/src/shared/types/api/history.ts` (`HistoryPage`,
  `HistoryEntry`).

## 5. Tasks (ordered)
1. Backend `history_reader.rs` + types → `cargo test history_reader`.
2. Command wrapper + `main.rs` registration → `bun run test:rust`.
3. Shared type + API adapter method → `bun run typecheck`.
4. `HistoryBrowser.tsx` + `activity="history"` wiring (virtualized list, search, project filter).
5. Detail drawer with lazy `pastedContents`.

## 6. Verification / acceptance
- `cargo test history_reader` — parses a fixture with mixed valid/malformed lines; pagination +
  `query` filter return expected counts.
- `bun run typecheck && bun run test && bun run qa` green.
- Manual: open History; the ~4 MB real file paginates and scrolls **without UI freeze**; search
  narrows results; project filter works; copy yields the exact `display` text.

## 7. Dependencies
None. (This is the first read-only viewer; it establishes the `activity="…"` viewer pattern the
later read-only sprints follow — extract a shared list/detail shell only if Sprint 02+ actually
reuse it, not preemptively.)

## 8. Drift / risk notes
- `history.jsonl` line schema is version-specific — parser tolerant, `// confirm-at-impl`.
- This sprint **owns** the history pagination/virtualization; Sprint 12 only regression-checks it.
