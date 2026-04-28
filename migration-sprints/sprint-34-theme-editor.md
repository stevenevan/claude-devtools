# Sprint 34 — Week of 2026-08-24 | Customization

## Theme Editor + Custom CSS-Variable Themes

### Deliverables
1. **Theme config schema** — map of CSS-variable name → colour. Ships built-ins (`dark-default`, `light-default`); user can clone and edit.
2. `ThemeEditor.tsx` — colour pickers grouped by category (surface, text, chat, code, etc.); live preview.
3. Import/export theme as JSON.
4. Runtime apply: `applyTheme()` sets `<style>` overrides on `:root`.

### Files
- `src/renderer/components/settings/sections/ThemeEditor.tsx` (new)
- `src/renderer/hooks/useTheme.ts` (extend)
- `src/renderer/utils/themeApplier.ts` (new)
- `src/renderer/store/slices/configSlice.ts`
- `src-tauri/src/config/types.rs` (persist themes)

### Dependencies
- Existing CSS variables in `src/renderer/index.css`

### Verification
- Unit test: apply/revert returns DOM to baseline
- Manual: imported theme survives restart; preview reflects changes in <50ms
