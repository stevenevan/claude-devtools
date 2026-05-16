# Autonomous Run Log — 2026-05-22

Continuation of the 2026-05-15 (path-hardening) autonomous /plan-with-review run.
Plan: `migration-sprints/notes/autonomous-run-2026-05-22-plan.md`.

Review pipeline: metis → security-auditor + architect-reviewer
(auto-picked, parallel) → momus → execute.

## Shipped this session

| # | Commit | Summary |
| - | ------ | ------- |
| 64 (security half) | `feat(security)` | Canonical projects root captured ONCE at app `.setup()` into `Arc<PathBuf>` (`ClaudeRoot` managed state). `path_util::confine()` rewritten to accept a pre-canonical `&Path` root — no more live `canonicalize(root)` on every call (was line 33). `resolve_session_path` / `resolve_subagent_path` collapsed to a single canonical-root-explicit API (no dual `_with_root` variant footgun). 10 IPC handlers across 5 files migrated: `analytics.rs` (3 sites), `sessions.rs` (3 sites + 2 stale `resolve_claude_dir` calls dropped), `agents_search.rs` (3 sites incl. `get_subagent_detail`), `analysis/commands.rs::get_file_graph` (gained `State<ClaudeRoot>`), `analysis/file_graph.rs::compute_file_graph` (gained `&Path` param). `snapshots.rs::snapshots_create_from_session` forwards the new arg into `get_session_detail`. Watcher reads `app.state::<ClaudeRoot>()` instead of re-deriving inline. `tempfile = "3"` added under fresh `[dev-dependencies]` section. 3 real symlink-FS negative tests assert post-swap candidate rejection + captured-root-not-live-derived behavior + end-to-end resolve_session_path swap rejection. CWE-59 (symlink following) + CWE-367 (TOCTOU). |
| 56 (wave 2) | `test(rust)` | Closes PLAN sprint 56 +20-test target. `chunk_builder.rs` +7 (System/Event/Compact mid-sequence flush-and-resume; isolated meta user; build_chunks_incremental empty + variant-match; multi-sidechain filter). `tool_linking.rs` +4 (stray tool_result ignored; Skill without instructions; is_error default-false; skill_instructions_token_count length-proportional). Metis caught 6/11 originally proposed tests as duplicates of existing 18+7 tests; plan re-targeted to genuine gaps. `message_classifier.rs` (799 lines) intentionally untouched — 1 below 800 hard cap. |

## Reviewer findings applied

### metis-plan-consultant (3 MUST / 2 SHOULD / 1 CONSIDER)
- MUST-1 → silent fallback removed; `projects_root()` helper deleted entirely; single explicit-root API.
- MUST-2 → symlink-swap tests redesigned to exercise the actual attack (Test A: confine rejects post-swap symlink; Test B: captured-root-not-live-derived; Test C: end-to-end `resolve_session_path` swap rejection).
- MUST-3 → `confine()` re-canonicalize-root bug fixed — accepts pre-canonical root, only canonicalizes candidate.
- SHOULD-4 → `ClaudeRoot` moved to NEW `commands/claude_root.rs` (architect file-cap override of metis "no new file" SHOULD).
- SHOULD-5 → watcher reads managed state internally (consistency).
- CONSIDER → sprint 56 fuzz secondary dropped (`docs/security.md` already exists; context budget per architect).

### security-auditor (3 HIGH / 4 MEDIUM / 3 LOW)
- HIGH-1 → `analysis/file_graph.rs:93` was missing from initial plan — added; `get_file_graph` Tauri command gained `State<ClaudeRoot>`.
- HIGH-2 → dual-API footgun eliminated by collapsing to single `resolve_session_path(&Path, ...)` API. `ClaudeRoot::for_test` is `#[cfg(test)]`-gated only.
- HIGH-3 → watcher warm-up fallback removed; no canonicalize-at-call inside watcher.
- MEDIUM (Test C) → end-to-end test added: `resolve_session_path` with captured canonical root rejects symlink-swap candidate.
- MEDIUM (for_test exposure) → `#[cfg(test)]`-gated, not `pub(crate)`.
- MEDIUM (residual TOCTOU at `File::open`) → documented as known residual (would require Linux-only `openat2(RESOLVE_NO_SYMLINKS)`).
- LOW (macOS canonicalize quirk) → tests canonicalize tempdir paths before comparison.

### architect-reviewer (3 MUST / 4 SHOULD / 2 CONSIDER)
- MUST-1 → test-signature contradiction resolved: single `resolve_session_path(&Path, ...)` API; existing tests pass `test_root()` constant `Path`.
- MUST-2 → `analysis/file_graph.rs:93` untracked caller added to scope.
- SHOULD (dual-API duplication) → collapsed to single API.
- SHOULD (file-cap discipline) → `ClaudeRoot` in NEW `commands/claude_root.rs` (path_util.rs would have crossed 400-line target).
- SHOULD (watcher setup-ordering) → option (ii): compute `ClaudeRoot::new()` synchronously BEFORE `.manage()`.
- SHOULD (watcher half-fallback) → removed.
- CONSIDER (sprint 56) → dropped from this run.
- CONSIDER (CLI compat) → verified: `src/bin/cli.rs` does NOT import `path_util`.

### momus-high-accuracy-plan-reviewer (1 WARNING / 6 INFO)
- WARNING → `tempfile` not in `Cargo.toml` — `[dev-dependencies]` added.
- All cited file paths verified; all line numbers verified against HEAD; single-API claim consistent; `dirs::home_dir()` exclusion list verified safe.
- VERDICT: READY before execution.

## Deferred (with blocker)

| # | Reason |
| - | ------ |
| 64 cold-start measurement | Needs live dev runtime (sprint-60 pattern). |
| 56 fuzz targets | Architect CONSIDER: context budget; deferred to dedicated future sprint. |
| 74 UI | Needs live dev runtime. |
| 66 | Cost projection + budget alerts — multi-day, mixed Rust+UI. |
| 67–73 | UI-heavy feature wave 2. |
| 76 | Auto-updater — `tauri-plugin-updater` dep `bun add` gated. |
| 78 | Tray + dock badge — Tauri tray API + UI verify. |
| 79–81 | Plugin v2 compounding-risk pattern. |
| 82 | i18n foundation — `i18next` + `react-i18next` deps. |

## Recommended next pickup

1. **Sprint 74 UI** — `SessionTLDR.tsx` mount + `getSessionTldr` client method.  Backend (sprint 74) + path-hardening + sprint 64 now all green; UI is the last gap.
2. **Sprint 66** (cost forecaster → notification rules engine) — unblocks 67-74.
3. **Sprint 56 fuzz** — `cargo-fuzz` targets for `parse_jsonl_line` + `message_classifier::classify`; opt-in dev workflow documented in `docs/security.md` extension.

## Metrics

- cargo lib: 462 → 467 (sprint 64) → 478 (sprint 56 wave 2). +16 net.
- bun vitest: 668 → 668 (unchanged; both sprints pure Rust).
- bun run typecheck / lint: green throughout.
- `confine()` no longer re-canonicalizes root on each call — single canonicalize at startup, captured into `Arc<PathBuf>`.

## Workaround note (test infra)

Mid-session the sandbox blocked writes to `~/.cargo/registry/src/`, causing
fresh crate extraction to fail (`aead-0.5.2` etc.). Workaround: invoke
cargo with `CARGO_HOME=$TMPDIR/cargo_alt` for the wave 2 test run — the
alternate Cargo home re-extracts to a writable location. No change to
checked-in tooling.

## Files modified

- `src-tauri/Cargo.toml` (added `[dev-dependencies]` + `tempfile = "3"`)
- `src-tauri/src/commands/claude_root.rs` (NEW)
- `src-tauri/src/commands/mod.rs` (`pub mod claude_root;`)
- `src-tauri/src/commands/path_util.rs` (rewrite `confine` + resolvers; drop `projects_root`/`ERR_NO_HOME`)
- `src-tauri/src/commands/sessions.rs` (3 call sites; drop 2 `resolve_claude_dir` calls)
- `src-tauri/src/commands/analytics.rs` (3 call sites)
- `src-tauri/src/commands/agents_search.rs` (3 call sites)
- `src-tauri/src/analysis/commands.rs` (`get_file_graph` gained `State<ClaudeRoot>`)
- `src-tauri/src/analysis/file_graph.rs` (gained `&Path` param)
- `src-tauri/src/snapshots.rs` (forward new state arg into `get_session_detail`)
- `src-tauri/src/lib.rs` (construct + manage `ClaudeRoot` BEFORE `.setup()`)
- `src-tauri/src/watcher.rs` (read managed state; no fallback)
