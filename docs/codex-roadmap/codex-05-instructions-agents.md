# CDX-05 — Instructions and custom agents

Rail visibility: More · Depends on: CDX-03, CDX-04 · See `docs/ux-roadmap/ux-09-agents.md`

## 1. Goal

Purpose: make Codex instructions and custom agents understandable, traceable, and safely editable. Users should see which `AGENTS.md` instructions apply to a project and what each custom agent is designed to do without executing or trusting its text in the renderer.

## 2. Today

The app already has an Agents manager and maintenance commands for Claude-oriented instruction and agent data. Codex adds layered `AGENTS.md` and `AGENTS.override.md` files, project fallbacks, byte limits, and custom agent TOML files under the Codex home or project `.codex/agents` directory.

## 3. Simple view

```text
Codex instructions and agents

Instructions       3 active files
Custom agents      5 available

[Build reviewer]   Reviews code and tests
                  Project · enabled

View source details
```

Rules:

- Lead with purpose and scope, not raw path names.
- Separate active instructions from nearby but inactive files.
- Show an agent’s description before its implementation details.

## 4. Nerd view

For instructions, show the walk from project root to current directory:

| File | Applies to | Priority | State |
| --- | --- | --- | --- |
| `AGENTS.md` | project | inherited | active |
| `AGENTS.override.md` | project | override | active |
| nested `AGENTS.md` | subdirectory | nearest | active |

For agents, show name, description, source file, developer instructions, model/profile overrides, and whether the file is global or project-local. Redact token-like content and avoid running any embedded command.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Instruction file | Project guidance | Layered instruction source |
| Override | Project override | Higher-priority instruction file |
| Agent TOML | Custom agent | Agent definition and overrides |

## 6. Files touched

- `src-tauri/src/config/` — add instruction discovery and custom-agent parsing.
- `src-tauri/src/commands/maintenance/` — add source-aware list, read, and narrowly scoped write commands.
- `src-tauri/src/commands/files.rs` — register command wrappers if that remains the existing boundary.
- `frontend/src/shared/types/api/` — add instruction-source and custom-agent types.
- `frontend/src/renderer/components/AgentsManager.tsx` and related panels — add Codex scope and provenance.
- Fixtures — cover overrides, nested directories, fallback filenames, malformed TOML, and byte limits.

## 7. Tasks (ordered)

1. Implement the instruction walk in the same order Codex uses, including override precedence and fallback filenames.
2. Enforce the configured document size limit and report truncation as a diagnostic.
3. Parse custom agents from the supported global and project directories.
4. Normalize agent metadata for the list while keeping full instructions behind an explicit detail action.
5. Add safe editing only for files resolved server-side from a selected source record.
6. Reuse the existing write confirmation, recovery, and trash rules.
7. Map agent tools and capabilities to plain-language labels in Simple mode.

## 8. Verification / acceptance

- Active instructions are ordered and explain why each file applies.
- Override files replace or supersede the correct lower-priority content.
- A malformed agent file is isolated with an actionable error.
- The renderer cannot choose an arbitrary instruction or agent path.
- Editing a selected file shows a diff and can be canceled without a write.
- `bun run test:rust` and targeted frontend tests pass.

## 9. Accessibility

- Agent cards expose name, purpose, scope, and state in their accessible name.
- Source and precedence details use headings and definition lists, not visual indentation alone.
- Long instruction text must remain selectable, zoomable, and keyboard navigable.

## 10. Dependencies

- CDX-01 root and path safety.
- CDX-03 source provenance.
- Existing Agents manager and maintenance write primitives.

## 11. Risks / open questions

- Instruction text is executable influence even when the app only displays it; keep it clearly labeled as untrusted local content.
- Project-local instructions may be untrusted until the project trust state is known.
- Agent definitions can reference tools or models unavailable on this machine; report availability instead of guessing.

## 12. References

- [AGENTS.md configuration](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Custom subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
