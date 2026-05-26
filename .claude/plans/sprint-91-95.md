# Sprint 91-95 Plan: File-Split Wave (autonomous)

## Context

Sprints 86-90 done (commits `d6b15a9`..`13e204f` + format sweep `93128d0`). User wants autonomous continuation, one commit per sprint. This batch tackles the next 5 files >400 LOC explicitly named as out-of-scope in sprint 86-90 plan: AIChatGroup, watcher.rs, SessionComparison, syntaxHighlighter, SessionSchedule.

Pattern from sprints 70-90: move code verbatim, preserve external imports via dir-as-module resolution or explicit `pub use`/`export`, no behavior changes, one commit per sprint.

## Targets

| Sprint | File | LOC | Surface |
|--------|------|-----|---------|
| 91 | `src/renderer/components/chat/AIChatGroup.tsx` | 584 | React component |
| 92 | `src-tauri/src/watcher.rs` | 518 | Rust file watcher |
| 93 | `src/renderer/components/chat/SessionComparison.tsx` | 574 | React component |
| 94 | `src/renderer/components/chat/viewers/syntaxHighlighter.ts` | 573 | TS util |
| 95 | `src/renderer/components/dashboard/SessionSchedule.tsx` | 568 | React component |

---

## Sprint 91 — Split AIChatGroup.tsx (584 LOC)

Top-level decls: `extractPrecedingSlashInfo` (L35), `formatDuration` (L64), `BookmarkToggle` subcomponent (L85), `AIChatGroupProps` (L114), `containsToolUseId` (L127), `AIChatGroupInner` (L157-582), `AIChatGroup = React.memo(...)` (L584).

**Output directory:** `src/renderer/components/chat/AIChatGroup/`

**Files:**
- `AIChatGroup/helpers.ts` — pure helpers: `extractPrecedingSlashInfo`, `formatDuration`, `containsToolUseId`. Import only what each fn needs (PrecedingSlashInfo type, UserGroup type, AIGroupDisplayItem type, `extractSlashInfo`/`isCommandContent` from contentSanitizer).
- `AIChatGroup/BookmarkToggle.tsx` — `BookmarkToggle` subcomponent verbatim from L85-112 + its imports (`useStore`, `cn`, `Bookmark`/`BookmarkCheck` from lucide).
- `AIChatGroup/useAIGroupTokens.ts` — extract two `useMemo` blocks (L268-302): `lastUsage` from `aiGroup.responses` + `{thinkingTokens, textOutputTokens}` from content blocks. Signature: `useAIGroupTokens(responses: AIGroup['responses']): { lastUsage: AssistantUsage | null; thinkingTokens: number; textOutputTokens: number }`. Pure — no store reads.
- `AIChatGroup/useAIGroupExpansion.ts` — extract `findHighlightedItemId` `useCallback` (L309-331) + both auto-expansion effects (L345-414). Signature: `useAIGroupExpansion({ aiGroupId, displayItems, highlightToolUseId, containsHighlightedError, shouldExpandForSearch, searchCurrentDisplayItemId, searchExpandedSubagentIds, expandDisplayItem, expandedItemIds }): void`. No return — side-effects only. **`displayItems` is `enhanced.displayItems` (EnhancedAIGroup shape — `AIGroupDisplayItem[]`), NOT raw `aiGroup.displayItems`.** Imports: `import { useCallback, useEffect, useRef } from 'react';` plus the `AIGroupDisplayItem` type.
- `AIChatGroup/index.tsx` — main component. Imports the 4 sibling modules. Keeps all `useStore`/`useShallow` reads, derived state (claudeMdStats/contextStats/phases/precedingSlash/enhanced/etc.), and the full JSX block (L424-580). End with `export const AIChatGroup = React.memo(AIChatGroupInner);` verbatim.

**Constraints:**
- DO NOT modify behavior or remove existing `useCallback`/`React.memo`/JSDoc comments (project rule bans new ones; existing ones are out-of-scope per surgical rule).
- The `useShallow` selector block (L193-205) and other store reads stay in `index.tsx` — splitting them changes selector semantics.
- `useAIGroupExpansion` and `useAIGroupTokens` MUST be plain hooks (call rules).

**Preserve old path:** delete `src/renderer/components/chat/AIChatGroup.tsx`. Sole consumer is `ChatHistoryItem.tsx:11` (`import { AIChatGroup } from './AIChatGroup'`) — TS resolves to dir's `index.tsx`. ✓

Verify before deleting:
```bash
grep -rn "from '.*AIChatGroup'" src --include="*.ts*" | grep -v "AIChatGroup/"
```

**Verify:**
- `bun run typecheck` clean
- `bun run lint:fix`
- `bun run test` green
- Manual smoke: load a session, expand/collapse AI group, search highlight reaches inner tool, bookmark toggle works

**Commit:** `refactor(chat): sprint 91 - split AIChatGroup.tsx`

---

## Sprint 92 — Split watcher.rs (518 LOC)

5 pub items: `FileChangeEvent` (struct, L18), `WatcherState` (struct + Default, L38/43), `resolve_claude_dir` (L143), `start_watcher` (L165), `stop_watcher` (L289). 3 private fns: `map_event_kind` (L57), `parse_project_file` (L71), `parse_todo_file` (L116), `retry_watch` (L307). Tests block L361-518.

External consumers (verified): `watcher::FileChangeEvent` (not used externally — internal-only), `watcher::WatcherState`, `watcher::resolve_claude_dir`, `watcher::start_watcher`, `watcher::stop_watcher`. Used from `lib.rs:39,50,180` and various commands/analysis modules via `use crate::watcher;`.

**Output directory:** `src-tauri/src/watcher/`

**Files:**
- `watcher/types.rs` — `FileChangeEvent` (L18-32) + `WatcherState` (L38-41) + `impl Default for WatcherState` (L43-50). Imports `serde::Serialize` and `notify_debouncer_full::{Debouncer, RecommendedCache}`.
- `watcher/parsers.rs` — `pub(crate) fn map_event_kind` (L57), `pub(crate) fn parse_project_file` (L71), `pub(crate) fn parse_todo_file` (L116). Uses `super::types::FileChangeEvent`. Imports `std::path::Path`, `notify::event::EventKind`. **Use `pub(crate)` (not `pub(super)`)** — `tests.rs` is a peer module to `parsers.rs` and metis flagged a visibility concern; `pub(crate)` is the safer, clearer scope for internal utilities.
- `watcher/lifecycle.rs` — `pub fn resolve_claude_dir` (L143), `pub fn start_watcher` (L165), `pub fn stop_watcher` (L289), `fn retry_watch` (L307). Explicit imports (no `super::*`): `use super::types::WatcherState; use super::parsers::{map_event_kind, parse_project_file, parse_todo_file};` plus existing `tauri`, `notify_debouncer_full`, `std::*`, `crate::commands::claude_root::ClaudeRoot`, `crate::notifications::commands::detect_and_notify`, `crate::logging::Redact`.
- `watcher/mod.rs` — `mod types; mod parsers; mod lifecycle;` + `pub use types::{FileChangeEvent, WatcherState}; pub use lifecycle::{resolve_claude_dir, start_watcher, stop_watcher};` + `#[cfg(test)] mod tests;`.
- `watcher/tests.rs` — `#[cfg(test)] mod tests` block from L361-518 verbatim. Replace `use super::*;` with explicit imports needed by tests: `use super::parsers::{map_event_kind, parse_project_file, parse_todo_file}; use super::lifecycle::resolve_claude_dir; use notify::event::EventKind; use std::path::Path;`. Test file itself wraps as `#[cfg(test)] mod tests_inner { ... }` — actually simpler: just put body of `mod tests {}` directly in `tests.rs` (file becomes the module). `mod.rs` declares `#[cfg(test)] mod tests;`.

**Module declaration:** `pub mod watcher;` in `src-tauri/src/lib.rs:16` — unchanged. `watcher/mod.rs` provides the module.

**Preserve old path:** delete `src-tauri/src/watcher.rs`. Rust resolves `pub mod watcher;` to `watcher/mod.rs` when `watcher.rs` doesn't exist.

**Verify:**
- `cargo check` from `src-tauri/`
- `cargo test watcher` — all 13 tests at L366-517 must pass
- `cargo test` full suite green
- `bun run build` — Tauri build resolves watcher module

**Commit:** `refactor(watcher): sprint 92 - split watcher.rs`

---

## Sprint 93 — Split SessionComparison.tsx (574 LOC)

5 top-level fns/components + 4 interfaces. Decls:
- L36-46: `SessionComparisonProps`, `MetricRowProps`
- L48-67: `formatCost`, `MetricRow`
- L70-82: `countTools`
- L84-244: `SessionComparison` main (~160 LOC)
- L248-296: `TurnSummary` interface, `extractTurns`
- L299-303: `isDivergent`
- L306-458: `ConversationDiffProps`, `ConversationDiff` component (~150 LOC)
- L460-468: `MultiConversationDiffProps`, `turnSignature`
- L470-end: `MultiConversationDiff` component (~100 LOC)

**Output directory:** `src/renderer/components/chat/SessionComparison/`

**Files:**
- `SessionComparison/MetricRow.tsx` — `MetricRowProps` interface (L40-46), `formatCost` helper (L48-52), `MetricRow` component (L54-67). Imports `cn`, lucide types as needed.
- `SessionComparison/turnUtils.ts` — `countTools` (L70-82), `TurnSummary` interface (L248-253), `extractTurns` (L256-296), `isDivergent` (L299-303), `turnSignature` (L465-468). Imports `SessionDetail`, `Chunk` types. **Do NOT re-export `TurnCell`** — consumers import it directly from `../SessionComparisonColumn` (metis-corrected — avoid indirection layer).
- `SessionComparison/ConversationDiff.tsx` — `ConversationDiffProps` (L306-309), `ConversationDiff` component (L311-458). Imports from `./turnUtils` (`extractTurns`, `isDivergent`, `TurnSummary`).
- `SessionComparison/MultiConversationDiff.tsx` — `MultiConversationDiffProps` (L460-463), `MultiConversationDiff` component (L470-end). Imports `turnSignature` from `./turnUtils`; imports `TurnCell` directly from `../SessionComparisonColumn` (same path the original L31 import used).
- `SessionComparison/index.tsx` — main `SessionComparison` component (L84-244). Imports `MetricRow` from `./MetricRow`, `countTools` from `./turnUtils`, `ConversationDiff` from `./ConversationDiff`, `MultiConversationDiff` from `./MultiConversationDiff`.

**Investigation step BEFORE editing:** read full file (esp. L300-470 boundary) to confirm:
1. `ConversationDiff` consumes `extractTurns`, `isDivergent`, `TurnSummary` from this file (not external)
2. `MultiConversationDiff` consumes `turnSignature` + `TurnCell` — `TurnCell` already comes from sibling `./SessionComparisonColumn` (L31 import), keep that import in `MultiConversationDiff.tsx`
3. Main `SessionComparison` consumes `countTools` + `MetricRow` + both diff components

**Constraints:**
- DO NOT rename or modify components.
- DO NOT add `useCallback`/`React.memo` (project rule).
- Existing JSDoc comments preserved verbatim (surgical rule).

**Preserve old path:** delete `src/renderer/components/chat/SessionComparison.tsx`. Sole consumer is `PaneContent.tsx:14` lazy import: `import('../chat/SessionComparison').then((m) => ({ default: m.SessionComparison }))`. TS resolves `'../chat/SessionComparison'` to dir's `index.tsx` when file is deleted. ✓

Verify before deleting:
```bash
grep -rn "from '.*chat/SessionComparison'" src --include="*.ts*" | grep -v "SessionComparison/"
```

**Verify:**
- `bun run typecheck` clean
- `bun run lint:fix`
- `bun run test` green
- Manual smoke: open two sessions in comparison view; metrics, diff, multi-compare render

**Commit:** `refactor(chat): sprint 93 - split SessionComparison.tsx`

---

## Sprint 94 — Split syntaxHighlighter.ts (573 LOC)

Pure module. Two top-level: `KEYWORDS` const (L6-403, ~398 LOC), `highlightLine` exported fn (L413-573, ~160 LOC). Plus 2 mutations at L406-407 (`KEYWORDS.tsx = KEYWORDS.typescript; KEYWORDS.jsx = KEYWORDS.javascript;`).

External consumers (verified):
- `CodeBlockViewer.tsx:9` — `import { highlightLine } from './syntaxHighlighter';`
- `MarkdownViewer.tsx:122` — uses `highlightLine` (verify import line by grep)

**Output directory:** `src/renderer/components/chat/viewers/syntaxHighlighter/`

**Files:**
- `syntaxHighlighter/keywords.ts` — `KEYWORDS: Record<string, Set<string>>` object literal (L6-403) + the 2 alias lines (L406-407). `export const KEYWORDS = (() => { const k: Record<string, Set<string>> = {...}; k.tsx = k.typescript; k.jsx = k.javascript; return k; })();` — preserves the alias semantics inside a single export. **Preserve the `const k: Record<string, Set<string>>` type annotation inside the IIFE** (metis-flagged — type inference change otherwise). **NO React import** — keywords are pure data.
- `syntaxHighlighter/highlightLine.ts` — `highlightLine` function (L413-573) verbatim. Imports: `import React from 'react';` and `import { KEYWORDS } from './keywords';`. React import lives here only (not in keywords.ts).
- `syntaxHighlighter/index.ts` — `export { highlightLine } from './highlightLine';` (only public symbol). KEYWORDS stays private to the dir.

**Alternative considered + rejected:** Splitting KEYWORDS into per-language files (typescript.ts, python.ts, etc.) — over-engineering for static data with no per-language consumer; reject.

**Preserve old path:** delete `src/renderer/components/chat/viewers/syntaxHighlighter.ts`. TS resolves `from './syntaxHighlighter'` to dir's `index.ts`. ✓

Verify before deleting:
```bash
grep -rn "from '.*viewers/syntaxHighlighter'" src --include="*.ts*" | grep -v "syntaxHighlighter/"
```

**Verify:**
- `bun run typecheck` clean
- `bun run lint:fix`
- `bun run test` green
- Manual smoke: render markdown with code blocks (TS/Python/SQL), verify highlighting unchanged

**Commit:** `refactor(viewers): sprint 94 - split syntaxHighlighter.ts`

---

## Sprint 95 — Split SessionSchedule.tsx (568 LOC)

Multi-component file: 1 main + 3 sub-components + helpers. Decls:
- L17-22: `SessionScheduleProps`
- L24-43: date helpers (`isSameDay`, `isTodayDate`, `formatHourLabel`)
- L45-53: `PositionedEvent` type
- L54-86: `resolveOverlaps`
- L88-122: `DayEventBlock` component
- L124-128: `DayViewProps`
- L129-130: `HOURS`, `SLOT_HEIGHT` consts
- L132-343: `DayView` component (~210 LOC)
- L344-353: `MonthViewProps`, `MAX_EVENTS_PER_DAY`, `WEEKDAY_LABELS` consts
- L354-360: `MonthDayCellProps`
- L361-407: `MonthDayCell` component
- L408-552: `MonthView` component (~144 LOC)
- L554-end: `SessionSchedule` main (~14 LOC dispatcher)

**Output directory:** `src/renderer/components/dashboard/SessionSchedule/`

**Files:**
- `SessionSchedule/constants.ts` — `HOURS = Array.from(...)`, `SLOT_HEIGHT = 40`, `MAX_EVENTS_PER_DAY = 3`, `WEEKDAY_LABELS = [...]`.
- `SessionSchedule/dateUtils.ts` — `isSameDay`, `isTodayDate`, `formatHourLabel` (L24-43). Pure date helpers.
- `SessionSchedule/types.ts` — `SessionScheduleProps`, `PositionedEvent`, `DayViewProps`, `MonthViewProps`, `MonthDayCellProps`. Single file for component prop types to avoid 5 micro-files. **MUST `import type { ScheduleEvent } from '@renderer/hooks/useAnalyticsData';`** — `PositionedEvent.event: ScheduleEvent` requires it (metis-flagged; verify exact path during execution by reading current L17-22 import in the source file).
- `SessionSchedule/resolveOverlaps.ts` — `resolveOverlaps(events: PositionedEvent[]): PositionedEvent[]` (L54-86). Imports `PositionedEvent` from `./types`.
- `SessionSchedule/DayEventBlock.tsx` — `DayEventBlock` (L88-122). Imports from `./types`.
- `SessionSchedule/DayView.tsx` — `DayView` (L132-343). Imports `HOURS`, `SLOT_HEIGHT` from `./constants`; `DayViewProps`, `PositionedEvent` from `./types`; `isSameDay`, `isTodayDate`, `formatHourLabel` from `./dateUtils`; `resolveOverlaps` from `./resolveOverlaps`; `DayEventBlock` from `./DayEventBlock`.
- `SessionSchedule/MonthDayCell.tsx` — `MonthDayCell` (L361-407). Imports `MonthDayCellProps`, `PositionedEvent` from `./types`; `MAX_EVENTS_PER_DAY` from `./constants`; `isTodayDate` from `./dateUtils`.
- `SessionSchedule/MonthView.tsx` — `MonthView` (L408-552). Imports `MonthViewProps`, `PositionedEvent` from `./types`; `WEEKDAY_LABELS` from `./constants`; `isSameDay` from `./dateUtils`; `MonthDayCell` from `./MonthDayCell`.
- `SessionSchedule/index.tsx` — main `SessionSchedule` dispatcher (L554-end). Imports `SessionScheduleProps` from `./types`; `DayView` from `./DayView`; `MonthView` from `./MonthView`.

**Constraints:**
- DO NOT modify behavior; mechanical extraction only.
- Existing comments preserved.
- No new `useCallback`/`React.memo` (project rule).

**Investigation step BEFORE editing:** read full L1-568 to confirm:
1. No top-level state crosses sub-component boundaries (each sub-component is self-contained per L132/L361/L408 boundaries)
2. `PositionedEvent` is shared between `resolveOverlaps`, `DayEventBlock`, `DayView`, `MonthDayCell`, `MonthView` — confirms placement in `types.ts`
3. `events` prop type comes from caller (probably `ScheduleEvent` from a sibling). Confirm by reading L17-22 and matching at consumer site.

**Preserve old path:** delete `src/renderer/components/dashboard/SessionSchedule.tsx`. Sole consumer is `AnalyticsDashboard.tsx:63` (`import { SessionSchedule } from './SessionSchedule';`) — TS resolves to dir's `index.tsx`. ✓

Verify before deleting:
```bash
grep -rn "from '.*dashboard/SessionSchedule'" src --include="*.ts*" | grep -v "SessionSchedule/"
```

**Verify:**
- `bun run typecheck` clean
- `bun run lint:fix`
- `bun run test` green
- Manual smoke: open Dashboard → schedule view, toggle day/month range, verify rendering identical

**Commit:** `refactor(dashboard): sprint 95 - split SessionSchedule.tsx`

---

## Per-sprint loop

```
1. Read full source file (line counts, decl boundaries)
2. Create new dir + files (move code verbatim — no rewrite)
3. Add explicit `pub use`/`export` per file
4. Delete old source file (dir-as-module resolution kicks in; TS prefers `./Dir/index.tsx`/`./Dir/index.ts` when sibling file is deleted; Rust resolves `mod foo;` to `foo/mod.rs`)
5. Run typecheck (TS sprints) or cargo check (Rust sprint 92)
6. Run tests
7. Run bun run lint:fix
8. git add . && git commit per memory feedback (one commit per sprint)
9. Move to next sprint
```

## Success criteria

- All 5 sprints land separate commits matching `refactor(<scope>): sprint NN - split <file>`
- `bun run check` green after each TS sprint
- `cargo test` green after sprint 92
- No public API broken — all current imports still resolve
- Each new file < 400 LOC; if a sub-file exceeds 400, flag in commit message but do NOT force further splits
- Sprint 91 parent (`index.tsx`) target: ~420 LOC after extracting helpers + BookmarkToggle + 2 hooks (metis estimate: 584 − 30 − 28 − 35 − 70 ≈ 421). This **exceeds the 400 typical** but is under the 800 hard limit. **Pre-acknowledged in commit body**: parent stays at ~420 because remaining content is the single JSX render block (L424-580 ≈ 156 LOC) + store reads/memos (~40 LOC) which cannot extract without artificial seams. Acceptable.
- Sprint 93 parent target: ~165 LOC (main component only)
- Sprint 95 parent target: ~14 LOC (dispatcher only)

## Stop conditions

- `bun run check`/`cargo test` fails and root cause unclear → STOP, surface to user
- A split introduces import cycle → STOP, redesign
- File state has changed (line numbers off by >10) since plan was written → STOP, re-read and adjust

## Knip / quality gate

- `bun run quality` = `check + format:check + knip` — run after each TS sprint
- Sprints 91, 93, 94, 95: delete source file (dir resolves) → knip-clean expected
- Sprint 92 (Rust-only): **do NOT run `bun run quality`** — use `cargo check` + `cargo test` from `src-tauri/` only. `bun run build` for final Tauri-link check. Knip is TS-only and pollutes signal.

## Out of scope

- No behavior changes
- No "improvement" refactors beyond moving code
- No new tests (existing tests stay green)
- No dependency upgrades
- No removal of pre-existing `useCallback`/`React.memo`/JSDoc (surgical rule — flag for next wave if needed)
- Files in tail of >400 list (sessionSlice, store/index, useTabNavigationController, ChatHistory, SubagentItem etc.) — next wave (sprint 96+)

---

## Review Trail

### Metis Plan Consultant
- [x] Sprint 91: added `expandedItemIds` to `useAIGroupExpansion` parameter type (effects at L345-414 reference it)
- [x] Sprint 91: clarified `displayItems` param means `enhanced.displayItems` (EnhancedAIGroup shape, not raw aiGroup); added explicit React import list to hook file
- [x] Sprint 91: pre-acknowledged `index.tsx` likely lands ~420 LOC (above typical 400 but well under 800 hard limit) — rationale documented for commit body
- [x] Sprint 92: switched parser fns from `pub(super)` to `pub(crate)` — safer for `tests.rs` peer access (metis was overcautious but the fix is clearer)
- [x] Sprint 93: `MultiConversationDiff.tsx` imports `TurnCell` directly from `../SessionComparisonColumn` (no re-export indirection)
- [x] Sprint 94: React import only in `highlightLine.ts` (keywords.ts is pure data); preserve `const k: Record<string, Set<string>>` type annotation inside IIFE
- [x] Sprint 95: `types.ts` must import `ScheduleEvent` from `@renderer/hooks/useAnalyticsData` (verify exact path at execution)
- [x] All sprints: sprint 92 explicitly skips `bun run quality` (knip is TS-only); uses `cargo check + cargo test + bun run build`

### Architect Reviewer
- [x] All sprint boundaries approved — seams cut at natural concept boundaries; no JSX-dump, no god-file, no artificial coupling
- [x] Sprint 91 `useAIGroupExpansion` flat 9-param signature accepted (precedent from sprint 88 `HeaderToolbar`); `findHighlightedItemId` correctly inlined into the hook (not a separate file)
- [x] Sprint 92 `retry_watch` correctly bundled in `lifecycle.rs` (same state-machine concern as `start_watcher`/`stop_watcher`)
- [x] Sprint 92 execution discipline flag: read L361-518 carefully when replacing `use super::*;` in tests.rs to enumerate every needed import — do not miss any
- [x] Sprint 94 IIFE pattern for KEYWORDS confirmed as most idiomatic TS solution (alternatives break type inference or immutability contract)
- [x] Sprint 95 `types.ts` consolidation approved (dir-scoped, cohesive, same call as sprint 87)
- [x] Sprint 95 `resolveOverlaps.ts` as separate file approved (matches pure-helpers-as-siblings pattern; sole consumer DayView, but separation aids isolation)
- [x] No import-cycle risk across any sprint — all dir-internal deps are linear (types → utils → components → index)

### Security Auditor
- [ ] Skipped — pure file-split refactor, no security surface

### Momus Plan Reviewer
- [x] All 5 source files confirmed at claimed LOC (584/518/574/573/568)
- [x] All cited declaration boundaries verified within 1-line tolerance
- [x] Consumer enumeration verified: `ChatHistoryItem.tsx:11`, `lib.rs:16/39/50/180` + commands/analysis/notifications/analytics, `PaneContent.tsx:14` lazy, `CodeBlockViewer.tsx:9` + `MarkdownViewer.tsx`, `AnalyticsDashboard.tsx:63`
- [x] Sprint 95: `ScheduleEvent` import confirmed at `SessionSchedule.tsx:13` from `@renderer/hooks/useAnalyticsData` — metis assumption correct
- [x] Sprint 94: `MarkdownViewer.tsx` `highlightLine` is imported at L17 (plan said L122 — that's the usage site, not import). Non-blocking, grep step catches.
- [x] No contradictions across sprints; tasks executable autonomously
