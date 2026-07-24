# Sprint 10 — MCP Server Add/Edit/Remove Editor

## 1. Goal
Turn the read-only MCP status panel into an editor: add, edit, and remove MCP servers — scoped, in
v1, to the **global** source only.

## 2. Gap addressed
MCP (gap matrix #15) — FULLY present but **read-only status** (`maintenance/MCPStatusPanel.tsx` +
`files/mcp_status.rs`). This is a "deepen shallow" sprint.

## 3. Backend
- **Source scope (metis):** `mcp_status.rs` aggregates **three** sources — global `mcpServers` in
  `~/.claude.json`, per-project `mcpServers` in `.claude.json`, and each project's on-disk
  `.mcp.json`. **v1 writes the GLOBAL `~/.claude.json` mcpServers only** (root-confined, safe).
  Per-project `.mcp.json` editing is **deferred** — it requires confining an arbitrary project
  directory path, a different safety boundary this roadmap does not otherwise build.
- New `add_mcp_server` / `update_mcp_server` / `remove_mcp_server` in a `files/mcp_write.rs`,
  writing the global `~/.claude.json` `mcpServers` key. **Reuse citation (corrected):** the
  nested-key mutate precedent is `src-tauri/src/files/settings_write.rs::mutate_settings_json`
  (and the `permissions_write.rs` mutate-closure pattern) — **NOT** `claudejson_write.rs`, whose
  public fns are only purge/list/restore and whose `atomic_write_claude_json` is private. A
  `.claude.json`-side mutate helper is **new code**, gated (`state.gated`) + backed up.
- Validate the server-config shape (name, command/url, args, env) at the IPC boundary — reject
  malformed input. Register wrappers in `main.rs`.

## 4. Frontend
- Extend `frontend/src/renderer/components/maintenance/MCPStatusPanel.tsx` with add / edit / remove
  forms, acting on the **global source only** (rows from other sources stay read-only, clearly
  labeled with their existing source badge: `~/.claude.json · global`, `~/.claude.json · project`,
  `.mcp.json`).
- API: `mcp` write methods; type additions in `frontend/src/shared/types/api/mcp.ts`.

## 5. Tasks (ordered)
1. Backend `mcp_write.rs` (global-only add/update/remove via a new `.claude.json` mutate helper,
   gated + backup + boundary validation) → `cargo test mcp_write`.
2. Command wrappers + `main.rs` registration → `bun run test:rust`.
3. Shared type additions + API adapter → `bun run typecheck`.
4. `MCPStatusPanel.tsx` add/edit/remove forms (global rows only).

## 6. Verification / acceptance
- `cargo test mcp_write` — add/update/remove produce valid `~/.claude.json` with a backup written
  first; malformed server config is rejected; non-global rows are never written.
- `bun run typecheck && bun run test && bun run qa` green (QA grep gate passes).
- Manual: add a global MCP server → appears in status; edit persists; remove deletes; project /
  `.mcp.json` rows remain read-only.

## 7. Dependencies
None.

## 8. Drift / risk notes
- **Security boundary:** v1 is global-only on purpose — do not silently extend writes to
  per-project `.mcp.json` (different confinement). `.claude.json` is strict-validated; write only
  the `mcpServers` key.
