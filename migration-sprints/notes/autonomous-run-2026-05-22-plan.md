# Autonomous Run Plan — 2026-05-22

Continue 32-week sprint roadmap. Prior runs landed sprints 51-58, 60 (deferred), 63, 74 backend, 75, 77, path-hardening (pre-74-UI). Sprint 74 UI deferred (needs live runtime); sprint 64 split here into Rust-only root-confinement (shippable now) + cold-start measurement (deferred to live run, sprint-60 pattern).

## Scope this run

**Primary: Sprint 64 (security half) — Canonical root capture + confine pre-canonical fix**

Sprint 56 fuzz secondary EXPLICITLY DROPPED from this run per architect CONSIDER (context budget; 5 files + 9 IPC sites + 3 tempfile-symlink tests is enough for one commit).

### Code changes

1. **NEW file `src-tauri/src/commands/claude_root.rs`** (per architect SHOULD — file-cap discipline; `path_util.rs` is at 230 lines and the proposed changes would push it past 400-line target).
   - `pub struct ClaudeRoot(Arc<PathBuf>)`
   - `pub fn new() -> Self` — canonicalizes `resolve_claude_dir()?` (i.e. `~/.claude`) then joins `"projects"` lexically. Handles non-existent `projects` (first-run): canonical parent + non-canonical leaf is still TOCTOU-safe because `confine()` candidate-canonicalize compares via `starts_with(canonical_root)` — when `projects/` is later created, all real candidate paths still live under the canonical parent.
   - `pub fn canonical_projects(&self) -> &Path`
   - `#[cfg(test)] pub fn for_test(path: PathBuf) -> Self` — gated to test builds only (security HIGH-2: avoid prod-callable bypass).

2. **`src-tauri/src/commands/path_util.rs` rewrite of `confine()`** — current line 33 calls `std::fs::canonicalize(root)` on every invocation (live re-derive). Replace with:
   - `pub fn confine(candidate: PathBuf, canonical_root: &Path) -> Result<PathBuf, String>` — accepts pre-canonical root. Only canonicalizes candidate (when it exists). Compares `starts_with(canonical_root)`.
   - **No fallback for non-canonical root**. Production callers MUST pass a canonical root; tests build one via `tempfile::TempDir::path()` + `std::fs::canonicalize`.
   - The existing line 29-31 short-circuit for non-existent candidate is **preserved** — it's orthogonal to root canonicalization and serves legitimate first-time-create flows.

3. **`path_util::resolve_session_path` signature change**:
   - **OLD**: `pub fn resolve_session_path(project_id: &str, session_id: &str) -> Result<PathBuf, String>` — internally derives root.
   - **NEW**: `pub fn resolve_session_path(canonical_root: &Path, project_id: &str, session_id: &str) -> Result<PathBuf, String>` — root is explicit. Same change applies to `resolve_subagent_path` (adds leading `&Path` arg).
   - **Single API, no dual variant** (per architect SHOULD — collapses dual-API footgun). The `projects_root()` private helper is removed entirely.
   - **Removed `ERR_NO_HOME`** const — no longer reachable from `path_util`.

4. **`lib.rs`** — compute `ClaudeRoot::new()` synchronously BEFORE `.manage()`. Per architect SHOULD: option (ii), avoid OnceCell/interior-mutability overhead. Order:
   ```rust
   let claude_root = commands::claude_root::ClaudeRoot::new();
   tauri::Builder::default()
       ...
       .manage(claude_root)
       .manage(Mutex::new(watcher::WatcherState::default()))
       ...
       .setup(|app| { ... start_watcher(&handle) ... })
   ```

5. **`watcher.rs`** — internal `app.state::<ClaudeRoot>()` lookup (per metis SHOULD — consistency). REMOVE the prior plan's "warm-up canonicalize if state absent" branch (security HIGH-3: that re-introduced silent fallback). `start_watcher` either reads canonical root or returns Err; no canonicalize-at-call.

6. **IPC migration — all 9 call sites take `claude_root: tauri::State<'_, ClaudeRoot>`** (architect MUST-1 + security HIGH-1 + HIGH-2):
   - `commands/sessions.rs:165, 184, 223` — `get_session_detail`, `get_session_detail_incremental`. Also replace separate `watcher::resolve_claude_dir()` (line 156, 221) with `claude_root.canonical_projects()`. The local `projects_dir = path_decoder::get_projects_base_path(&claude_dir)` is now derived from canonical state.
   - `commands/analytics.rs:28, 55, 139` — three call sites.
   - `commands/agents_search.rs:493, 533` — two call sites.
   - `analysis/file_graph.rs:93` — `compute_file_graph(project_id, session_id)` bubbles up to `analysis/commands::get_file_graph` Tauri command. Both signatures gain `canonical_root: &Path` (function) / `claude_root: State<ClaudeRoot>` (Tauri command). Note: `get_file_graph` currently has NO `AppHandle`/`State` params (architect HIGH-1 confirmed in code inspection: `analysis/commands.rs:41-46`).

7. **Negative tests inside `commands/claude_root.rs` `#[cfg(test)]` mod** (security MEDIUM correction — Tests A+B+C all using real tempfile FS):
   - **Test A: confine rejects post-swap candidate.** Use `tempfile::TempDir`. Plant real symlink `<tempdir>/<UUID>.jsonl -> /etc/passwd` (or an out-of-root tempfile target on systems where `/etc/passwd` reads fail). Call `confine(<symlinked_path>, &canonical_tempdir)`. Assert `Err(ERR_ESCAPES_ROOT)`.
   - **Test B: pre-canonical root never re-canonicalized.** Construct tempdirs A, B. Make root A symlink → B. Compute `canonical_a = canonicalize(A)` (= B). Then `swap A → C` (new tempdir). Call `confine(<candidate under C>, &canonical_a)` — must reject (C is not under B).
   - **Test C (end-to-end): `resolve_session_path` with captured canonical root rejects swap.** Construct canonical root via tempdir, then mid-test plant a symlink-swap inside the project subdir pointing outside root. Call `resolve_session_path(&captured_canonical_root, project_id, session_id)` where the resulting candidate dereferences outside root. Assert `Err(ERR_ESCAPES_ROOT)`.
   - **macOS canonicalization quirk** (security LOW): `tempfile::TempDir` paths go through `/private/var` → `/var` canonicalization on macOS. Tests must canonicalize the root before assertions or `starts_with` spuriously fails. Use `std::fs::canonicalize(tempdir.path())` consistently.

### Files in scope

- `src-tauri/src/commands/claude_root.rs` (NEW)
- `src-tauri/src/commands/mod.rs` — `pub mod claude_root;` re-export
- `src-tauri/src/commands/path_util.rs` — `confine` signature, `resolve_session_path` signature, drop `projects_root()` helper, drop `ERR_NO_HOME`
- `src-tauri/src/lib.rs` — construct + manage `ClaudeRoot` before `.setup()`
- `src-tauri/src/watcher.rs` — read managed state, no fallback canonicalize
- `src-tauri/src/commands/sessions.rs` (3 call sites + 2 `resolve_claude_dir` removals)
- `src-tauri/src/commands/analytics.rs` (3 call sites)
- `src-tauri/src/commands/agents_search.rs` (2 call sites)
- `src-tauri/src/analysis/file_graph.rs` (1 call site — add `canonical_root: &Path` param)
- `src-tauri/src/analysis/commands.rs` (`get_file_graph` Tauri command — add `claude_root: State<ClaudeRoot>` param)

### Non-goals

- Cold-start `-200ms` timing measurement (deferred — needs live runtime).
- Touching `dirs::home_dir()` call sites in SSH / config / plugins / snapshots — out of scope for sprint 64 (those are not on the IPC path the captured root targets).
- Sprint 56 fuzz targets (deferred — context budget per architect CONSIDER).
- Removing existing `confine()` short-circuit for non-existent candidate (line 29-31 today) — preserved.
- `openat2(RESOLVE_NO_SYMLINKS)` — Linux-only, not portable; documented as known residual TOCTOU per security MEDIUM.

### Verification

1. `cargo check` clean
2. `cargo test` — Tests A+B+C green. Existing 462 still pass (some IDs adapted to new resolver signature; expect zero behavior regressions).
3. `bun run typecheck` unchanged (pure Rust sprint)
4. `bun run quality` no new knip orphans
5. Verification grep: `rg "resolve_session_path\(|resolve_subagent_path\(" src-tauri/src/` — every match must pass a `&Path` root arg or be a test using `tempfile`.

### Commit

- `feat(security): sprint 64 - canonical root capture + confine pre-canonical fix`
- Commit body references CWE-59 (symlink following) + CWE-367 (TOCTOU).

## Review Trail

### Metis Plan Consultant
- [x] MUST: silent fallback in `resolved_projects_root` removed — `projects_root()` helper deleted entirely; single explicit-root API
- [x] MUST: symlink-swap negative test redesigned — Tests A+B+C exercise the actual attack via tempfile FS, not Arc identity
- [x] MUST: `confine()` re-canonicalize-root bug fixed in plan — accepts pre-canonical root, only canonicalizes candidate
- [x] SHOULD: kept `ClaudeRoot` simple struct (per metis), but moved to `commands/claude_root.rs` per architect file-cap rule (see below)
- [x] SHOULD: watcher continues to read `app.state::<ClaudeRoot>()` internally
- [x] CONSIDER: `docs/security.md` exists already — sprint 56 secondary dropped from this run

### Security Auditor
- [x] HIGH-1: `analysis/file_graph.rs:93` call site added to scope — migrates to `&Path canonical_root` param + `get_file_graph` Tauri command gains `State<ClaudeRoot>`
- [x] HIGH-2: dual-API footgun eliminated — collapsed to single `resolve_session_path(&Path, ...)` API; no `_with_root` variant. `ClaudeRoot::for_test` gated `#[cfg(test)]` only
- [x] HIGH-3: watcher warm-up fallback REMOVED — no canonicalize-at-call inside watcher; reads canonical state or hard-errors
- [x] MEDIUM (Test C): end-to-end test added — `resolve_session_path` with captured canonical root rejects symlink-swap candidate
- [x] MEDIUM (for_test exposure): `#[cfg(test)]`-gated, not `pub(crate)` exposed
- [x] MEDIUM (residual TOCTOU at File::open): documented as known residual in Non-goals
- [x] LOW (macOS canonicalize quirk): noted in Test scaffolding
- [x] LOW (commit CWE ref): commit message references CWE-59 + CWE-367

### Architect Reviewer
- [x] MUST-1 (test-signature contradiction): resolved — single `resolve_session_path(&Path, ...)` API. Tests pass tempfile-based root explicitly. `projects_root()` helper deleted.
- [x] MUST-2 (file_graph.rs:93 untracked): added to scope; both `compute_file_graph` and `get_file_graph` migrated.
- [x] SHOULD (dual-API duplication): collapsed to single API (no `_with_root` variant proliferation).
- [x] SHOULD (file-cap discipline): `ClaudeRoot` moved to NEW `commands/claude_root.rs` instead of inlining in `path_util.rs` (which would exceed 400-line target).
- [x] SHOULD (watcher setup-ordering): option (ii) — compute `ClaudeRoot::new()` synchronously BEFORE `.manage()`. No interior mutability / OnceCell wrapping.
- [x] SHOULD (watcher warm-up half-fallback): removed.
- [x] CONSIDER (sprint 56 sub-crate): sprint 56 secondary dropped from this run; deferred to a dedicated future sprint.
- [x] CONSIDER (CLI compat): confirmed — `src/bin/cli.rs` does NOT import `path_util` (grep clean).

### Momus Plan Reviewer
- [x] WARNING (tempfile not in Cargo.toml): add `[dev-dependencies]\ntempfile = "3"` to `src-tauri/Cargo.toml`. No `[dev-dependencies]` section exists currently — add fresh section.
- [x] INFO: all file paths verified; all line numbers verified against HEAD; `commands/mod.rs` has alphabetical module ordering — `pub mod claude_root;` slots between `analytics` and `files`.
- [x] INFO: 9 call sites tracked (5 sessions + 3 analytics + 2 agents_search + 1 file_graph) — verified.
- [x] INFO: `dirs::home_dir()` exclusion list verified safe (no user-controlled `project_id`/`session_id` flows into session-file resolvers from the excluded paths).
- [x] INFO: single-API claim consistent throughout (no leftover `_with_root` variant language).
- **VERDICT: READY for implementation.**
