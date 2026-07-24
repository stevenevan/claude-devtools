# `~/.claude` Inspector-Viewer Roadmap

Thirteen sprint-weeks that close the remaining gaps between the data Claude Code writes under
`~/.claude/` and what this app surfaces. A full gap audit (17 categories, verified against both the
Rust command surface and the React UI) found **nothing fully absent** — every category already has
at least a backend command, and most have first-class UI. What remains are categories that today
are **cleanup-only or read-only status, with no content viewer/editor**. Each sprint below closes
one such gap, or deepens a shallow-but-present feature.

## How to read a sprint file

Every `sprint-NN-*.md` follows the same eight sections:

1. **Goal** — one-line outcome.
2. **Gap addressed** — the `~/.claude` data + why it's a gap today (the existing cleanup/read-only
   component it complements).
3. **Backend** — new/changed Rust: command signatures, files under `src-tauri/src/files/` +
   `src-tauri/src/commands/`, the registration line in `src-tauri/src/main.rs` `generate_handler!`,
   reused safe-I/O helpers, and — for writes — the gated + trash-backup pattern.
4. **Frontend** — new/changed components, the API adapter method
   (`frontend/src/renderer/api/tauri/domain/*.ts`), the shared type
   (`frontend/src/shared/types/api/*.ts`), placement (ActivityBar view or Maintenance panel), and
   reused components.
5. **Tasks (ordered)** — concrete implementation steps.
6. **Verification / acceptance** — the runnable check per task (`bun run typecheck`, `bun run test`,
   `cargo test <name>`, `bun run qa`, `bun run test:rust`) + manual acceptance criteria.
7. **Dependencies** — prior sprints required.
8. **Drift / risk notes** — the unverified premise (if any) + the tolerant-parser note.

## Shared conventions (apply to every sprint)

- **Register commands** in `src-tauri/src/main.rs` `generate_handler!` (line ~513) and validate
  untrusted IPC arguments at that boundary (per `CLAUDE.md`).
- **Confine filesystem access** through existing helpers — `src-tauri/src/files/text_write.rs`
  (`resolve_instruction_path`, `read_text_file`, `write_text_file`, `mutate_text_file`,
  `INSTRUCTION_ALLOWLIST`) and the dir-walk in `src-tauri/src/files/skills_inventory.rs`. Do not add
  direct `dirs::home_dir()` calls without updating the QA baseline
  (`scripts/qa-rust-grep-gate.sh`).
- **Writes are gated + backed up** — use the `Maint` `state.gated(|root| …)` pattern (`gated` is
  defined on `impl MaintenanceState` in `src-tauri/src/commands/maintenance/state.rs`; call-sites in
  `src-tauri/src/commands/maintenance/managers.rs`) and trash-back the prior file via
  `src-tauri/src/maintenance/trash.rs` before overwriting.
- **Types** — expose `DesktopAPI` types via `@shared/types/api`; do not deep-import domain types.
- **Run `bun run qa`** before committing functional changes.
- **Tolerant parsers** — `~/.claude` on-disk formats are Claude-Code-version-specific and may drift.
  Every reader skips/labels unknown fields and never hard-fails a whole view on one bad record, and
  carries a `// confirm-at-impl` note on the schema it assumes.

## Sprints

| # | Sprint | Gap closed | Writes files? | Depends on |
|---|--------|------------|:---:|:---:|
| 01 | [Prompt/command history browser](sprint-01-history-browser.md) | `history.jsonl` viewer + search | no | — |
| 02 | [Subagent transcripts viewer](sprint-02-transcripts-viewer.md) | `transcripts/ses_*.jsonl` content | no | — |
| 03 | [File-history checkpoint browser](sprint-03-file-history-browser.md) | `file-history/{uuid}/{hash}@vN` list | no | — |
| 04 | [Checkpoint diff + export](sprint-04-checkpoint-diff-export.md) | diff + recover (restore = stretch) | ⚠ gated | 03 |
| 05 | [Shell-snapshot viewer](sprint-05-shell-snapshot-viewer.md) | `shell-snapshots/*.sh` content | no | — |
| 06 | [Usage / telemetry raw viewer](sprint-06-usage-telemetry-viewer.md) | `stats-cache.json` / `statsig/` / `telemetry/` | no | — |
| 07 | [Status-line config editor](sprint-07-status-line-editor.md) | `statusLine` + `status-line` script | ⚠ gated | — |
| 08 | [Marketplace catalog browser](sprint-08-marketplace-browser.md) | plugin marketplace catalog | no | — |
| 09 | [Marketplace install / enable flow](sprint-09-marketplace-install.md) | `installed_plugins.json` | ⚠ gated | 08 |
| 10 | [MCP server add/edit/remove editor](sprint-10-mcp-editor.md) | global `mcpServers` in `~/.claude.json` | ⚠ gated | — |
| 11 | [Slash-command frontmatter editor](sprint-11-slash-command-editor.md) | `commands/*.md` structured edit | ⚠ gated | — |
| 12 | [Integration hardening & release](sprint-12-hardening-release.md) | cross-viewer QA / a11y / perf / docs | no | all |
| 13 | [Background task-graph viewer](sprint-13-task-graph-viewer.md) | `tasks/{uuid}/*.json` task graph | no | — |

**Ordering:** read-only viewers (01, 02, 03, 05, 06, 08, 10, 11, 13) can be built in any order.
Write-dependent pairs: **04 depends on 03**, **09 depends on 08**. **12 depends on all prior** (it
hardens them). Read-only viewers precede write-capable editors on purpose — they exercise the
read/list path with no write risk, so the write sprints build on a proven read surface.

## Open premises (resolve at the named sprint's start, before writing that code)

- **Sprint 02** — `transcripts/ses_*.jsonl` are parse-compatible with `parse_session_file`. Check:
  `cargo test` a fixture calling `parse_session_file` on one real `ses_*.jsonl`.
- **Sprint 04** — in-place restore needs `{hash}@vN` → real path, mapped via the session
  `file-history-snapshot` entry's `snapshot.trackedFileBackups`. The field exists (~220 session
  files) but is `{}` in the sample, so restore is **unproven**; Sprint 04 ships view+diff+export
  regardless. Check: grep for a populated `trackedFileBackups` before writing restore.
- **Sprint 11** — no YAML/TOML crate in `src-tauri/Cargo.toml`; decide parse-side (client-side TS
  vs. a new Rust dep) and finalize the frontmatter field list at sprint start.
