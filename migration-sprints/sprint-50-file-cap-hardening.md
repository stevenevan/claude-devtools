# Sprint 50 — Week of 2026-12-14 | Hardening

## File-Cap Hardening — Split Files Past 800-Line Hard Cap

### Context
Five source files have crept past the 800-line hard cap during sprints 18–49. Sprint 44 was scope-cut and never shipped the `commands.rs` split. This sprint discharges that debt, keeps behavior identical, all tests green.

### Files to split

| File | Lines | Target |
|------|-------|--------|
| `src-tauri/src/commands.rs` | 1384 | `src-tauri/src/commands/` directory (per-domain modules) |
| `src/renderer/utils/contextTracker.ts` | 1155 | `src/renderer/utils/contextTracker/` (per-category extractors) |
| `src-tauri/src/config/manager.rs` | 1117 | `src-tauri/src/config/manager/` (per-aggregate `impl ConfigState` blocks) |
| `src/renderer/components/chat/ChatHistory.tsx` | 1084 | extract hooks + subcomponents (no behavior change) |
| `src-tauri/src/parsing/entry_parser.rs` | 824 | **trim first**; only split if can't get under 800 by trimming |

### Deliverables

1. **`commands.rs` → `commands/`** — Group `#[tauri::command]` fns by domain: `project`, `session`, `config`, `annotations`, `snapshots`, `plugins`, `agents` (houses `read_agent_configs` + `read_global_{agents,skills,plugins,settings}` quartet — plugin-adjacent but distinct surface), `webhook`, `ssh`, `window`, `timing`. (No `bookmarks` bucket — bookmark surface lives entirely in `config/manager.rs`, not as `#[tauri::command]`.) `commands/mod.rs` does **explicit** re-exports (no glob `pub use *`) to avoid silent name collisions. Update `lib.rs::generate_handler!` registration to point at new paths. **No renames** of any `#[tauri::command]` fn — frontend calls these by string name via `invoke()`.

2. **`contextTracker.ts` → `contextTracker/`** — Split by injection category: `claudeMd.ts`, `mentionedFile.ts`, `toolOutput.ts`, `thinkingText.ts`, `teamCoordination.ts`, `userMessage.ts`. `index.ts` re-exports the **actual 5 public symbols**: `processSessionContextWithPhases`, `buildTurnBreakdown`, `ContextCategoryKey`, `ContextCategoryEntry`, `ContextTurnBreakdown`. (`computeContextStats` is internal — do not re-export.) Type defs stay in `src/renderer/types/contextInjection.ts`. Pattern exception (renderer barrel) is justified because 3 external callers already import from `@renderer/utils/contextTracker` — barrel preserves import contract. **Add inline comment** at top of `index.ts` documenting this as a one-off, not a precedent for other renderer utils.

3. **`config/manager.rs` → `config/manager/`** — `ConfigState` struct is a single aggregate with one big `impl` block. Split by adding **multiple `impl ConfigState` blocks** across files: `manager/mod.rs` (struct def + `new` + `get_config` + `save_state`), `annotations.rs`, `bookmarks.rs`, `filters.rs`, `notifications.rs`, `snapshots.rs`. Each sub-file is `impl ConfigState { ... }` with the relevant methods. **Test fns move with their target aggregate** (e.g. annotation tests → `annotations.rs`), not parked in `mod.rs`. Confirm split mapping from current line ranges before writing. `commands/config.rs` continues to call the same public API.

4. **`ChatHistory.tsx`** — Extract `useTurnNavigationListener` hook (J/K keyboard nav event listener, 80 lines). Component drops from 1084 → 1030. **Remaining 230 lines over cap deferred to follow-up sprint** — extracting the remaining handlers (`handleNavigateToTurn`, `handleNavigateToUserGroup`, search canonicalization effect, scroll restore) is non-trivial due to ref+state coupling and risks behavioral regression. Sprint 50 priority was Rust + util hardening; ChatHistory deep extraction belongs in its own ticket.

5. **`entry_parser.rs`** — Try trimming first: 824 lines is 3% over cap with only 3 fns. If trimming `parse_content` and removing dead branches gets it under 800, ship the trim and skip the directory split. If not, fall back to `entry_parser/{mod,user,assistant,system,compact}.rs`.

### Files touched (estimated)

- `src-tauri/src/lib.rs` — handler registration update
- `src-tauri/src/commands.rs` → delete; `src-tauri/src/commands/{mod,project,session,config,annotations,snapshots,plugins,agents,webhook,ssh,window,timing}.rs` new
- `src-tauri/src/config/manager.rs` → delete; `src-tauri/src/config/manager/{mod,annotations,bookmarks,filters,notifications,snapshots}.rs` new (final shape derived from method inventory in step 3)
- `src-tauri/src/parsing/entry_parser.rs` — trim in place (preferred) or split if trim insufficient
- `src/renderer/utils/contextTracker.ts` → delete; `src/renderer/utils/contextTracker/{index,claudeMd,mentionedFile,toolOutput,thinkingText,teamCoordination,userMessage}.ts` new
- `src/renderer/components/chat/ChatHistory.tsx` (slim down)
- `src/renderer/hooks/useChatHistoryScroll.ts` (new)
- `src/renderer/hooks/useChatHistoryGroups.ts` (new)

### Imports

External call sites import from module roots — no churn:
- `use crate::commands::*;` continues working via `commands/mod.rs` re-export.
- `import { computeContextStats } from '@renderer/utils/contextTracker'` continues working via index.ts barrel.
- `use crate::config::ConfigManager;` continues working via `manager/mod.rs` re-export.

### Verification

1. `bun run typecheck` clean (no signature drift)
2. `bun run lint:fix` clean
3. `cargo check` + `cargo test` clean
4. `bun run test` — all suites green; specifically:
   - `test/renderer/utils/contextTracker.test.ts` (exists, exercises both `processSessionContextWithPhases` and `buildTurnBreakdown`)
   - `cargo test` under `src-tauri/` covers `entry_parser` refactor + commands handler registration (no JS-side tests for those Rust surfaces)
5. `bun run quality` clean (knip on barrel re-exports)
6. All target files measured: `wc -l <files>` returns < 800 for every split source.
7. Manual: `bun run dev` — open a session, scroll, change theme, save snapshot, run search. No regressions.

### Out of scope

- No new features.
- No behavior changes.
- No public API rename.
- No test coverage additions beyond what's needed to keep passing.
- `ChatHistory.tsx` has 8 `useCallback` call sites (banned per `react.md`). **Flag in PR comment**, do not fix in this sprint.

### Implementation Order (de-risk)

1. `entry_parser.rs` — smallest, self-contained Rust. `cargo test` verifies fast.
2. `commands.rs` → `commands/` — touches `lib.rs` handler registration but additive. Ship alone for clean blame.
3. `config/manager.rs` → `manager/` — confirm `impl ConfigState` split mapping before writing.
4. `contextTracker.ts` → `contextTracker/` — re-export list precisely matches the 5 public symbols.
5. `ChatHistory.tsx` — last. Highest behavioral-regression risk (scroll state, render timing).

### Dependencies

- None. Pure refactor.

## Review Trail

### Metis Plan Consultant
- [x] contextTracker re-export list corrected to 5 actual public symbols (no `computeContextStats`)
- [x] entry_parser strategy switched to "trim first, split only if necessary"
- [x] Rust `commands/mod.rs` explicit re-exports (no glob) to avoid silent collisions
- [x] No renames of `#[tauri::command]` fns — frontend `invoke()` contract preserved
- [x] `config/manager.rs` split clarified — multiple `impl ConfigState` blocks across files
- [x] Removed `ChatHistoryHeader.tsx` (verified non-existent)
- [x] Implementation order added (entry_parser → commands → config → contextTracker → ChatHistory)
- [x] Barrel exception for contextTracker documented inline (not generalized)

### Architect Reviewer
- [x] `commands/agents.rs` bucket added for `read_agent_configs` + `read_global_*` quartet
- [x] `commands/bookmarks.rs` dropped — momus confirmed no `#[tauri::command]` bookmark fns
- [x] Test fns move with their target aggregate in `manager/` split (not parked in mod.rs)
- [x] Barrel exception inline-documented in `contextTracker/index.ts` to prevent cargo-culting
- [x] Two-hook split (`useChatHistoryScroll`, `useChatHistoryGroups`) confirmed idiomatic
- [x] `ChatHistory.tsx` banned-`useCallback` (8 sites) deferred to PR comment
- [x] Order of operations confirmed (Rust contiguous before TS)

### Momus Plan Reviewer
- [x] All 5 line counts verified (`wc -l`): 1384 / 1155 / 1117 / 1084 / 824 — exact
- [x] 5 contextTracker public symbols verified by `grep ^export`
- [x] `ConfigState` confirmed single struct at `manager.rs:18`
- [x] `read_agent_configs` + `read_global_{agents,skills,plugins,settings}` all present
- [x] `ChatHistoryHeader` confirmed non-existent (0 matches)
- [x] Test path block fixed — `test/main/` tree does not exist; switched to `cargo test` for Rust surfaces and the real `test/renderer/utils/contextTracker.test.ts` path
- [x] `bookmarks` bucket dropped from `commands/` (no `#[tauri::command]` bookmark fns)
- [x] `useCallback` count corrected: 8 sites, not 1

**VERDICT: READY** — sprint 50 cleared to implement.

