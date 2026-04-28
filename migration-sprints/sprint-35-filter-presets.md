# Sprint 35 — Week of 2026-08-31 | Customization

## Saved Filter Presets

### Deliverables
1. **Preset store** — `{ id, name, filter: AdvancedFilter }` in `configSlice`, persisted.
2. `FilterPresetBar.tsx` above `AdvancedFilterPanel` — chip list of presets + "Save current" button.
3. Keyboard: `g` then `1..9` activates preset by index.
4. Context menu: rename, delete, set default (loaded on sidebar open).

### Files
- `src/renderer/components/sidebar/FilterPresetBar.tsx` (new)
- `src/renderer/components/sidebar/AdvancedFilterPanel.tsx`
- `src/renderer/store/slices/configSlice.ts`
- `src/renderer/hooks/useKeyboardShortcuts.ts`
- `src-tauri/src/config/types.rs`

### Dependencies
- Sprint 7 (advanced filters)

### Verification
- Unit test: preset save/load round-trip preserves all filter fields
- Manual: `g` then `1` applies preset within 100ms
