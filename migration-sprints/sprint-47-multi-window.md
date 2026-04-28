# Sprint 47 — Week of 2026-11-23 | Hardening

## Multi-Window / Multi-Pane Session Support

### Deliverables
1. **Cross-window state bus** — new `src/renderer/ipc/windowBus.ts` using `@tauri-apps/api/event` emit/listen. Opt-in subscription per topic.
   - **Every message tagged with `{ originWindowId, topic, seq }`** — listeners ignore self-origin emits; ordering enforced by topic-local Lamport counter.
   - **50ms coalesce per topic** (last-write-wins) — prevents message storm from scroll/keyboard navigation bursts.
   - **Config writes never broadcast raw** — they round-trip through Rust; Rust re-emits canonical `config_updated` event to all windows.
2. **Pop-out window** — right-click tab → "Open in new window"; `open_window(seed_state)` command boots a fresh `WebviewWindow`. **Ready handshake**: new window sends `window_ready { id }` before host emits the seed; seed is an event, not a blob passed to the constructor.
3. **Pane split** — within a window, horizontal/vertical split with independent `paneSlice` sub-tree. Draggable divider (persisted split ratio).
4. **Follow-mode toggle per pane** — when on, pane mirrors active selection from bus; when off, pane holds its own selection.

### Files
- `src-tauri/src/commands/window.rs` (new submodule inside post-sprint-44 `commands/` dir — hosts `open_window`, `emit_config_updated`)
- `src-tauri/src/commands/mod.rs` (register submodule)
- `src-tauri/src/lib.rs` (register new commands)
- `src/renderer/ipc/windowBus.ts` (new — tag, coalesce, dedupe)
- `src/renderer/store/slices/paneSlice.ts` (split tree model)
- `src/renderer/components/layout/PaneSplitter.tsx` (new — drag divider)
- `src/renderer/components/layout/PaneContainer.tsx` (mount splitter; existing pane host)
- `src/renderer/components/layout/TabbedLayout.tsx` (wire pop-out trigger from tab context menu)

### Dependencies
- Existing `paneSlice`, tab system
- Sprint 44 (workspace split), sprint 45 (SSH), sprint 46 (observability) all shipped

### Verification
- Unit test: self-origin emits filtered; Lamport ordering correct across 2 bursty windows
- Unit test: topic coalesce merges 5 rapid selection changes to 1 within 50ms window
- Manual: open 2nd window; selection in A reflects in B within 150ms when follow on; follow-off isolation holds
- Manual: drag divider smooth; ratio restored after reload
