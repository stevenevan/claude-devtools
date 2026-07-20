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
- `docs/tauri-migration/` — migration records; completed scope is in `completed.md`.

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
