# CDX-01 — Codex boundary and source root

Rail visibility: foundation · Depends on: — · See `docs/ux-roadmap/ux-15-maintenance.md`

## 1. Goal

Purpose: establish one trusted, testable boundary for Codex data before any Codex page reads or writes a file. The boundary resolves the Codex home, classifies every path, and keeps the existing Claude integration unchanged.

## 2. Today

The app has a Claude-specific root resolver and filesystem safety layer. Its current services and commands assume `.claude`; there is no Codex source resolver or Codex fixture root yet. The app instructions describe Codex views under `~/.Codex`, while current source code still uses the Claude layout.

## 3. Simple view

There is no user-facing page in this sprint. The only visible result is a clear empty state when Codex is not available:

```text
Codex data
Not found
Set CODEX_HOME or start a Codex session to inspect local data.
```

Rules:

- Never make the user paste a filesystem path into the renderer.
- Show the resolved source label, not an opaque internal path.
- Keep the Claude source selector and its copy unchanged.

## 4. Nerd view

The diagnostics surface may show:

| Field | Value |
| --- | --- |
| Source | Codex |
| Root | resolved server-side |
| Resolution | `CODEX_HOME`, configured root, or platform default |
| Read access | available / unavailable |
| Write access | disabled until a later sprint |

All paths are resolved and validated in Rust. The frontend receives a typed status object and never receives an unredacted environment map.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Claude root | Codex data folder | Resolved Codex source root |
| Missing directory | Codex data not found | Root resolution failed |
| Unsafe path | Cannot open this item | Path is outside the allowed Codex root |

## 6. Files touched

- `src-tauri/src/config/root.rs` — add a Codex root resolver without changing Claude resolution.
- `src-tauri/src/files/` — reuse the existing path classification and safety helpers.
- `src-tauri/src/commands/` — add a read-only Codex source-status command if the UI needs it.
- `frontend/src/shared/types/api/` — add the source-status type through the shared API surface.
- `src-tauri/tests/fixtures/` or the existing parity-fixture location — add small Codex path fixtures.

## 7. Tasks (ordered)

1. Record the supported Codex root precedence and the difference between `~/.codex` and the project’s documented `~/.Codex` layout.
2. Implement a server-side resolver that accepts only an explicit test root or the supported Codex home setting.
3. Add a source-kind enum so Claude and Codex cannot be confused by a string path.
4. Reuse the existing root-relative path guard for reads and reject traversal, symlinks, and unrelated absolute paths.
5. Add malformed, missing, and permission-denied fixtures with actionable error messages.
6. Expose only the minimum status needed by the future source picker.

## 8. Verification / acceptance

- A missing Codex root returns a typed “not found” result, not a panic.
- A path outside the resolved root is rejected before filesystem access.
- The Claude resolver and its tests remain unchanged in behavior.
- Tests cover an explicit root, default root, missing root, and case-sensitive path mismatch.
- `bun run test:rust` passes for the resolver and path guard.

## 9. Accessibility

- Status text must be available to screen readers without relying on color or an icon.
- Error text must state what failed and the next safe action.
- Diagnostic rows need real labels and keyboard-reachable disclosure controls.

## 10. Dependencies

- Existing Rust root and path-safety helpers.
- A stable shared source-status type.
- The data-source switch planned in CDX-09.

## 11. Risks / open questions

- The official Codex default is commonly documented as `~/.codex`, while this app’s product scope names `~/.Codex`; the resolver must discover the actual path instead of guessing by string replacement.
- A broad home-directory fallback would weaken the safety boundary and is out of scope.
- Confirm whether project-local Codex roots can be trusted from the current project context before enabling them.

## 12. References

- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
