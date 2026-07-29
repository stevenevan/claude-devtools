# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added
- Inspector views for `~/.claude` data that was previously cleanup-only or read-only status: prompt/command history browser, subagent transcripts viewer, file-history checkpoint browser, checkpoint diff and export, shell-snapshot viewer, usage/telemetry viewer, status-line editor, marketplace catalog browser, marketplace install/enable, MCP server editor, slash-command frontmatter editor, and background task-graph viewer.
- Restore a file-history checkpoint to the file it was captured from. The original path is resolved from the session's `trackedFileBackups` map and the native save dialog opens pre-aimed at it, so the write is authorized in the dialog rather than performed silently. Not offered when the path cannot be resolved.
- `general.autoExpandAIGroups` setting: automatically expands all AI response groups when opening a transcript or when new AI responses arrive in a live session. Defaults to off. Stored in the on-disk config so it persists across restarts.


- Strict IPC input validation guards for project/session/subagent/search limits.
- `get-waterfall-data` IPC endpoint implementation.
- Cross-platform path normalization in renderer path resolvers.
- `onTodoChange` preload API event bridge.
- CI workflow for macOS/Windows (typecheck, lint, test, build).
- Release workflow for signed package builds.
- Open-source governance docs (`LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`).

### Changed
- The `~/.claude` inspector lists now name their scroll regions, mark the selected row with `aria-current`, and announce errors and loading state via `role="alert"` / `role="status"`.
- `readMentionedFile` preload API signature now requires `projectRoot`.
- Notification update event contract standardized to `{ total, unreadCount }`.
- Session pagination uses cached displayable-content detection for performance.
- File watcher error detection optimized for append-only updates.

### Fixed
- Lint violations in navigation and markdown/subagent UI components.
- Test mock drift causing runtime errors in test output.
- Multiple Windows path handling edge cases.
