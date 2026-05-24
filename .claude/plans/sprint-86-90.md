# Sprint 86-90 Plan: File-Split Wave (autonomous)

## Context

Sprints 81-85 completed (commits `bb40ed4`..`d20367f`). User wants me to continue autonomously, commit per sprint. This plan tackles next 5 files >400 LOC, ordered TS/Rust/TS/Rust/TS to alternate frontend/backend (precedent: sprints 76-85).

Pattern from sprints 70-85: move code verbatim, preserve external imports via shim or `pub use`, no behavior changes, one commit per sprint.

## Targets (top 5 by LOC, excluding already-split)

| Sprint | File | LOC | Surface |
|--------|------|-----|---------|
| 86 | `src/renderer/store/slices/conversationSlice.ts` | 627 | Zustand slice |
| 87 | `src-tauri/src/config/types.rs` | 593 | Rust config structs |
| 88 | `src/renderer/components/sidebar/DateGroupedSessions.tsx` | 608 | React component |
| 89 | `src-tauri/src/config/validation.rs` | 592 | Rust validators |
| 90 | `src/renderer/components/settings/sections/GeneralSection.tsx` | 594 | React component |

---

## Sprint 86 — Split conversationSlice.ts (627 LOC)

Slice with three orthogonal concerns: search, expansion state, detail popover. Free fns (`mapRustMatchesToStoreMatches`, `performJsSearch`) are search-only.

**Output directory:** `src/renderer/store/slices/conversation/`

**Strategy:** match the **sibling-action precedent** from sprint 73 (`tabSlice`) and sprint 74 (`sessionDetailSlice`). Keep slice file as a thin StateCreator with state + 1-2 line method wrappers; move heavy action bodies + free helpers to sibling files. NO sub-builder composition pattern (that diverges from precedent).

**Files:**
- `conversation/expansionActions.ts` — exported pure helpers (NOT bound to set/get; take state as args, return new state slices). Functions: `setAIGroupExpansionState(state, aiGroupId, level)`, `toggleStepExpansionState(state, stepId)`, `toggleDisplayItemExpansionState(state, aiGroupId, itemId)`, `toggleAIGroupExpansionState(state, aiGroupId)`. Each returns `Partial<ConversationSlice>` for `set(...)` to spread. Bodies copied verbatim from lines 274-326. `getExpandedDisplayItemIds` is a pure getter — export as `getExpandedDisplayItemIdsFromState(state, aiGroupId)`.
- `conversation/detailPopoverActions.ts` — `ActiveDetailItem` type re-export (kept alongside). Exported helpers: pure builders for the `set({activeDetailItem: ...})` payloads if any logic; given the bodies are trivial (lines 329-346), this file may only hold the type alias and one helper `buildDetailPopover(aiGroupId, itemId, type): ActiveDetailItem`. If it shrinks under 30 LOC, fold into `index.ts` instead — judgement call at execution time.
- `conversation/searchInternals.ts` — grab-bag (renamed from `searchHelpers.ts` to signal mixed concerns):
  - `MAX_SEARCH_MATCHES`, `RUST_SEARCH_THRESHOLD` (consts)
  - `isSearchDebugEnabled` (exported fn — used by `searchActions.ts` logging)
  - `mapRustMatchesToStoreMatches`, `performJsSearch` (exported helpers; `performJsSearch` takes `set` callback so caller stays decoupled)
  - `searchIdCounter` shared mutable: `let counter = 0; export const bumpSearchId = (): number => ++counter; export const currentSearchId = (): number => counter;`
  - **Three usage sites must be rewritten:**
    - line 399 `const currentSearchId = ++searchIdCounter` → `const requestId = bumpSearchId();` (rename local to avoid shadow with accessor)
    - line 413/440 read comparison `currentSearchId !== searchIdCounter` → `requestId !== currentSearchId()` (uses the renamed local + the accessor)
    - line 550 bare `searchIdCounter++` (invalidate pending) → `bumpSearchId();` (discard return)
- `conversation/searchActions.ts` — exported helpers for search actions: `runSearchQuery(get, set, query, conversationOverride)`, `runSyncRendered(get, set, renderedMatches)`, `runSelectMatch(get, set, itemId, matchIndexInItem): boolean`, `runHideSearch(set)`, `runNextResult(get, set)`, `runPrevResult(get, set)`, `runExpandForCurrent(get, set)`. Bodies copied verbatim from lines 359-626 (the action bodies inside the slice). Imports from `./searchInternals`.
- `conversation/index.ts` — exports `ConversationSlice`, `ActiveDetailItem`, `createConversationSlice`. The slice file itself is now thin (~120 LOC): state initializers + 1-2 line method wrappers like `setSearchQuery: (q, ov) => runSearchQuery(get, set, q, ov)`. Matches sprint 73/74 pattern.

**Preserve old path:** **DELETE** `src/renderer/store/slices/conversationSlice.ts` after creating `slices/conversation/index.ts`. Update **three** importers (momus-corrected — a test util DOES import the slice file directly):
- `src/renderer/store/index.ts:15` → `import { createConversationSlice } from './slices/conversation';`
- `src/renderer/store/types.ts:12` → `import type { ConversationSlice } from './slices/conversation';`
- `test/renderer/store/storeTestUtils.ts:11` → `import { createConversationSlice } from '../../../src/renderer/store/slices/conversation';`

**Note:** `test/renderer/store/conversationSlice.test.ts` exists (uses `createTestStore` via `storeTestUtils.ts`, indirect). After updating `storeTestUtils.ts:11`, this test resolves via the new path. Verify green with `bun run test -- conversationSlice.test.ts`.

**Slice composition (precedent pattern from sprint 73/74):**
```ts
export const createConversationSlice: StateCreator<AppState, [], [], ConversationSlice> = (set, get) => ({
  // Initial state (all 25+ fields copied verbatim from lines 249-272)
  aiGroupExpansionLevels: new Map(),
  // ... etc
  activeDetailItem: null,
  searchQuery: '',
  // ... etc

  // Action wrappers (1-2 lines each, delegate to sibling files)
  setAIGroupExpansion: (id, level) => set(setAIGroupExpansionState(get(), id, level)),
  toggleStepExpansion: (id) => set(toggleStepExpansionState(get(), id)),
  showDetailPopover: (a, i, t) => set({ activeDetailItem: buildDetailPopover(a, i, t) }),
  hideDetailPopover: () => set({ activeDetailItem: null }),
  setSearchQuery: (q, ov) => runSearchQuery(get, set, q, ov),
  // ... etc
});
```

Typecheck catches missing fields — all 25+ `ConversationSlice` members must be present.

**`ganttChartMode: 'timeline'` orphan at line 254** — not declared in `ConversationSlice` interface, not referenced anywhere (verified by grep). **Drop it during the split.** It's already orphan code; preserving an unused field with no type is worse than removing it. Document in commit body: "dropped orphan `ganttChartMode` field (no consumers, not in interface)."

**Verify:**
- `grep -rn "createConversationSlice\|from.*conversationSlice" test/ src/` — confirm only `store/index.ts` and `store/types.ts` import (no tests hard-import the slice file)
- `bun run typecheck` clean (catches any missed slice field)
- `bun run test` green (existing slice tests at `test/renderer/store/sessionSlice.test.ts` etc. use the store; search behavior unchanged)
- `bun run lint:fix`
- `bun run quality`
- Manual smoke: search a session, expand/collapse AI groups, detail popover opens (UI verification)

**Commit:** `refactor(store): sprint 86 - split conversationSlice.ts`

---

## Sprint 87 — Split config/types.rs (593 LOC)

23 `pub struct` + 7 `impl Default` + 2 pub free fns (`merge_config_with_defaults`, `normalize_claude_root_path`) + 2 private default helpers. All consumers use `crate::config::types::{Name}` paths.

**Output directory:** `src-tauri/src/config/types/`

**Files (group by domain):**
- `types/app.rs` — `AppConfig` (line 12), `default_cache_max_sessions` (line 43), `PluginsConfig` (51), `ThemesConfig` (62), `CustomTheme` (73), `ShortcutsConfig` (86). Plus `impl Default for AppConfig` (351).
- `types/dashboard.rs` — `DashboardConfig` (97), `BudgetConfig` (108).
- `types/notifications.rs` — `NotificationConfig` (119), `NotificationTrigger` (132). Plus `impl Default for NotificationConfig` (373).
- `types/general.rs` — `GeneralConfig` (164), `DisplayConfig` (178), `default_code_block_theme` (190), `default_true` (194). Plus `impl Default for GeneralConfig` (390), `impl Default for DisplayConfig` (404). **Note:** `default_code_block_theme`/`default_true` are referenced by `#[serde(default = "...")]` on `DisplayConfig` fields (lines 181-189) — keep them in this file so `serde` path resolution stays local. If any struct in `app.rs` also uses them, mark `pub(super)` and import via `super::general::default_*`.
- `types/sessions.rs` — `SessionsConfig` (202), `FilterPreset` (224), `AnnotationExportBundle` (235), `ImportReport` (246), `AnnotationEntry` (257), `BookmarkEntry` (271), `PinnedSession` (283), `HiddenSession` (290). Plus `impl Default for SessionsConfig` (417).
- `types/ssh.rs` — `SshPersistConfig` (299), `SshLastConnection` (308), `SshConnectionProfile` (319). Plus `impl Default for SshPersistConfig` (432).
- `types/http.rs` — `HttpServerConfig` (334), `ClaudeRootInfo` (343). Plus `impl Default for HttpServerConfig` (443).
- `types/merge.rs` — `pub fn merge_config_with_defaults` (455), `pub fn normalize_claude_root_path` (570). **Explicit imports only** (sprint 78/80/82/85 precedent — no `use super::*`): `use super::app::AppConfig; use super::dashboard::DashboardConfig; use super::notifications::NotificationConfig; use super::general::{GeneralConfig, DisplayConfig}; use super::sessions::SessionsConfig; use super::ssh::SshPersistConfig; use super::http::HttpServerConfig;` plus `use serde_json::Value;` and any others the function bodies need.
- `types/mod.rs` — `mod app; mod dashboard; mod notifications; mod general; mod sessions; mod ssh; mod http; mod merge;` + **explicit** `pub use app::{AppConfig, PluginsConfig, ThemesConfig, CustomTheme, ShortcutsConfig}; pub use dashboard::{DashboardConfig, BudgetConfig}; pub use notifications::{NotificationConfig, NotificationTrigger}; pub use general::{GeneralConfig, DisplayConfig}; pub use sessions::{SessionsConfig, FilterPreset, AnnotationExportBundle, ImportReport, AnnotationEntry, BookmarkEntry, PinnedSession, HiddenSession}; pub use ssh::{SshPersistConfig, SshLastConnection, SshConnectionProfile}; pub use http::{HttpServerConfig, ClaudeRootInfo}; pub use merge::{merge_config_with_defaults, normalize_claude_root_path};` (NO `pub use *` — sprint 78/80/82/85 precedent).

**Preserve old path:** delete `src-tauri/src/config/types.rs`. Module declaration `pub mod types;` in `src-tauri/src/config/mod.rs:4` keeps working since `types/mod.rs` now provides the module.

**External importers (momus-corrected — full enumeration):**
- `src-tauri/src/config/manager/merge_helpers.rs:6-9` uses `merge_config_with_defaults, AppConfig, DisplayConfig, GeneralConfig, HttpServerConfig, NotificationConfig, NotificationTrigger, SshPersistConfig` — all re-exported, no change needed.
- `src-tauri/src/config/manager/annotations.rs:3` — `use crate::config::types::{...}` — preserved.
- 4 files in `notifications/` use `NotificationTrigger` — preserved.
- `src-tauri/src/ssh/commands.rs:146` inlines `crate::config::types::SshLastConnection` — preserved via `pub use ssh::SshLastConnection` re-export.
- Verify with `rg "crate::config::types::" src-tauri/src` immediately before splitting to catch any consumer not enumerated.

**Cross-file private helpers:** Resolved — `default_code_block_theme` and `default_true` placed in `general.rs` with `DisplayConfig`. Before splitting, `grep -n 'default = "default_code_block_theme"\|default = "default_true"' src-tauri/src/config/types.rs` to confirm no other structs reference them. If they appear in `SessionsConfig` or others, mark `pub(super)` in `general.rs` and `use super::general::{default_code_block_theme, default_true};` in the caller file.

**Verify:**
- `cargo check` from `src-tauri/` (catches any missed `pub use` re-export)
- `cargo test` from `src-tauri/`
- `bun run check` for full gate
- Tauri commands that touch config still resolve

**Commit:** `refactor(types): sprint 87 - split config/types.rs`

---

## Sprint 88 — Split DateGroupedSessions.tsx (608 LOC)

Single component, no other top-level decls except 4 height constants and 1 `VirtualItem` union. Heavy use of `useStore` + `useMemo` chains for filtering/grouping/flattening. Bulk-action handlers are repetitive.

**Output directory:** `src/renderer/components/sidebar/DateGroupedSessions/`

**Files:**
- `DateGroupedSessions/constants.ts` — `HEADER_HEIGHT = 28`, `SESSION_HEIGHT = 48`, `LOADER_HEIGHT = 36`, `OVERSCAN = 5` (lines 52-55) + `VirtualItem` type (lines 40-44).
- `DateGroupedSessions/useSessionListItems.ts` — **fused** hook (architect rejected the 2-hook split as artificial — `visibleSessions → filteredSessions → pinned/unpinned/grouped/categories → virtualItems` is one data chain). NO `useStore` calls inside. Extract the full chain (lines 126-273). Signature: `useSessionListItems({ sessions, hiddenSet, showHiddenSessions, sidebarFilters, bookmarks, activeFilters, sessionTagsMap, pinnedSessionIds, sessionSortMode, sessionsHasMore }): { virtualItems: VirtualItem[]; hasHiddenSessions: boolean }`. All store-derived inputs as props; parent owns store reads in the `useShallow` block.
- `DateGroupedSessions/BulkActionBar.tsx` — extract bulk-action JSX (lines 508-553). Props: `selectedCount`, `someSelectedAreHidden`, `showHiddenSessions`, `onPin`, `onTag`, `onHide`, `onUnhide`, `onClear`. The button JSX block in current file.
- `DateGroupedSessions/HeaderToolbar.tsx` — extract toolbar with sort/hide/multi-select buttons + count tooltip (lines 432-505). Props: `sessions`, `sessionsHasMore`, `sessionSortMode`, `setSessionSortMode`, `sidebarMultiSelectActive`, `toggleSidebarMultiSelect`, `hasHiddenSessions`, `showHiddenSessions`, `toggleShowHiddenSessions`. **Prop count (10+) is a known smell** — document in commit body as one-time cost of mechanical extraction; do not introduce object grouping or context just to reduce it.
- `DateGroupedSessions/SkeletonLoader.tsx` — extract loading skeleton block (lines 385-405). No props.
- `DateGroupedSessions/index.tsx` — `DateGroupedSessions` component itself. Imports the 5 extracted modules, wires them together. **Keep the bulk-handler `useCallback` definitions** (lines 342-373) and the virtualizer wiring (lines 296-330) inside this file — they bind to handlers + virtualizer ref.

**Constraints:**
- DO NOT change behavior or output. Only mechanical extraction.
- The `useShallow` store-read block (lines 89-116) stays inside `index.tsx` — splitting it would change selector semantics.
- `useFilteredSessions` and `useVirtualItems` MUST be plain hooks (call rules) — never call conditionally.
- Don't add `useCallback`/`React.memo` per project rule (`.claude/rules/react.md`).

**Preserve old path:** **MANDATORY** keep `src/renderer/components/sidebar/DateGroupedSessions.tsx` as one-line shim `export * from './DateGroupedSessions';` — sole consumer is `layout/Sidebar.tsx:9` which imports `from '../sidebar/DateGroupedSessions'`. Default resolution to `DateGroupedSessions.tsx` keeps Sidebar import unchanged. Alternative: delete file and add `index.tsx` to the directory; TS will resolve `from '../sidebar/DateGroupedSessions'` to the dir's `index.tsx`. **Pick: delete file approach** — matches sprint 83 precedent (no test imports this path directly).

Verify before deleting: `grep -rn "DateGroupedSessions" src --include="*.ts*"` — only Sidebar.tsx imports it. ✓

**Verify:**
- `bun run typecheck` clean
- `bun run lint:fix`
- `bun run test` green
- Manual smoke: sidebar shows sessions grouped by date, pinned section at top, sort toggle works, multi-select + bulk actions work, virtual scroll smooth, "load more" triggers near bottom.

**Commit:** `refactor(sidebar): sprint 88 - split DateGroupedSessions.tsx`

---

## Sprint 89 — Split config/validation.rs (592 LOC)

15 fns: 1 pub dispatcher + 12 section validators + 3 shared predicates. Tests block at lines 519-590.

**Output directory:** `src-tauri/src/config/validation/`

**Files:**
- `validation/predicates.rs` — `pub(super) fn is_string_array` (474), `pub(super) fn is_finite_number` (481), `pub(super) fn is_valid_ssh_profile` (488). Pure helpers, no deps.
- `validation/misc.rs` — grab-bag (renamed from `simple.rs` to signal mixed validators with no shared theme): `validate_onboarding` (33), `validate_webhook_endpoints` (48), `validate_notification_rules` (55), `validate_plugins` (62), `validate_themes` (80), `validate_shortcuts` (123), `validate_dashboard` (148). Marked `pub(super)`. Imports `super::predicates::{is_string_array, is_finite_number}` as needed (explicit, not `*`).
- `validation/notifications.rs` — `validate_notifications` (178, ~91 LOC) + needs `super::types::NotificationTrigger` (line 5 import) and predicates. `pub(super)`.
- `validation/general.rs` — `validate_general` (269, ~86 LOC), `validate_display` (355). `pub(super)`.
- `validation/server.rs` — `validate_http_server` (378), `validate_ssh` (418). `pub(super)`. Imports `super::predicates::is_valid_ssh_profile`.
- `validation/dispatcher.rs` — `pub fn validate_config_update` (12). Calls every section validator via `use super::misc::{validate_onboarding, validate_webhook_endpoints, validate_notification_rules, validate_plugins, validate_themes, validate_shortcuts, validate_dashboard}; use super::notifications::validate_notifications; use super::general::{validate_general, validate_display}; use super::server::{validate_http_server, validate_ssh};` — explicit imports, no glob. `use serde_json::Value;` for the `data: &Value` param. NO `super::types` import needed at this layer (dispatcher only dispatches; types live inside section validators).
- `validation/mod.rs` — `mod predicates; mod misc; mod notifications; mod general; mod server; mod dispatcher;` + `pub use dispatcher::validate_config_update;` (only pub fn) + `#[cfg(test)] mod tests;`.
- `validation/tests.rs` — `#[cfg(test)] mod tests` block at **lines 527-592** (`#[cfg(test)]` attr at 527, `mod tests {` at 528, file ends at 592 — verified). Tests only call `validate_config_update` (verified), so they go in this file with `use super::dispatcher::validate_config_update;` and `use serde_json::json;`. Declared in `mod.rs` as `#[cfg(test)] mod tests;`.
- **Dead comment at line 524** (`// Validation helper for trigger add/update in manager` — single line; 525/526 blank) — pre-existing orphan. **Drop it** during the split — it points to a non-existent helper and would be misleading wherever placed. Document removal in commit body. (Departs from surgical rule, but the orphan has zero callers and zero referent.)

**Cross-file consumers (verified):**
- `src-tauri/src/config/manager/notifications_ops.rs:23` uses `validation::validate_config_update(...)`. Preserved via `pub use dispatcher::validate_config_update` re-export from `mod.rs`.
- No other external consumers of validation fns.

**Module declaration:** `pub mod validation;` in `src-tauri/src/config/mod.rs:5` — unchanged. `validation/mod.rs` provides the module.

**Preserve old path:** delete `src-tauri/src/config/validation.rs`. Single pub fn `validate_config_update` resolves via `crate::config::validation::validate_config_update` (the `pub use` in `mod.rs`).

**Verify:**
- `cargo check` from `src-tauri/`
- `cargo test validation` from `src-tauri/` — tests at 519-590 must stay green (covers `validate_config_update("general"|"display"|"httpServer"|"notifications"|...)`)
- `bun run check`

**Commit:** `refactor(config): sprint 89 - split config/validation.rs`

---

## Sprint 90 — Split GeneralSection.tsx (594 LOC)

Single component with 5 logical sub-sections delineated by `<SettingsSectionHeader>` markers (Startup, Appearance, Code Blocks, Local Claude Root, Browser Access/Server). Plus a WSL modal `<Dialog>` block.

**Output directory:** `src/renderer/components/settings/sections/GeneralSection/`

**Files:**
- `GeneralSection/constants.ts` — `THEME_OPTIONS` (41), `CODE_BLOCK_THEME_OPTIONS` (47).
- `GeneralSection/StartupSubsection.tsx` — JSX block lines 282-307 (Startup `SettingsSectionHeader` + 2 `SettingRow`s). Props: `safeConfig`, `saving`, `onGeneralToggle`.
- `GeneralSection/AppearanceSubsection.tsx` — JSX block lines 308-364 (Appearance with Theme select + 2 SettingRows). Props: `safeConfig`, `saving`, `onThemeChange`, `onDisplayToggle`.
- `GeneralSection/CodeBlocksSubsection.tsx` — JSX block lines 365-405 (CodeBlocks with theme select + word wrap). Props: `safeConfig`, `saving`, `onCodeBlockThemeChange`, `onDisplayToggle`.
- `GeneralSection/ClaudeRootSubsection.tsx` — JSX block lines 406-471 + WSL modal lines 473-527 (Dialog closes at 527). Architect confirmed: 6 `useState`s (`claudeRootInfo`, `updatingClaudeRoot`, `claudeRootError`, `findingWslRoots`, `wslCandidates`, `showWslModal`) + 4 handlers (`handleResetClaudeRoot`, `handleUseWslForClaude`, `handleSelectClaudeRootFolder`, `applyWslCandidate`) are all tightly coupled here and shared with the WSL `Dialog`. The modal footer cross-invokes `handleSelectClaudeRootFolder`. **Extract ALL of it — state + handlers + JSX + Dialog — into a single subcomponent (~250 LOC).** Props in: `safeConfig`, `connectionMode`, `fetchProjects`, plus any other store hooks ClaudeRoot reads. This is the LARGEST subsection; without full extraction the parent doesn't shrink meaningfully.
- `GeneralSection/ServerSubsection.tsx` — JSX block lines 528-593 (the `{isElectron ? (...)}` ternary starting at line 528 contains both Browser Access at 530 and Server at 568). `serverStatus`, `serverLoading`, `copy/copied` hooks are declared at top of parent but consumed only here. **Extract state + handlers + JSX together** (matches ClaudeRoot pattern). Props in: `safeConfig`.
- `GeneralSection/index.tsx` — `GeneralSection` component composing the 5 subsections. Reads `safeConfig` and lifts top-level callbacks. Re-exports unchanged `GeneralSectionProps`.

**Investigation step BEFORE editing:** read the full 594 lines to map exact hook locations and confirm:
1. `useState`/`useEffect` declarations grouped by which subsection consumes them
2. Whether any state crosses subsection boundaries (e.g., does Startup read from CodeBlocks state?) — architect verified Startup/Appearance/CodeBlocks are independent (only consume `safeConfig` + parent callbacks); ClaudeRoot and Server own their own hook clusters

**Success threshold (explicit):** parent `index.tsx` < 400 LOC AND every sub-file < 400 LOC. ClaudeRoot extraction is mandatory to hit this — without it, the parent stays near full size. If after extracting ClaudeRoot (~250 LOC) and Server (~80 LOC) the parent is already < 400 LOC, the 3 small subsections (Startup/Appearance/CodeBlocks) can stay inline OR get extracted — judgement call. Default: extract all 5 for symmetry. Fall-back: if pure JSX extraction of Startup/Appearance/CodeBlocks is awkward, keep them in parent. Document choice in commit body.

**Known type-cast hole:** `safeConfig.general.theme` is typed `string`, `onThemeChange` expects `'dark' | 'light' | 'system'`. Existing code casts via `(v) => { if (v) onThemeChange(v); }`. **Not in scope to fix** (surgical changes rule). Flag in commit body so future reviewers don't blame the split.

**Preserve old path:** **MANDATORY** keep `src/renderer/components/settings/sections/GeneralSection.tsx` deleted (use directory `index.tsx`). Importers:
- `src/renderer/components/settings/sections/index.ts:7` — `export { GeneralSection } from './GeneralSection';` resolves to dir's `index.tsx`. ✓ no change.
- `src/renderer/components/settings/SettingsView.tsx:16` — imports from barrel `./sections`. ✓ no change.

Verify no tests hard-import `GeneralSection.tsx` path. ✓ (no `GeneralSection.test.ts` exists in tree).

**Verify:**
- `bun run typecheck` clean
- `bun run lint:fix`
- `bun run test` green
- Manual smoke: open Settings → General, all 5 sub-sections render, theme toggle works, WSL modal opens (Windows env only — skip if Darwin), HTTP server toggle works.

**Commit:** `refactor(settings): sprint 90 - split GeneralSection.tsx`

---

## Per-sprint loop

```
1. Read full source file
2. Create new dir + files (move code verbatim — no rewrite)
3. Add explicit `pub use`/`export` per file
4. Update import sites if file path changes. Sprint 86 explicitly rewrites 2 importers. Sprints 87/88/89/90 use dir-as-module resolution (TS prefers `./Dir/index.tsx` when sibling `Dir.tsx` is deleted; Rust resolves `mod foo;` to `foo/mod.rs` when `foo.rs` is deleted). Always verify after deletion.
5. Run typecheck (TS sprints) or cargo check (Rust sprints)
6. Run tests
7. Run bun run lint:fix
8. git add . && git commit per memory feedback (one commit per sprint)
9. Move to next sprint
```

## Success criteria

- All 5 sprints land separate commits matching pattern `refactor(<scope>): sprint NN - split <file>`
- `bun run check` green after each TS sprint
- `cargo test` green after each Rust sprint
- No public API broken — all current imports still resolve
- Each new file < 400 LOC; if a sub-file exceeds 400, flag in commit message but do NOT force further splits

## Stop conditions

- `bun run check`/`cargo test` fails and root cause unclear → STOP, surface to user
- A split introduces import cycle → STOP, redesign
- File state has changed (line numbers off by >5) since plan was written → STOP, re-read and adjust
- Sprint 90 GeneralSection: if state coupling forces a fall-back split, document and proceed — do not pause

## Knip / quality gate

- `bun run quality` = `check + format:check + knip` — runs after each TS sprint
- Sprint 81-style shims cause knip noise (unused-file warnings) — tolerated where documented
- Sprints 86, 89: delete source file outright (no shim) → knip-clean expected
- Sprint 88: deletes `DateGroupedSessions.tsx` (sole consumer `Sidebar.tsx` resolves to `DateGroupedSessions/index.tsx`) → knip-clean expected
- Sprint 90: deletes `GeneralSection.tsx` (consumer is barrel `sections/index.ts`) → knip-clean expected
- Sprint 87: deletes `config/types.rs` (Rust `mod` declaration resolves to `types/mod.rs`) → N/A for knip

## Out of scope

- No behavior changes
- No "improvement" refactors beyond moving code
- No new tests (existing tests must stay green)
- No dependency upgrades
- No fix for project-level CLAUDE.md docs (next wave)
- Files in tail of >400 list (AIChatGroup, displayItemBuilder, SessionComparison, syntaxHighlighter, SessionSchedule etc.) — next wave (sprint 91+)

---

## Review Trail

### Metis Plan Consultant
- [x] Sprint 86: documented all 3 `searchIdCounter` usage sites (lines 399, 413/440, 550); explicit `bumpSearchId/currentSearchId` accessor + local `requestId` rename to avoid shadow
- [x] Sprint 86: added `isSearchDebugEnabled` to explicit `searchHelpers.ts` export list
- [x] Sprint 86: `createDetailPopoverPart` signature takes `(set, get)` for consistency (unused `get` marked `_get`)
- [x] Sprint 87: moved `default_code_block_theme`/`default_true` from `app.rs` to `general.rs` alongside `DisplayConfig` (serde path resolution stays local); added pre-split grep step to confirm cross-file usage
- [x] Sprint 88: `useFilteredSessions`/`useVirtualItems` made pure (NO inner `useStore`) — all store-derived inputs as props; parent owns the `useShallow` block and reads `bookmarks/activeFilters/sessionTagsMap` there
- [x] Sprint 88: added `visibleSessions` to `useVirtualItems` param list (needed by `contextSortedSessions`)
- [x] Sprint 89: explicit `use super::{...}` imports in `dispatcher.rs`; clarified no `super::types` import at dispatcher layer
- [x] Sprint 90: replaced "extract state too" with mandatory hook-ownership investigation; default to props-based extraction; same rule for `ServerSubsection`
- [x] Loop step 4: clarified dir-as-module resolution for sprints 87/88/89/90; sprint 86 explicit importer rewrite

### Architect Reviewer
- [x] Sprint 86: switched from sub-builder composition to sibling-action precedent (sprint 73/74 pattern); split into `expansionActions.ts`/`detailPopoverActions.ts`/`searchInternals.ts`/`searchActions.ts` + thin slice in `index.ts`
- [x] Sprint 86: fixed self-referential typo (`requestId !== currentSearchId()`)
- [x] Sprint 86: documented `ganttChartMode` orphan — drop it (no consumers, no interface entry)
- [x] Sprint 86: renamed `searchHelpers.ts` → `searchInternals.ts` to signal grab-bag
- [x] Sprint 87: pinned explicit imports in `merge.rs` (no `use super::*`)
- [x] Sprint 88: fused `useFilteredSessions` + `useVirtualItems` into single `useSessionListItems` hook
- [x] Sprint 88: documented `HeaderToolbar` prop-count smell as one-time cost
- [x] Sprint 89: corrected test block range (519-590 → 527-592)
- [x] Sprint 89: flagged dead comment at lines 524-525; keep verbatim per surgical rule
- [x] Sprint 89: renamed `simple.rs` → `misc.rs` for grab-bag clarity
- [x] Sprint 90: mandated full ClaudeRoot extraction (state + handlers + Dialog) — ~250 LOC sub
- [x] Sprint 90: same pattern for Server (state + handlers together)
- [x] Sprint 90: explicit success threshold (parent < 400 LOC, all subs < 400 LOC)
- [x] Sprint 90: flagged `safeConfig.general.theme` type-cast hole as out-of-scope (document in commit)
- [x] Knip/quality gate section added — each sprint's expected knip state documented
- [x] Sprint 86 verify: added grep step to confirm no test imports the slice file directly

### Security Auditor (if run)
- [ ] Pending

### Momus Plan Reviewer
- [x] Sprint 86: MUST-FIX — `test/renderer/store/storeTestUtils.ts:11` DOES import `createConversationSlice` directly; added to the rewrite list (now 3 importers, not 2); struck the false "no conversationSlice.test.ts exists" claim
- [x] Sprint 89: corrected test block — `#[cfg(test)]` at line 527, `mod tests {` at line 528, file ends at 592
- [x] Sprint 89: confirmed dead comment is single-line at 524 (525/526 blank); decision flipped to drop (orphan with no referent)
- [x] Sprint 90: corrected line ranges — Appearance 308-364, CodeBlocks 365-405, ClaudeRoot 406-471, Dialog 473-527, Server subsection 528-593 (ternary at 528 wraps Browser Access at 530 and Server at 568)
- [x] Sprint 87: added missing importer `ssh/commands.rs:146`; added pre-split `rg` verify step
