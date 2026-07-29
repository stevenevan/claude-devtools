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

| # | Sprint | Gap closed | Writes files? | Depends on | Status |
|---|--------|------------|:---:|:---:|---|
| 01 | [Prompt/command history browser](sprint-01-history-browser.md) | `history.jsonl` viewer + search | no | — | done |
| 02 | [Subagent transcripts viewer](sprint-02-transcripts-viewer.md) | `transcripts/ses_*.jsonl` content | no | — | done |
| 03 | [File-history checkpoint browser](sprint-03-file-history-browser.md) | `file-history/{uuid}/{hash}@vN` list | no | — | done |
| 04 | [Checkpoint diff + export](sprint-04-checkpoint-diff-export.md) | diff + recover (restore = stretch) | ⚠ gated | 03 | done — restore shipped, **overwrite prompt unverified** |
| 05 | [Shell-snapshot viewer](sprint-05-shell-snapshot-viewer.md) | `shell-snapshots/*.sh` content | no | — | done |
| 06 | [Usage / telemetry raw viewer](sprint-06-usage-telemetry-viewer.md) | `stats-cache.json` / `statsig/` / `telemetry/` | no | — | done |
| 07 | [Status-line config editor](sprint-07-status-line-editor.md) | `statusLine` + `status-line` script | ⚠ gated | — | done |
| 08 | [Marketplace catalog browser](sprint-08-marketplace-browser.md) | plugin marketplace catalog | no | — | done |
| 09 | [Marketplace install / enable flow](sprint-09-marketplace-install.md) | `installed_plugins.json` | ⚠ gated | 08 | done |
| 10 | [MCP server add/edit/remove editor](sprint-10-mcp-editor.md) | global `mcpServers` in `~/.claude.json` | ⚠ gated | — | done |
| 11 | [Slash-command frontmatter editor](sprint-11-slash-command-editor.md) | `commands/*.md` structured edit | ⚠ gated | — | done |
| 12 | [Integration hardening & release](sprint-12-hardening-release.md) | cross-viewer QA / a11y / perf / docs | no | all | **partial** — a11y + docs done, manual QA sweep NOT run |
| 13 | [Background task-graph viewer](sprint-13-task-graph-viewer.md) | `tasks/{uuid}/*.json` task graph | no | — | done |

**Ordering:** read-only viewers (01, 02, 03, 05, 06, 08, 10, 11, 13) can be built in any order.
Write-dependent pairs: **04 depends on 03**, **09 depends on 08**. **12 depends on all prior** (it
hardens them). Read-only viewers precede write-capable editors on purpose — they exercise the
read/list path with no write risk, so the write sprints build on a proven read surface.

## Open premises (resolve at the named sprint's start, before writing that code)

- **Sprint 02** — `transcripts/ses_*.jsonl` are parse-compatible with `parse_session_file`. Check:
  `cargo test` a fixture calling `parse_session_file` on one real `ses_*.jsonl`.
- **Sprint 04 — RESOLVED.** `trackedFileBackups` is populated in real sessions, so restore shipped.
  Measured over all 141 local `file-history` dirs (2566 leaves):
  - Entry values are objects — `{backupFileName, version, backupTime, realParentDir?}` — and
    `backupFileName` is `null` in 1032 of them. Older sessions wrote a bare string; both forms are
    tolerated and unusable entries are skipped.
  - Three key forms resolve: `realParentDir` + `basename(key)`, an already-absolute key, and a key
    relative to the session `cwd`. The third is the largest bucket (4283 of 8701) and lifts
    coverage from 74.2% to **94.5%**.
  - Match on the **hash segment**, not `{hash}@v{version}`: the map records only the *current*
    backup name, so every one of the 626 exact-match misses was an `@v1` leaf — the pre-edit
    original. No hash mapped to more than one path, so the hash alone is unambiguous.
  - `trash::trash_items` cannot back up a restore target: it confines every path to
    `[claude root, app-data]`, and real targets live outside both. The spec's "trash-back first"
    is therefore unimplementable, and restore instead opens the native save dialog pre-aimed at the
    resolved path, so the write stays user-authorized exactly as `export_checkpoint` already is.
  - **Still unverified:** that the macOS save dialog prompts before replacing an existing file, and
    that `set_directory` + `set_file_name` actually opens the panel in the original's folder (rfd
    joins the two into a non-existent `directoryURL`). Both were to be settled by clicking through
    the running app; that check was skipped. The replace prompt is the only thing preventing an
    unbacked overwrite of a live file — confirm it before relying on Restore.

- **Sprint 12 — partially done.** The a11y pass and these docs landed. The manual QA sweep it is
  mostly made of — opening each view, empty states, restore end-to-end, VoiceOver, and the
  scroll/latency smoke bars — was not run and is still outstanding.
- **Sprint 11** — no YAML/TOML crate in `src-tauri/Cargo.toml`; decide parse-side (client-side TS
  vs. a new Rust dep) and finalize the frontmatter field list at sprint start.
