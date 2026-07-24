# Sprint 08 — Plugin Marketplace Catalog Browser (read)

## 1. Goal
Browse the plugin marketplaces and their catalog — which marketplaces are known, what plugins each
offers, and which are already installed — read-only.

## 2. Gap addressed
Marketplace catalog (gap matrix #4, PARTIAL). Plugins themselves get a first-class grid
(`dashboard/PluginsGrid.tsx`), but marketplaces surface only as `plugin.marketplace` metadata + a
conflict warning + `PluginsCleanupPanel.tsx`. There is no catalog browser. Verified on disk:
`plugins/known_marketplaces.json` (object keyed by marketplace name),
`plugins/marketplaces/{name}/` dirs, `plugins/plugin-catalog-cache.json` (`{catalog, fetchedAt,
version}`), `plugins/installed_plugins.json` (`{plugins, version}`).

## 3. Backend
- New `src-tauri/src/files/marketplace_reader.rs`:
  - `pub fn read_marketplace_catalog(root: &str) -> Result<MarketplaceCatalog, String>` — parse
    `known_marketplaces.json` + `plugin-catalog-cache.json`, walk `plugins/marketplaces/{name}/`,
    and cross-reference `installed_plugins.json` to mark installed state.
  - `MarketplaceCatalog { marketplaces: Vec<MarketplaceView> }`,
    `MarketplaceView { name, source, fetched_at, plugins: Vec<CatalogPlugin> }`,
    `CatalogPlugin { name, description, installed: bool }`.
- Read-only (no writes this sprint). Wrapper in `src-tauri/src/commands/files.rs`; register in
  `main.rs`. Reuse the existing plugins read spine (`files/plugins_write.rs::read_global_plugins`)
  for the installed cross-reference.

## 4. Frontend
- New `frontend/src/renderer/components/dashboard/MarketplaceBrowser.tsx` — ActivityBar view
  `activity="marketplace"` (or nested under the existing plugins view). Marketplace list →
  plugin cards **reusing the `dashboard/PluginsGrid.tsx` card pattern**, each card showing installed
  state.
- API: `marketplace` domain method; type `frontend/src/shared/types/api/marketplace.ts`.

## 5. Tasks (ordered)
1. Backend `read_marketplace_catalog` (parse + walk + installed cross-ref) →
   `cargo test marketplace_reader`.
2. Command wrapper + `main.rs` registration → `bun run test:rust`.
3. Shared type + API adapter → `bun run typecheck`.
4. `MarketplaceBrowser.tsx` (marketplace → plugin cards, installed badges, reusing PluginsGrid card).

## 6. Verification / acceptance
- `cargo test marketplace_reader` — parses catalog fixtures; installed cross-reference is correct;
  tolerates a missing/absent `plugin-catalog-cache.json`.
- `bun run typecheck && bun run test && bun run qa` green.
- Manual: open Marketplace; browse marketplaces → plugins; installed plugins show a badge.

## 7. Dependencies
None. Precursor to Sprint 09 (install/enable).

## 8. Drift / risk notes
- **Non-goal:** no network fetch — this reads the on-disk `plugin-catalog-cache.json` the CLI
  maintains; refreshing the cache stays the CLI's job.
- Catalog schema is version-specific — tolerant parse, `// confirm-at-impl`.
