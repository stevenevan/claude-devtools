# Sprint 38 — Week of 2026-09-21 | Extensibility

## Plugin Sandbox Host + Typed API (Part 1 of 2)

### Deliverables
1. **Typed plugin API surface** — `src/renderer/plugins/pluginApi.ts` exports read-only types: `PluginAPI { apiVersion: "1.0", registerPanel, registerCommand, registerContextMenuItem, subscribeStoreSlice }`. **Every plugin must declare `apiVersion` in its manifest**; host rejects mismatched majors (architect directive #9).
2. **Sandbox loader** — `pluginHost.ts`: reads JS from `~/.claude-devtools/plugins/*.js`; executes inside a `Worker` (classic; no module imports). postMessage-based RPC bridge. Host splits across `pluginHost.ts` + `sandboxBridge.ts` + `capabilityGate.ts` to stay under the 400-line soft cap (architect directive #7).
3. **Capability gating — allowlist, not denylist** — Worker boots with a preamble that deletes everything off `self` except an explicit allowlist (`postMessage`, `addEventListener`, `console.log`, `setTimeout`, `clearTimeout`). Test asserts the allowlist — no open-ended "this is undefined" checks.
4. **Subscription quota** — `subscribeStoreSlice` per-plugin cap: 5 concurrent subscriptions, payload size ≤64KB per message (architect directive #9).
5. **Teardown contract** — on disable, pending RPCs resolve with `PluginDisposedError`; worker terminated within 100ms.
6. **Rust plugin discovery** — `plugins.rs` lists `.js` files in plugin dir; no execution on Rust side.

### Files
- `src/renderer/plugins/pluginApi.ts` (new)
- `src/renderer/plugins/pluginHost.ts` (new — lifecycle)
- `src/renderer/plugins/sandboxBridge.ts` (new — RPC bridge)
- `src/renderer/plugins/capabilityGate.ts` (new — allowlist preamble)
- `src/renderer/plugins/sandboxWorker.ts` (new — worker bootstrap)
- `src-tauri/src/plugins.rs` (new — discovery only)
- `src-tauri/src/lib.rs`
- `src/shared/types/api.ts`

### Dependencies
- None

### Verification
- Unit test: worker scope has `fetch === undefined`, `XMLHttpRequest === undefined`, `importScripts === undefined`
- Unit test: bridge rejects RPC calls outside the public API
- `cargo test` discovery ignores non-`.js` files

### Out of Scope
- Settings UI (sprint 39)
- Example plugins (sprint 39)
- API reference doc (sprint 39)
