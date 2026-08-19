# CDX-07 — Codex plugins and marketplace

Rail visibility: More · Depends on: CDX-06 · See `docs/ux-roadmap/ux-10-plugins.md`, `docs/ux-roadmap/ux-13-marketplace.md`

## 1. Goal

Purpose: let users browse the Codex plugin inventory and understand what each plugin contributes—skills, MCP servers, agents, or other metadata—without making the app an installer or marketplace client.

## 2. Today

The app has a plugin grid and marketplace-oriented UX for the current integration. Codex plugins use a required `.codex-plugin/plugin.json` manifest and may bundle skills or MCP configuration. The app has no Codex manifest parser, ownership model, or marketplace source display.

## 3. Simple view

```text
Codex plugins

[Web tools]             Browser and research skills
                        Installed · 3 capabilities

[Team defaults]         Shared project configuration
                        Project · read only

Search plugins…                         Open details
```

Rules:

- Show purpose and capability counts before manifest details.
- Distinguish installed, available, disabled, and invalid.
- Use “Open in Codex” for install or login actions that belong to the CLI.

## 4. Nerd view

Plugin details show:

| Field | Requirement |
| --- | --- |
| Manifest | `.codex-plugin/plugin.json` |
| Source | user, project, or marketplace metadata |
| Version | display if valid; do not infer |
| Skills | names and ownership |
| MCP | server names, redacted settings |
| Validation | schema, missing files, conflicts |

The renderer receives parsed metadata and redacted values only. It must not synthesize an install command from arbitrary manifest content.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Extension | Plugin | Plugin manifest |
| Package contents | Capabilities | Bundled skills and MCP servers |
| Install | Open in Codex | Delegate install to Codex CLI |

## 6. Files touched

- `src-tauri/src/config/` — add Codex plugin and marketplace metadata discovery.
- `src-tauri/src/commands/files.rs` or a plugin command module — add read-only inventory commands.
- `frontend/src/shared/types/api/` — add plugin, capability, source, and validation types.
- `frontend/src/renderer/components/PluginsGrid.tsx` and marketplace components — add Codex cards and details.
- Fixtures — cover valid, incomplete, duplicate, and malformed manifests.

## 7. Tasks (ordered)

1. Define the supported manifest fields and an allowlist for displayable metadata.
2. Discover local plugin manifests through the Codex root boundary.
3. Link bundled skills and MCP servers to their owning plugin without duplicating entries.
4. Add invalid, duplicate, disabled, and source-conflict states.
5. Reuse the existing plugin grid and marketplace loading/empty/error states.
6. Add an external-action handoff with an explicit explanation that the app does not install plugins.
7. Add fixture tests for ownership, manifest validation, and redaction.

## 8. Verification / acceptance

- A valid local plugin appears with a purpose, source, version state, and capability list.
- A malformed manifest cannot break the rest of the inventory.
- Marketplace metadata cannot cause a filesystem write or process launch from the renderer.
- Plugin-bundled skills and MCP servers link back to the plugin owner.
- `bun run typecheck` and targeted Rust/frontend tests pass.

## 9. Accessibility

- Plugin cards use a consistent heading and description structure.
- Capability icons have text alternatives and are not the only state signal.
- External-action buttons state where they go and whether they leave the app.

## 10. Dependencies

- CDX-01 root safety.
- CDX-06 skill inventory types.
- CDX-08 MCP inventory types.
- Existing PluginsGrid and marketplace primitives.

## 11. Risks / open questions

- Marketplace content is external input and must be treated as untrusted display data.
- A plugin may define overlapping names; source and ownership must remain visible.
- Installation, authentication, updates, and removal should remain out of scope until a separate security review authorizes them.

## 12. References

- [Build Codex plugins](https://learn.chatgpt.com/docs/build-plugins)
