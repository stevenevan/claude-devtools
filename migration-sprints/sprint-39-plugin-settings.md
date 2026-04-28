# Sprint 39 — Week of 2026-09-28 | Extensibility

## Plugin Settings UI + Example Plugins (Part 2 of 2)

### Deliverables
1. `PluginsSettings.tsx` — list discovered plugins, enable/disable toggle, per-plugin API permission summary, load errors surfaced inline.
2. **Two example plugins** shipped under `examples/plugins/`:
   - `word-count.js` — registers a panel showing word count across chunks
   - `theme-toggle.js` — registers a command that flips dark/light mode
3. **API reference doc** — `docs/plugins.md`: lists all public `PluginAPI` methods, quota (1 panel / 10 commands / 5 menu items per plugin).
4. Enable/disable persists in `configSlice`; sandbox worker torn down on disable.

### Files
- `src/renderer/components/settings/sections/PluginsSettings.tsx` (new)
- `src/renderer/store/slices/configSlice.ts` (enabled-plugin ids)
- `src-tauri/src/config/types.rs`
- `examples/plugins/word-count.js` (new)
- `examples/plugins/theme-toggle.js` (new)
- `docs/plugins.md` (new)

### Dependencies
- Sprint 38 (sandbox host must exist)

### Verification
- Manual: toggle plugin on → panel/command appears; toggle off → cleaned up, no leaks in DevTools memory snapshot
- Unit test: disable tears down worker within 100ms
