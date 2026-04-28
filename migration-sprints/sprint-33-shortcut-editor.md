# Sprint 33 — Week of 2026-08-17 | Customization

## Keyboard Shortcut Editor

### Deliverables
1. **Mutable shortcut map** — extract fixed map from `useKeyboardShortcuts.ts` into `shortcutRegistry.ts`. Persist overrides in `configSlice`.
2. `ShortcutsSettings.tsx` — table of action / default / current; click to rebind (captures next key combo).
3. Conflict detection: disallow duplicate combos across actions.
4. "Reset to defaults" per-row + global.

### Files
- `src/renderer/hooks/useKeyboardShortcuts.ts`
- `src/renderer/shortcuts/shortcutRegistry.ts` (new)
- `src/renderer/components/settings/sections/ShortcutsSettings.tsx` (new)
- `src/renderer/store/slices/configSlice.ts`
- `src-tauri/src/config/types.rs`

### Dependencies
- Sprint 11 (shortcut reference)
- Sprint 12 (help panel links)

### Verification
- Unit test: conflict detector flags duplicates; reset restores default
- Manual: rebind works; persists; help panel reflects new binding
