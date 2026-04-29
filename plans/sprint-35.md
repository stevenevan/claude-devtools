# Sprint 35 — Saved Filter Presets

## Context
Continuation of Phase C (Customization & Workflow). Existing `AdvancedFilterPanel`
exposes a `SessionFilterState` with 7 fields. Today users must reconfigure
filters from scratch each session. Goal: persistent, named filter presets +
keyboard quick-activation + lifecycle (rename, delete, set default).

## Scope (in)
1. Persisted preset store (Rust config + frontend slice).
2. `FilterPresetBar.tsx` — chip list above `AdvancedFilterPanel` with "Save current".
3. Sequence shortcut: `g` then `1..9` activates preset by index (within 100ms window).
4. Per-chip context menu: rename, delete, set default.
5. Default preset auto-applied on sidebar mount (only if no filters yet active).

## Scope (out)
- Cross-device sync (none of the existing config syncs).
- Multi-select / merging presets.
- Validation/migration on `SessionFilterState` schema bumps (revisit if shape changes).

## Files

### Backend (Rust)
- `src-tauri/src/config/types.rs`
  - New: `FilterPreset { id: String, name: String, filter: serde_json::Value, created_at: f64 }`
  - Add to `SessionsConfig`: `#[serde(default)] pub filter_presets: Vec<FilterPreset>`
  - Add to `SessionsConfig`: `#[serde(default)] pub default_filter_preset_id: Option<String>`
- `src-tauri/src/config/commands.rs`
  - `config_add_filter_preset(name, filter)` → returns id
  - `config_remove_filter_preset(preset_id)`
  - `config_rename_filter_preset(preset_id, name)`
  - `config_set_default_filter_preset(preset_id: Option<String>)`
- `src-tauri/src/lib.rs` — register the 4 new commands.

### Frontend
- `src/renderer/store/slices/configSlice.ts`
  - Presets live in `appConfig.sessions.filterPresets` — **do NOT** mirror into a separate slice field. Read from `appConfig`.
  - Add 4 thin action wrappers calling api (no per-call loading/error state — match `toggleBookmark` fire-and-forget pattern).
- `src/renderer/store/slices/sessionSlice.ts`
  - Add **`applyFilterPreset(filter: SessionFilterState)`** — atomic single `set({ activeFilters: { ...filter } })` that replaces (not merges) so absent fields are cleared. Lives **in sessionSlice** alongside existing `setFilter`/`clearFilters` (same domain).
- `src/renderer/api/tauriClient.ts` + `src/shared/types/api.ts`
  - 4 new methods on `config.*`: `addFilterPreset`, `removeFilterPreset`, `renameFilterPreset`, `setDefaultFilterPreset`.
- `src/renderer/components/sidebar/FilterPresetBar.tsx` (new, ~150 lines)
  - Chip row: each chip shows `name`, optional star (default), context-menu trigger.
  - **Index badge `1`–`9` rendered only on first 9 chips** (presets beyond that have no shortcut binding — explicit UI affordance).
  - "Save current" button (disabled when filters empty).
  - On chip click → call `sessionSlice.applyFilterPreset(preset.filter)` after defensive shape validation.
- `src/renderer/components/sidebar/PresetChip.tsx` (new, ~80 lines)
  - Pre-extracted from FilterPresetBar to keep both files under 400-line cap. Owns chip render, context menu, label/star rendering.
- `src/renderer/utils/filterPresetSerialization.ts` (new, ~40 lines)
  - `parseFilterPresetEntry(raw: unknown): FilterPresetEntry | null` — type-validates each of the 7 `SessionFilterState` fields. Drops unknown keys silently. On shape mismatch, returns `null` and emits a single `console.warn`. Also export `__resetForTests()` if module-level cache is added.
- `src/renderer/components/sidebar/AdvancedFilterPanel.tsx`
  - Render `<FilterPresetBar />` above the expand toggle.
- `src/renderer/hooks/useKeyboardShortcuts.ts`
  - Add `g`-prefix sequence handler:
    - On bare `g` (no mod, no input/textarea focus), set **module-level `let pendingGSequence: number | null = null`** to `Date.now()`.
    - Window = **750ms** (not 100ms, not 1.5s). Next key `1..9` within 750ms → apply preset at that index, reset flag. Other key or timeout → reset flag.
    - **Do NOT** add a Zustand store field for this state.
- `src/renderer/hooks/useDefaultFilterPreset.ts` (new, ~40 lines)
  - Custom hook with **`useEffect(() => { ... }, [])`** that fires once on mount.
  - Guard with **module-level `let didAutoApply = false`** — survives StrictMode double-effect; natural reset on app reload.
  - Export **`__resetForTests()`** so test files can `vi.resetModules()` cleanly between cases.
  - Mounted from `src/renderer/components/layout/Sidebar.tsx` (already mounts `AdvancedFilterPanel` at line 110).

### Types
- `src/shared/types/notifications.ts` (where `AppConfig` interface lives — line 227)
  - Extend `AppConfig.sessions` with `filterPresets: FilterPresetEntry[]` and `defaultFilterPresetId?: string`.
  - Export `FilterPresetEntry { id: string; name: string; filter: SessionFilterState; createdAt: number }`.

### Tests
- `test/main/services/...` not applicable; backend changes are pure data — covered by serde round-trip.
- `test/renderer/store/configSlice.test.ts` — unit test save→list→remove→rename→setDefault round trip with mocked api.
- `test/renderer/utils/filterPresetSerialization.test.ts` (new) — round-trip a `SessionFilterState` containing all 7 fields with a non-empty `tags` array AND a malformed-input case asserting `parseFilterPresetEntry` returns `null` (graceful fallback, not partial application).

## Implementation Order
1. Rust types + commands + lib.rs registration.
2. `cargo check` clean.
3. Frontend api typings + tauriClient methods.
4. `bun run typecheck` clean.
5. configSlice action wrappers.
6. FilterPresetBar component + AdvancedFilterPanel integration.
7. Keyboard `g` sequence handler.
8. Default preset auto-apply on sidebar mount.
9. Tests.
10. `bun run check` clean.
11. Manual QA in `bun run dev`:
    - Save preset → reload app → preset persists.
    - `g` then `1` activates first preset (input latency ≤100ms; 750ms = sequence window before reset).
    - Set default → relaunch → default applied when no filters set.
    - Rename, delete via context menu.

## Verification (mandatory — gate the commit)
- `bun run typecheck` exits 0.
- `bun run lint:fix` exits 0 with no residual warnings.
- `cargo check` (from `src-tauri/`) exits 0.
- `bun run test` exits 0; new tests must include round-trip covering **all 7 `SessionFilterState` fields including a non-empty `tags` array**.
- Manual: end-to-end preset CRUD + `g`-then-`1` keyboard activation in dev build (input latency target ≤100ms, distinct from the 750ms sequence window).

## Risks / Open Questions
- **Schema coupling**: `filter` stored as opaque JSON Value avoids backend re-parse but means a future `SessionFilterState` field rename leaks bad data into UI. Mitigation: deserialize defensively in frontend (best-effort), drop unknown keys silently.
- **Sequence shortcut conflict**: `g` is currently unused in the global handler (verified). Skip if input/textarea focused, exactly like other bare-key handlers.
- **Default preset auto-apply race**: Apply only on first sidebar mount per app launch (use a ref or boolean in store) so user re-clearing filters doesn't re-trigger.

## Review Trail

### Metis Plan Consultant
- [x] Preset apply = `clearFilters()` + `setFilter(preset.filter)` — atomic via `applyFilterPreset` action.
- [x] `g`-sequence window normalized to 750ms; 100ms = input latency target only.
- [x] `pendingGSequence` = module-level `let` in hook (not store, not ref).
- [x] Default-preset auto-apply guard = module-level `let didAutoApply` in `useDefaultFilterPreset.ts`.
- [x] No `filterPresets` field in `sessionSlice`; presets live only in `configSlice` / `appConfig`.
- [x] No per-CRUD loading/error state — match `toggleBookmark` fire-and-forget.
- [x] Out-of-scope explicit: no import/export, no drag-reorder, no conflict resolution.
- [x] Round-trip test must cover all 7 `SessionFilterState` fields including non-empty `tags`.

### Architect Reviewer (auto-selected)
- [x] `applyFilterPreset` moved to `sessionSlice` (matches domain ownership; configSlice stays config-only).
- [x] Module-level `pendingGSequence` / `didAutoApply` accepted; `__resetForTests()` export added for testability.
- [x] `default_filter_preset_id: Option<String>` kept (enforces "at most one" by construction).
- [x] 4 dedicated commands kept (list mutations, not patch merges).
- [x] Defensive `parseFilterPresetEntry()` deserializer added to harden opaque `serde_json::Value` storage; round-trip test extended for malformed input.
- [x] Default-preset auto-apply uses `useEffect([], …)` with module-level idempotency flag (handles StrictMode).
- [x] Sprint 33 sequence-primitive check: none exists; new `g`-prefix logic confirmed needed.
- [x] Index badge `1..9` rendered only on first 9 chips (clear UI affordance for unbounded preset count).
- [x] `PresetChip.tsx` pre-extracted to keep both files under 400-line cap.

### Momus Plan Reviewer
- [x] All file/symbol existence verified.
- [x] `AppConfig` location corrected to `src/shared/types/notifications.ts`.
- [x] Sidebar mount point named: `src/renderer/components/layout/Sidebar.tsx`.
- [x] Step 11 QA wording clarified to disambiguate latency target vs sequence window.
- [x] Verdict: READY.
