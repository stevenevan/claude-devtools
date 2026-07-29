# CLAUDE.md

## Overview

Tauri 2 desktop app for inspecting Claude Code session execution. Rust reads local JSONL logs from `~/.claude/`; React renders the recovered execution trace.

**Stack:** Tauri 2, Rust, React 19, TypeScript, Tailwind CSS, Zustand, Bun.

## Commands

```bash
bun run dev          # Tauri dev server with Vite hot reload
bun run build        # Production compile without an app bundle
bun run package      # Build a macOS app bundle
bun run typecheck    # Frontend TypeScript check
bun run test         # Frontend Bun tests
bun run test:rust    # Rust unit and integration tests
bun run qa           # Typecheck, tests, and Rust safety grep gate

cd src-tauri && cargo run --bin claude-devtools-cli -- show-session <projectId> <sessionId> --format json
```

## Layout

- `src-tauri/` — Rust application, command registration, domain services, and parity fixtures.
- `frontend/` — React renderer and Tauri IPC adapter.
- `scripts/qa-rust-grep-gate.sh` — write/delete/root-resolution safety boundary.

### `~/.claude` inspector views

ActivityBar views: History (`history.jsonl`), Transcripts (`transcripts/`), Marketplace
(`plugins/`), Task Graph (`tasks/`). Maintenance panels: File History (`file-history/`), Shell
Snapshots (`shell-snapshots/`), Usage & Telemetry (`stats-cache.json`, `telemetry/`).

All of these read `~/.claude` only. The one exception is File History's `Save as…` and
`Restore to original…`, which write the single file the user picks in the native save dialog —
never a path the renderer supplies. Restore resolves the original path server-side from the
session's `trackedFileBackups` map, and both actions always act on the local machine even while an
SSH session is connected.

**Unverified, and load-bearing:** Restore has no backup step. `maintenance/trash.rs` confines every
path to `[claude root, app-data]`, so it refuses real restore targets, and no pre-write copy was
added in its place. The macOS save dialog's replace prompt is therefore the only thing standing
between `Restore to original…` and an unrecoverable overwrite of a live file — and that prompt has
never been confirmed by clicking through the app. Confirm it before relying on Restore. Also
unconfirmed: whether `set_directory` + `set_file_name` opens the panel in the original's folder
(rfd joins the two into a `directoryURL` that does not exist); if it does not, the dialog opens
elsewhere with the right filename, which is the more dangerous failure.

## Data Pipeline

```text
~/.claude/projects/{id}/*.jsonl
  -> Rust parser and analysis pipeline
  -> Tauri command IPC
  -> DesktopAPI adapter
  -> Zustand stores and React components
```

## Conventions

- Add Tauri commands in `src-tauri/src/main.rs`; validate untrusted IPC arguments at that boundary.
- Keep filesystem access confined through existing Rust helpers. Do not add direct `dirs::home_dir()` calls without updating the QA baseline.
- Use `@shared/types/api` for `DesktopAPI` types; do not deep-import API domain types.
- Run `bun run qa` before committing functional changes.
