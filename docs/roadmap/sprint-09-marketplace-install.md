# Sprint 09 — Marketplace Install / Enable Flow (write)

## 1. Goal
From the marketplace browser, install a plugin (record it in `installed_plugins.json`) and
enable/disable it, with conflict handling — reusing the app's existing plugin write primitives.

## 2. Gap addressed
Same data as Sprint 08; adds the install/enable action. Today the app can enable/dedupe **already
installed** plugins but has no install-from-catalog path.

## 3. Backend
- New `install_plugin(root, marketplace, name)` in `src-tauri/src/files/plugins_write.rs` (alongside
  the existing write fns) — a **gated write** with backup that adds the entry to
  `plugins/installed_plugins.json` (`{plugins, version}`). Validate `(marketplace, name)` against the
  catalog (Sprint 08 `read_marketplace_catalog`) at the boundary — reject an unknown pair.
- **Reuse** the existing, verified write primitives for the enable/conflict half:
  `set_plugin_enabled`, `dedupe_plugin`, `detect_plugin_duplicates` (`files/plugins_write.rs`) — do
  not reimplement enable or duplicate detection.
- Wrapper in `src-tauri/src/commands/files.rs`; register in `main.rs`.

## 4. Frontend
- Extend `frontend/src/renderer/components/dashboard/MarketplaceBrowser.tsx` (Sprint 08): each
  catalog card gets Install / Enable / Disable actions; surface the existing multi-marketplace
  conflict warning when a plugin name exists under 2+ marketplaces (reuse the current warning UI).
- API: `installPlugin` domain method; reuse existing `setPluginEnabled` / dedupe methods.

## 5. Tasks (ordered)
1. Backend `install_plugin` (gated + backup + catalog validation) → `cargo test install_plugin`.
2. Command wrapper + `main.rs` registration → `bun run test:rust`.
3. Frontend install/enable/disable actions + conflict warning in `MarketplaceBrowser.tsx` →
   `bun run typecheck`.

## 6. Verification / acceptance
- `cargo test install_plugin` — writing produces valid `installed_plugins.json` (`{plugins,
  version}` preserved), a backup is created first, and an unknown `(marketplace, name)` is rejected.
- `bun run typecheck && bun run test && bun run qa` green (QA grep gate passes — write stays gated).
- Manual: install a catalog plugin → it appears in the plugins grid; enable/disable round-trips;
  a name under two marketplaces shows the conflict warning.

## 7. Dependencies
Sprint 08 (catalog read + browser).

## 8. Drift / risk notes
- Writes to `installed_plugins.json` are **gated + backed up** — never write without a backup.
  Validate the catalog pair at the boundary (untrusted IPC arg per CLAUDE.md).
