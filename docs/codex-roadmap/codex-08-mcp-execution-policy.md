# CDX-08 — MCP and execution policy

Rail visibility: More · Depends on: CDX-03, CDX-04, CDX-07 · See `docs/ux-roadmap/ux-07-settings.md`, `docs/ux-roadmap/ux-15-maintenance.md`

## 1. Goal

Purpose: make Codex MCP servers, tool availability, approval rules, sandbox policy, and hooks understandable in one safe inspection surface. This sprint is for visibility and policy review; it must not execute tools or handle OAuth tokens in the renderer.

## 2. Today

The app has MCP status and permission-oriented panels for the current integration, but no Codex `[mcp_servers.<name>]` reader or normalized execution-policy view. Settings and plugin work will provide some of the source and ownership data needed here.

## 3. Simple view

```text
Codex tools and permissions

MCP servers       4 configured · 3 available
Approval          On request
Sandbox           Workspace write
Hooks             2 configured

[filesystem]      Connected · approval required
[docs]            Offline · configuration error
```

Rules:

- Explain what a server can do before showing configuration syntax.
- Show connection and policy states with text.
- Never display access tokens, headers, or secret command arguments.

## 4. Nerd view

```text
Server: filesystem
Source: ~/.codex/config.toml
Transport: configured
Tools: 8 advertised · 6 enabled
Approval: per request
Sandbox: workspace write
Credentials: configured (redacted)
```

The policy view must distinguish configured, reachable, enabled, approved, and actually observed. It must not claim a tool ran merely because its server is configured.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| MCP server | Connected tool source | Configured MCP server |
| Permission | Approval rule | Execution policy |
| Tool list | Available tools | Advertised versus enabled tools |

## 6. Files touched

- `src-tauri/src/config/` — parse Codex MCP and policy settings with redaction.
- `src-tauri/src/commands/` — add read-only MCP inventory and policy commands.
- `frontend/src/shared/types/api/` — add server, tool, credential-state, and policy types.
- `frontend/src/renderer/components/MCPStatusPanel.tsx` and `PermissionsPanel.tsx` — add Codex source and policy display.
- `src-tauri/src/main.rs` — register commands through the existing validated boundary.
- Fixtures — cover malformed servers, redacted fields, unreachable states, and policy conflicts.

## 7. Tasks (ordered)

1. Define a redaction schema for URLs, headers, environment values, tokens, and command arguments.
2. Parse server names, transport metadata, enabled state, and ownership from Codex config and plugins.
3. Normalize approval and sandbox settings without implying runtime behavior that was not observed.
4. Add connection and validation diagnostics with actionable but non-secret messages.
5. Add Simple and Nerd panels with source links back to settings or plugin ownership.
6. Keep all tool execution and authentication actions outside the renderer command surface.
7. Add regression tests for redaction before every response reaches the frontend API.

## 8. Verification / acceptance

- Token-like values are redacted in normal output, errors, logs, and test snapshots.
- The app can inspect a malformed or offline server without attempting a connection.
- Configured does not equal enabled, and enabled does not equal executed in the UI copy.
- A project-local server is labeled with its trust scope.
- `bun run qa` passes, including the Rust safety grep gate.

## 9. Accessibility

- Connection, policy, and credential states are readable as text and announced after refresh.
- Server details use labeled sections with a predictable tab order.
- Long URLs and tool names wrap without forcing horizontal scrolling.

## 10. Dependencies

- CDX-03 settings provenance and CDX-04 write restrictions.
- CDX-07 plugin ownership.
- Existing MCP and permissions components.

## 11. Risks / open questions

- Even a redacted command or URL can reveal sensitive infrastructure; define the display allowlist conservatively.
- Live connectivity checks could have side effects and must not be part of passive inspection.
- Policy names may not map one-to-one across Codex versions; preserve raw enum values only in Nerd mode with a safe fallback label.

## 12. References

- [Extend Codex with MCP](https://learn.chatgpt.com/docs/extend/mcp)
- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
