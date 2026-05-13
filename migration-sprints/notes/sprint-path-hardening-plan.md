# Sprint — Path-Validation Hardening (pre-74-UI)

## Context

Security-auditor HIGH-1 from the 2026-05-16 autonomous run: `resolve_session_path` in `src-tauri/src/commands/path_util.rs` (currently 17 lines) does an unchecked `PathBuf::join` of IPC-supplied `project_id`/`session_id`. Architect-reviewer audit (this sprint) found a SECOND identical helper at `src-tauri/src/analysis/file_graph.rs:93-105` reachable via the `compute_file_graph` IPC command. Both share the flaw; both are blast radius.

IPC commands inheriting the flaw (8 total):
- `get_session_detail` (sessions.rs:145, 161, 180)
- `get_session_detail_incremental` (sessions.rs:211, 218)
- `parse_session` (analytics.rs:13, 27)
- `parse_session_metrics` (analytics.rs:39, 53)
- `get_session_tldr` (analytics.rs:125, 136)
- `search_session_content` (agents_search.rs:475, 491)
- `get_waterfall_data` (agents_search.rs:515 — delegates to `get_session_detail`)
- `get_subagent_detail` (agents_search.rs:525) — ad-hoc join, NOT `resolve_session_path`
- `compute_file_graph` (analysis/commands.rs:45 → file_graph.rs:111) — private duplicate

Sprint fixes the inherited flaw across all of these in one coherent unit so sprint 74 UI (recommended-next #2) can land safely. Pure backend (Rust). No new deps, no UI changes, no IPC signature change (error STRING shapes may change; types do not).

## Layering decision (architect SHOULD)

- **`path_decoder.rs` (in `discovery/`)** = domain knowledge (encoding rules, what a valid id IS). Hosts the regex/validation primitives as `pub`.
- **`path_util.rs` (in `commands/`)** = IPC-boundary trust seam (claude_dir resolution, canonicalize-confine, untrusted-input rejection). Hosts `resolve_session_path` + `resolve_subagent_path`.
- **`subagent_locator.rs` (in `discovery/`)** = single source of truth for subagent on-disk layout. Gains a `pub fn subagent_path(...)` helper that `path_util::resolve_subagent_path` calls.

## Changes

### 1. `src-tauri/src/discovery/path_decoder.rs` — promote + grow validation primitives

- Promote `is_valid_project_id` (currently `#[cfg(test)] mod tests`) to `pub` at module scope. Symmetric with existing `pub fn is_valid_encoded_path`. Architect SHOULD (matches sprint 53 precedent).
- Add `pub fn is_valid_session_id(id: &str) -> bool` — `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$` via `LazyLock<Regex>`. Any-version UUID (security-auditor LOW #1: v4-only would gate on values Claude Code controls, no security gain).
- Length pre-caps inside both validators: `id.len() != 36` reject for session; `id.len() > 512` reject for project (security-auditor LOW #4 DoS).

### 2. `src-tauri/src/commands/path_util.rs` — rewrite as IPC trust-seam

Replace the 17-line file with:

```rust
pub const ERR_INVALID_SESSION_ID: &str = "invalid session id";
pub const ERR_INVALID_PROJECT_ID: &str = "invalid project id";
pub const ERR_INVALID_SUBAGENT_ID: &str = "invalid subagent id";
pub const ERR_ESCAPES_ROOT: &str = "path escapes session root";
pub const ERR_NO_HOME: &str = "Cannot resolve home directory";

pub fn resolve_session_path(project_id: &str, session_id: &str) -> Result<PathBuf, String>;
pub fn resolve_subagent_path(project_id: &str, parent_session_id: &str, subagent_id: &str) -> Result<PathBuf, String>;
```

Const error strings (architect CONSIDER) for greppable / forward-compat pattern-matching without committing to a typed-error wrapper now (YAGNI).

Internal pipeline (one shared `confine` helper):
1. Validate `session_id` via `path_decoder::is_valid_session_id`. Reject → `ERR_INVALID_SESSION_ID`.
2. Validate `project_id` via `path_decoder::is_valid_project_id`. Reject → `ERR_INVALID_PROJECT_ID`.
3. Resolve claude_dir + build candidate: `claude_dir / "projects" / base_dir / "<id>.jsonl"`.
4. **Canonicalize confinement (only if candidate exists)**: `canonicalize` candidate + projects root; assert `starts_with`. If not, return `ERR_ESCAPES_ROOT`. If candidate does NOT exist, return joined path verbatim — the validation regexes already exclude every traversal payload (metis SHOULD; no `Path::components()` walk needed).
5. Error strings NEVER echo raw input (sprint 53 precedent; security-auditor #3).

`resolve_subagent_path` validates `parent_session_id` + `subagent_id` (both UUID-shaped) + `project_id`, then delegates to `subagent_locator::subagent_path` (new helper) to build the candidate, then runs the same canonicalize-confine. Single source of truth for layout (architect MUST).

### 3. `src-tauri/src/discovery/subagent_locator.rs` — extract layout helper

Add (architect MUST — kill the 4-copy drift):
```rust
pub fn subagent_path(projects_dir: &Path, project_id: &str, parent_session_id: &str, subagent_id: &str) -> PathBuf;
```
Returns `projects_dir / extract_base_dir(project_id) / parent_session_id / "subagents" / "<subagent_id>.jsonl"` (NEW layout). `has_subagents` continues to handle the OLD-layout fallback separately — sprint scope is the NEW-layout `get_subagent_detail` joins only. The pre-existing inlined layout in `has_subagents` is NOT refactored this sprint (surgical-change rule); a follow-up sprint can dedupe.

### 4. `src-tauri/src/analysis/file_graph.rs` — delete duplicate `resolve_session_path`

Architect MUST: delete the private `fn resolve_session_path` at lines 93-105 (the duplicate) and replace its single callsite at line 111:
```rust
let path = crate::commands::path_util::resolve_session_path(project_id, session_id)?;
// preserve "session file not found" semantics
if !path.is_file() {
    return Err("session file not readable".to_string());  // path stripped per security-auditor #3
}
```
The existing `path.display()` echo at the original line 102 is replaced with a path-free error (security-auditor HIGH #3).

### 5. `src-tauri/src/parsing/session_parser.rs` — strip raw path from error strings

Security-auditor HIGH #3. Three sites:
- `session_parser.rs:77` — `format!("Failed to open {}: {e}", file_path.display())` → `"failed to open session file"` (path stripped; caller already knows which session it asked for).
- `session_parser.rs:88-89` — `eprintln!("[parser] Error reading line in {}: {e}", file_path.display())` — KEEP (this is `eprintln!` to dev logs, NOT returned to renderer; sprint 53 precedent draws the line at IPC return values).
- `session_parser.rs:116` — same `Failed to open` formatter in `parse_jsonl_incremental` → same fix.

Sprint scope explicitly LIMITS this change to error strings RETURNED to the renderer (i.e., function `Result<_, String>` paths). Internal `eprintln!`/`tracing` left alone.

### 6. `src-tauri/src/commands/agents_search.rs` — switch `get_subagent_detail` to helper

Current ad-hoc join at agents_search.rs:**534-539** (security-auditor #9 line-ref correction):
```rust
let projects_dir = path_decoder::get_projects_base_path(&claude_dir);  // line 532 — REMOVE
let base_dir = path_decoder::extract_base_dir(&project_id);             // line 534 — KEEP (used by decode_path at line 546)
let subagent_path = projects_dir.join(&base_dir).join(&session_id).join("subagents").join(format!("{subagent_id}.jsonl"));  // lines 535-539 — REPLACE
```
Replace lines 532 + 535-539 with: `let subagent_path = resolve_subagent_path(&project_id, &session_id, &subagent_id)?;`. Keep line 534 (`base_dir` is reused by `decode_path` at line 546).

### 7. Cache-key validation order

Security-auditor MEDIUM #11: cache lookup happens BEFORE id validation today. Concrete sites:
- sessions.rs:155 / :219, analytics.rs:18 / :44 / :130, agents_search.rs:485.

Fix: at the TOP of each `#[tauri::command]` body using a `cache_key = format!("{project_id}/{session_id}")`, call a new `path_util::validate_session_id_pair(project_id, session_id) -> Result<(), String>` (cheap: just the two `is_valid_*` checks, no syscall). On reject, return the structured error BEFORE constructing the cache key or touching the cache.

This is preferred over canonicalize-as-cache-key (would force a syscall on every cache hit, doubling cold-path cost).

### 8. `get_all_todos` (sessions.rs:33-78) — minimal fix in scope

Security-auditor MEDIUM #8: `project_id` from `Vec<String>` in IPC, joined via `projects_dir.join(base_id)` then `read_dir`. The corrected risk model: directory enumeration over attacker-chosen path is a file-existence oracle (read of `~/.ssh/*.jsonl` would return empty in practice, but principle stands). 3-line fix:
```rust
for project_id in &project_ids {
    if !path_decoder::is_valid_project_id(project_id) { continue; }  // NEW guard
    // ... existing loop body unchanged ...
}
```
Skip-on-invalid (not error-out) because callers may pass a heterogeneous list and we want partial-success semantics consistent with existing `read_dir` Err handling.

### 9. Tests — `src-tauri/src/commands/path_util.rs` `#[cfg(test)] mod tests`

Negative tests (REQUIRED, all must reject):
- `session_id = "../../../etc/passwd"` → `ERR_INVALID_SESSION_ID`
- `session_id = "abc\u{0}def"` → reject (null byte)
- `session_id = "abc\u{1b}[31m"` → reject (control char)
- `session_id = "ABCD"` → reject (not 36-char)
- `session_id = ""` → reject
- `session_id` 36-char-but-non-hex (e.g., `"gggggggg-gggg-gggg-gggg-gggggggggggg"`) → reject
- `project_id = "../escape"` → reject (no leading dash)
- `project_id = "-Users-name-project::SHORT"` → reject (composite hash not 8 hex)
- `project_id = "-Users-name-project::../../etc"` → reject (security-auditor #10 composite-with-traversal)
- `project_id = "-..\u{0}"` → reject (null byte after `-..`)
- `project_id = "-foo"` + 1MB suffix → reject (length cap)
- `project_id = "-Users-name-project\u{0}"` → reject
- `subagent_id` traversal payload via `resolve_subagent_path` → reject

Positive tests:
- 10 hardcoded valid UUID literals all accepted (metis MUST-NOT — no `rand` dep).
- Composite project id `-Users-…::abcdef01` → base dir extracted correctly.
- Valid subagent triple → `resolve_subagent_path` returns EXACTLY the same path as `subagent_locator::subagent_path(...)` (architect MUST: literal `==` cross-reference test against single-source-of-truth helper, even though we already delegate).
- `project_id = "-.."` with valid session_id → benign resolve (dir doesn't exist; canonicalize branch skipped; returns joined path).

### 10. Verification grep (widened — architect MUST)

Run AFTER implementation, must show zero hits outside the hardened helpers:
```
grep -rn "\.join(.*session_id\|\.join(.*subagent_id\|\.join(.*project_id\|fn resolve_session_path" src-tauri/src/ --include='*.rs'
```
Expected remaining hits (intentional, documented in Non-Goals):
- `sessions.rs:38` (`get_all_todos` `project_id` join — guarded by step 8)
- `sessions.rs:50` (`session_id` from `read_dir`, not IPC — safe)
- `discovery/session_lister.rs` `session_id` from `read_dir` — safe
- `bin/cli.rs:108` `session_id.jsonl` join — separate Non-Goal (CLI binary)
- `subagent_locator.rs` `has_subagents` OLD-layout — separate Non-Goal
- `subagent_resolver.rs` — discovery-layer, not IPC

## Implementation Order

1. `path_decoder.rs` — promote `is_valid_project_id` to `pub`, add `is_valid_session_id`, add length caps.
2. `subagent_locator.rs` — add `pub fn subagent_path`.
3. `path_util.rs` — rewrite with const errors + `resolve_session_path` + `resolve_subagent_path` + `validate_session_id_pair`.
4. Wire `validate_session_id_pair` into each cache-keyed command (step 7).
5. `agents_search.rs::get_subagent_detail` — switch to `resolve_subagent_path` (step 6).
6. `file_graph.rs` — delete duplicate, import hardened helper, strip error path (step 4).
7. `session_parser.rs` — strip path from `Failed to open` errors (step 5).
8. `sessions.rs::get_all_todos` — add `is_valid_project_id` guard (step 8).
9. Add tests (step 9).
10. `cargo test --lib` → all green (441 + ~15 new = ~456 pass).
11. `cargo check` → zero warnings.
12. `bun run quality` → green.
13. Verification grep (step 10) → expected remainders only.
14. Single commit: `fix(security): harden session path resolution (UUID validation + canonicalize-confine)`.

## Verification

- `cargo test --lib commands::path_util` → 13 negative + 4 positive tests pass.
- `cargo test --lib path_decoder` → existing tests + 1 new (`is_valid_session_id` positive/negative).
- `cargo test --lib` → ~456 pass.
- `cargo check` → no new warnings.
- `bun run quality` → green (lint, format, knip, types, tests, build).
- Verification grep (step 10).

## Non-Goals

- Public IPC signature change (renderer passes `String` IDs; validation is transparent; only error-string content sharpens).
- Renaming `path_util.rs`.
- Hardening OTHER IPC-path-conversion commands (`read_agent_configs`, `read_global_*`) — separate broader-audit sprint (security-auditor #12).
- `subagent_locator::has_subagents` OLD-layout `agent_*.jsonl` join — discovery-time, OS-controlled filenames, separate dedupe sprint (architect CONSIDER).
- `subagent_resolver.rs` joins — discovery-layer, sourced from `read_dir`, not IPC.
- `bin/cli.rs:108` unchecked join — CLI binary; sprint 53 already documents path-traversal hardening separately (architect CONSIDER).
- Refactoring `get_session_detail`'s double-call to `resolve_session_path` (sessions.rs:161 + :180) — pre-existing pattern; surgical-change rule. Architect-reviewer flags as 2-line follow-up; deferred. Doubled `canonicalize` syscall cost on cold loads accepted as tradeoff (metis CONSIDER).
- **TOCTOU defense via fd-realpath / `O_NOFOLLOW`** — sprint 53 precedent (PLAN.md:69) documents the user-owned-files trust boundary; same boundary applies to a single-user desktop Tauri app. If sprint 55's SFTP source ever routes through `resolve_session_path`, that boundary collapses → 55 maintains a separate validated reader. (Security-auditor MEDIUM #2.)
- **`CLAUDE_ROOT` env honor in `watcher::resolve_claude_dir()`** — sprint 53 removed equivalent for CLI; GUI keeps it for dev/test (point at fixture dir). Same-user trust boundary. (Security-auditor LOW #7.)
- **NFC unicode normalization** — ASCII-only character classes in regexes make NFC redundant. Plan does NOT add `unicode-normalization` dep. (Security-auditor MEDIUM #6.)
- **Typed-error wrapper** (`enum PathResolveError`) — const string error categories (step 2) satisfy 80% of forward-compat; full typed wrap is a focused future sprint when renderer-side need is concrete. (Architect CONSIDER.)
- **`get_session_detail` double-call refactor** — 2-line lift of `file_path` out of cache scope; deferred follow-up. (Architect CONSIDER.)

## Review Trail

### Metis Plan Consultant
- [x] [MUST] Promote `is_valid_project_id` to `pub` (architect upgraded `pub(crate)` → `pub`)
- [x] [MUST] `get_all_todos` brought INTO scope (3-line `is_valid_project_id` guard — security-auditor MEDIUM #8 corrected the risk-model rationale)
- [x] [MUST-NOT] No `rand` dep — hardcoded UUID fixtures
- [x] [SHOULD] No `Path::components()` walk for non-existent paths
- [x] [SHOULD] Scope constraint: do not refactor `get_session_detail` double-call
- [x] [SHOULD] Subagent positive test asserts `==` against `subagent_locator::subagent_path` (now single source of truth)
- [x] [CONSIDER] Double-`canonicalize` syscall cost documented

### Security Auditor
- [x] [HIGH #3] Error-string sanitization across `session_parser.rs` + `file_graph.rs` (Change #4 + #5)
- [x] [MEDIUM #2] TOCTOU trust boundary documented in Non-Goals (sprint 53 precedent inherited)
- [x] [MEDIUM #6] NFC clause dropped — ASCII regex makes it redundant; no `unicode-normalization` dep
- [x] [MEDIUM #8] `get_all_todos` corrected from "iterate empty dir" to "directory enumeration oracle"; brought into scope with `is_valid_project_id` guard
- [x] [MEDIUM #11] Cache-key validation order fixed — `validate_session_id_pair` called BEFORE cache lookup
- [x] [LOW #1] UUID regex stays any-version (v4-only rejected as no-security-gain)
- [x] [LOW #4] Length pre-caps: `session_id.len() != 36`, `project_id.len() > 512`
- [x] [LOW #5] Symlink-swap trust boundary documented (Non-Goals)
- [x] [LOW #7] `CLAUDE_ROOT` env honor documented in Non-Goals
- [x] [LOW #9] Line refs corrected: `agents_search.rs:534-539` (was 535-539); explicit `keep base_dir` / `remove projects_dir`
- [x] [LOW #10] Negative tests added for composite-with-traversal-hash and `-..`
- [x] [LOW #12] `read_agent_configs` / `read_global_*` documented in Non-Goals

### Architect Reviewer
- [x] [MUST] `analysis/file_graph.rs:93-105` duplicate `resolve_session_path` ADDED TO SCOPE (Change #4 — 8th IPC entry point)
- [x] [MUST] Verification grep widened to `src-tauri/src/` (step 10)
- [x] [MUST] `subagent_locator::subagent_path` as single layout source; `resolve_subagent_path` delegates; literal `==` cross-reference test
- [x] [SHOULD] Validation primitives co-located in `path_decoder.rs` as `pub`; `resolve_*` stays in `path_util.rs` (layering: domain vs trust)
- [x] [SHOULD] `pub` (not `pub(crate)`) for `is_valid_project_id` — matches sprint 53 precedent
- [x] [CONSIDER] Const error strings (`ERR_INVALID_SESSION_ID` etc.) — forward-compat without typed-error commitment
- [x] [CONSIDER] `get_session_detail` double-call documented as 2-line follow-up Non-Goal
- [x] [CONSIDER] 4-copy subagent layout drift acknowledged — only `get_subagent_detail` deduped this sprint; `has_subagents` / `subagent_resolver` follow-up

### Momus Plan Reviewer
- [x] All file paths exist
- [x] All cited line numbers match HEAD
- [x] `subagent_path` no name collision
- [x] Verification grep runs cleanly
- [x] Implementation order internally consistent
- [x] Negative test list concrete (13+ cases)
- [INFO] grep emits 2 unenumerated benign remainders (`path_decoder.rs:200` build_todo_path internal helper; `path_decoder.rs:225-226` inside `#[cfg(test)]` test mod) — confirmed safe
- **VERDICT: READY**

## Execution Result

Cargo: 441 → 462 (+21) passed. Frontend: 668 vitest pass unchanged. `bun run check` (types + lint + test + build) green. Format/knip drift on `windowBus.ts` + 39 unused files pre-exists from prior sprints — out of scope (surgical-change rule).

Files modified (9 source + plan):
- `src-tauri/src/discovery/path_decoder.rs` — promoted `is_valid_project_id` to `pub`; added `is_valid_session_id` + length caps + composite-hash regex
- `src-tauri/src/discovery/subagent_locator.rs` — added `pub fn subagent_path` (single layout source)
- `src-tauri/src/commands/path_util.rs` — rewrite: const error strings + `resolve_session_path` + `resolve_subagent_path` + `validate_session_id_pair` + 18 tests
- `src-tauri/src/commands/mod.rs` — `path_util` now `pub mod` (for `file_graph` cross-module import)
- `src-tauri/src/commands/sessions.rs` — `validate_session_id_pair` before cache lookup (2 commands) + `is_valid_project_id` guard in `get_all_todos`
- `src-tauri/src/commands/analytics.rs` — `validate_session_id_pair` before cache lookup (3 commands)
- `src-tauri/src/commands/agents_search.rs` — `validate_session_id_pair` in `search_session_content`; `get_subagent_detail` switched to `resolve_subagent_path`
- `src-tauri/src/analysis/file_graph.rs` — deleted duplicate `resolve_session_path`; imports hardened helper; "session file not readable" error (path stripped)
- `src-tauri/src/parsing/session_parser.rs` — `Failed to open <path>` → `failed to open session file` (2 sites; `eprintln!` kept per plan)
