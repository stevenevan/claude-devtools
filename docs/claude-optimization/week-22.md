# Week 22 — MCP Status Dashboard (Read-Only)

**Objective:** Make MCP server state visible: which servers are configured (`mcpServers` in
`~/.claude.json` — empty at audit), which claude.ai connectors need re-authentication
(`mcp-needs-auth-cache.json` listed 4: Gmail, Calendar, Drive, Notion), and where each is
defined. Read-only status + guidance — the app does not perform MCP auth.

**Prerequisites:** week 20 (claude.json reader — `mcpServers` lives there), week 12
(`mcp-needs-auth-cache.json` already surfaced as a cache; this week interprets it).

## Tickets

### W22-T1 — MCP state readers
- Aggregate three sources into one model (`internal/files`):
  - `mcpServers` from `~/.claude.json` (global stdio/http servers) — name, transport,
    command/url with credential-shaped args MASKED (week-18 masking contract).
  - Project `.mcp.json` files for known project roots (same discovery walk as week 18).
  - `mcp-needs-auth-cache.json` — connectors flagged as needing auth, with cache freshness
    (`ModTime`) so a stale probe isn't presented as current truth.
- Verify: fixtures for all three sources merge into correct per-server rows.

### W22-T2 — Status panel
- Read-only panel: server table (name, source file chip, transport, auth-needed badge with
  cache-age caveat), per-row guidance — the exact CLI command to fix what the app can't
  (`claude mcp list`, re-auth via the CLI/claude.ai UI), copy-to-clipboard.
- Empty state that teaches: when `mcpServers` is empty (the audit norm), explain where MCP
  servers get defined rather than showing a bare "no data".
- Read-only week: renders in browser mode; ZERO write actions (no server add/remove/edit —
  that's config surgery the CLI owns; revisit only if users ask).
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Server table aggregates all three sources with correct provenance chips (fixture
      matrix: global-only, project-only, both, none).
- [ ] Auth-needed badges show cache age; a months-old cache is labeled "last checked N
      days ago", not asserted as current (test).
- [ ] Credential-shaped command args/env masked by default (test + review gate).
- [ ] Empty `mcpServers` renders the teaching empty-state.
- [ ] Panel exposes zero write actions (review gate); renders read-only in browser mode.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Stale-cache truth claims** — `mcp-needs-auth-cache.json` is a point-in-time probe; the
  user may have re-authed an hour after it was written. Cache-age labeling keeps the panel
  honest; asserting "Gmail needs auth" from a stale cache erodes trust in the whole
  maintenance surface.
- **Scope creep into MCP management** — add/remove/edit server entries means writing
  `~/.claude.json` (week 21's HIGH-CARE file) for marginal value the CLI already provides
  (`claude mcp add`). Guidance-not-management is the fence; any write here is
  review-rejectable.
- **Secret leakage via server args** — MCP server definitions embed tokens in args/env/urls.
  Same masking contract, same severity as weeks 18/20.
