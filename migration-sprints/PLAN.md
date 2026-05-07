# 32-Week Sprint Roadmap (Sprints 51–82)

## Goal
Continue evolution of claude-devtools-tauri on top of sprints 1–50 (analytics, plugins, themes, accessibility, onboarding, file-cap hardening). Sprints 51–82 cover tech debt recovery, performance, new feature wave, cross-platform packaging, plugin wave 2.

## Principles
- One sprint = one week = one deliverable theme; one commit per sprint.
- Each sprint independently shippable; cross-sprint deps explicit below.
- Prefer extending existing slices/components over parallel hierarchies.
- File limits: 400 line target / 800 hard cap per file; 50-line functions; 3 nest levels.
- No new top-level architecture unless a sprint exists for it.
- All sprints must keep `bun run quality` green at commit time.

## Current-State Justification (audit at sprint 50 close)
- `src/renderer/components/chat/ChatHistory.tsx` = **1030 lines** → past hard cap; sprint 51 mandates split.
- `src-tauri/src/commands/mod.rs` = **745 lines** → sprint 44 split intent only partially executed (only `agents_search.rs` extracted). Sprint 52 finishes split.
- `src-tauri/src/parsing/entry_parser.rs` = **757**, `message_classifier.rs` = **750**, `session_parser.rs` = **712** → near hard cap, monitored, sprint 56 carries refactor if any test work pushes them past 800.
- `src/renderer/store/slices/tabSlice.ts` = **733** lines → near cap; sprint 57 splits comparison concerns out (was prerequisite for old sprint 28; still mixed).
- `src/renderer/utils/groupTransformer.ts` = **714**, `tauriClient.ts` = **712** → flagged for sprint 51/52 incidental split if touched.
- Test files: **56** vitest tests total; coverage gaps in IPC handlers, Rust analytics, ssh module → sprints 58–60 target.
- Scope-cut history (commit log): sprints **44** (CLI/workspace), **45** (SFTP), **47** (cross-window bus) shipped flagged "scope-cut"; sprints 53–55 finish each.

## Phase Overview

| Phase | Sprints | Theme |
|-------|---------|-------|
| F | 51–58 | Tech debt & scope-cut recovery |
| G | 59–65 | Performance & polish |
| H | 66–74 | Feature wave 2 |
| I | 75–78 | Cross-platform & packaging |
| J | 79–82 | Plugin/extensibility wave 2 (hooks → marketplace → host hardening → i18n) |

## Sprint Index

### Phase F — Tech Debt & Scope-Cut Recovery (51–58)

**51 — Split `ChatHistory.tsx` (HARD-CAP REMEDIATION; architect [MUST] #2)**
- `src/renderer/components/chat/ChatHistory.tsx` (1030) — correct seams:
  - **Extract `ChatHistoryVirtualizer.tsx`** (rowSizer + measure cache + tanstack/react-virtual wiring).
  - **Move `ScrollController`** from `src/renderer/utils/scrollController.ts` (existing, 111 lines) to `src/renderer/services/scrollController.ts` — single owner of the writer-union from sprint 26 (so sprint 68 scrubber and sprint 26 minimap share one owner; otherwise scrubber duplicates writer logic). **Update importer**: `src/renderer/components/chat/SessionMinimap.tsx` currently imports from `@renderer/utils/scrollController`; rewrite to new path. Delete old file.
  - **Extract `useChatHistoryScroll.ts`** hook (owns refs + effects; delegates writer state to the new service).
  - **`ChatHistoryEmptyStates.tsx` is OUT — sprint 49 already centralized EmptyState.** Reuse, do not re-create.
  - Parent retains ≤400 lines, orchestrator role only.
- No behavior change. Existing scroll tests pass.
- QA: 1) load large session (≥500 chunks) — scroll restore identical to before. 2) `bun run test` for `useChatHistoryScroll` + `scrollController` (new). 3) `bun run quality` green.

**52 — Finish `commands/mod.rs` split + capabilities audit + CSP enable (sprint 44 follow-on; architect [MUST] #3)**
- `src-tauri/src/commands/mod.rs` (745) → extract by domain into **six** modules (not five):
  - `commands/sessions.rs` — session list/load/detail (excludes analytics commands)
  - `commands/projects.rs` — project scan/list
  - `commands/config.rs` — config read/write
  - `commands/window.rs` — multi-window/pane (sprint 47 followups)
  - `commands/system.rs` — system info, opener, dialog
  - `commands/files.rs` — `validate_path`, `validate_mentions`, `read_claude_md_files`, `read_mentioned_file`, `read_directory_claude_md` (filesystem + CLAUDE.md reads — cross-domain)
  - `commands/analytics.rs` — `link_tool_calls`, `parse_session`, `get_analytics`, `get_cost_forecast`
- `agents_search.rs` stays as-is. `mod.rs` becomes pure re-export ≤80 lines.
- `[tauri::command]` registration in `lib.rs` updated; no removed commands.
- Serde API snapshot test (added sprint 44) must remain green to prove no signature regression.
- **Security (auditor #16; momus #5)**: Audit `src-tauri/capabilities/default.json` — restrict each command to minimum window scope (no command exposed to a window that doesn't need it). **Also tighten `shell:allow-spawn` and `shell:allow-execute`** which are currently broad — replace with scoped `shell:allow-open` for the specific URI patterns sprint 73 needs (`file://` under `~/.claude/` + project root). This protects sprint 73's "never spawn arbitrary `Command::new`" guarantee.
- **Security (auditor #16)**: Enable CSP in `src-tauri/tauri.conf.json` — currently `"csp": null`. Set `"csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"` (tighten further if app loads no remote resources). Verify dev build still loads (Vite HMR needs `connect-src ws:` in dev).
- QA: `cargo check` + `cargo test`; manual session load + open settings still works; CSP violations checked in DevTools console (zero on golden path).

**53 — `claude-devtools-cli` companion (sprint 44 scope-cut; auditor [HIGH] #1)**
- `src-tauri/src/bin/cli.rs` exists but stub. Add subcommands: `list-projects`, `list-sessions <project>`, `show-session <id> --format json|markdown`, `tail <session-id>`.
- Share parsing crate via existing lib (`claude_devtools_lib`). New deps: `clap` **pinned to exact version** in `Cargo.toml`.
- Output: stdout JSON or human; no Tauri runtime touched.
- **Security — path traversal hardening (auditor [HIGH] #1, comprehensive)**:
  - (a) **Symlink-safe canonicalization**: `std::fs::canonicalize` the candidate path AFTER joining to root, then verify resolved path is still inside root. Reject if canonical path escapes root via symlink.
  - (b) **TOCTOU defense**: open the file first, then check the fd's realpath via `/proc/self/fd/<n>` on Linux or `F_GETPATH` fcntl on macOS. On Windows, accept opening with `FILE_FLAG_OPEN_REPARSE_POINT` cleared. (If platform-portable fd-realpath is too costly for this sprint, document the TOCTOU as known and limit CLI to user-owned files; security-auditor accepted.)
  - (c) **Null-byte + Unicode**: reject `<id>`/`<project>` containing `\u{0}`, control chars, or path separators outside ASCII alphanumerics + `-_`. Apply NFC normalization before comparison.
  - (d) **Env injection**: ignore `CLAUDE_HOME` / `HOME` overrides from env; pin root via `dirs::home_dir()` once at startup. If `dirs::home_dir()` is None, exit with error (no fallback to `/`).
  - (e) **`tail` rate limit**: cap stdout emit at 10 MB/s and 100k lines/session to prevent DoS-as-pipe-flood. Use existing `tokio::time::interval` if needed.
- Docs: `docs/cli.md` already exists (sprint 44) — expand with the four subcommands and the security limits.
- QA: `cargo test --bin claude-devtools-cli`; manual `cargo run --bin claude-devtools-cli -- list-projects` returns non-empty on dev box.
- **Negative tests (REQUIRED)**: 1) `show-session "../../../etc/passwd"` → exit non-zero "path outside session root". 2) Plant symlink `~/.claude/projects/test/leak -> /etc/passwd`; `show-session test/leak` → rejected. 3) `show-session $'\u{0}injected'` → rejected. 4) `CLAUDE_HOME=/tmp show-session foo` → uses real home, ignores env.

**54 — Cross-window state bus full (sprint 47 scope-cut)**
- Sprint 47 shipped scope-cut `windowBus`. Finish: round-trip config writes through Rust, Lamport seq strict-ordered queue, `window_ready` handshake mandatory before seed, 50ms topic coalesce verified.
- File: `src/renderer/services/windowBus.ts` (existing) → extend; `src-tauri/src/commands/window.rs` (post-52 path) → broadcast helper.
- New test: `test/renderer/services/windowBus.test.ts` — seeded order, coalesce window, handshake gate.
- QA: open 2 windows in dev build; verify config edit in window A reflects in B within 100ms via Rust round-trip, not direct postMessage.

**55 — SSH SFTP tail provider full (sprint 45 scope-cut; auditor [CRITICAL] #2, [MEDIUM] #3, [LOW] #4)**
- Existing `src-tauri/src/ssh/` (382 + 362 lines) has reconnect policy. Finish: SFTP-backed `~/.claude/projects/` reader, debounced poll (since SFTP has no inotify), file-cap guard reused from sprint 50.
- File: `src-tauri/src/ssh/sftp_tail.rs` (NEW). Wire into existing `SessionLister` as alternate source when remote selected.
- **Security — host key verification (auditor [CRITICAL] #2, REQUIRED before merge)**:
  - Implement `russh::client::Handler::check_server_key` callback wired to a managed `known_hosts` store at `~/.claude/ssh/known_hosts` (mode 0600 on Unix; ACL equivalent on Windows).
  - **TOFU on first connect**: prompt user with full fingerprint (SHA256) before saving.
  - **Hard-fail on key change**: never auto-update; show clear "host key changed — possible MITM" error; require manual `known_hosts` edit to recover.
  - **Algorithm allowlist**: reject `ssh-rsa` (SHA-1) and DSS; allow `ssh-ed25519`, `rsa-sha2-256/512`, `ecdsa-sha2-nistp256/384/521`.
- **Security — credentials (auditor [MEDIUM] #3)**:
  - Key passphrase NEVER on disk. In-memory only by default.
  - "Remember" → OS keychain via `keyring` crate (**pinned exact version** in `Cargo.toml`). Namespacing: `service="claude-devtools-tauri"`, `account="ssh:<conn_id>"`. Delete-on-connection-removal.
  - **Linux fallback**: if Secret Service unavailable (headless), "remember" toggle is disabled in UI — never silent plaintext.
  - SSH host config persists in `config/types.rs::SshConnection { id, host, port, user, key_path }` — **no passphrase field**.
- **Security — agent forwarding (auditor [LOW] #4)**: explicitly disabled in code via `russh` client config (`agent_forwarding = false`) regardless of any `~/.ssh/config` `ForwardAgent yes`. Document in `docs/release.md` (sprint 77).
- QA: integration test with mock SFTP server (use `russh-sftp` test harness); manual against a test VPS if available.
- **Negative tests (REQUIRED)**: 1) passphrase never appears in `config.json`. 2) Connect to host A, save key; reconnect after key swap → rejection error. 3) Server offers `ssh-rsa` → connection refused. 4) Manually plant `agent_forwarding=true` in user ssh_config → code-level disable still wins (verified by russh trace log).

**56 — Test coverage wave 1 — Rust critical path + parser fuzzing (auditor [MEDIUM] #15)**
- Add `cargo test` coverage for: `parsing/message_classifier.rs` (boundary cases: empty content, missing fields), `analysis/chunk_builder.rs` (state-machine flush triggers), `analysis/tool_linking.rs` (orphan Task, multi-subagent).
- No refactor; pure test additions. Files stay under cap.
- Target: +20 unit tests in `src-tauri/src/parsing/*/tests` mod blocks.
- **Security — parser fuzzing**:
  - Add `cargo-fuzz` targets for `entry_parser::parse_line` and `message_classifier::classify` under `src-tauri/fuzz/`.
  - Add **per-line byte cap (10 MB)** before `serde_json::from_str` in `session_parser.rs` — reject oversized lines with structured error, do not panic.
  - Fuzz run not part of CI (too long); checked-in seed corpus + 60s smoke run as opt-in `cargo fuzz run --max-total-time 60` documented in `docs/security.md` (NEW).
- QA: `cargo test` count rises by ≥20; line-cap test asserts rejection at 11MB; fuzz smoke completes without panic.

**57 — Split `tabSlice` (CORRECT seams) + test coverage wave 2 — store slices (architect [MUST] #1: re-scoped)**
- **Premise correction**: `src/renderer/store/slices/comparisonTabSlice.ts` ALREADY EXISTS (~2.6KB). `tabSlice.ts` (733 lines) does NOT contain comparison logic. The original "extract comparisonTabSlice" plan would be a no-op.
- **Real seams in tabSlice.ts**: pane/multi-select/navigation/per-tab UI. Extract:
  - **`tabSelectionSlice.ts`** — multi-select + drag/order state and actions.
  - **`tabNavigationSlice.ts`** — request queue + scroll save/restore coordination.
  - Parent `tabSlice.ts` retains tab CRUD + active-tab tracking, ≤400 lines.
- **Task 2 (tests)**: Add vitest coverage for the three resulting slices + `sessionDetailSlice.ts` (662), `conversationSlice.ts` (626).
- Target: +15 vitest tests; coverage on slices ≥70% lines.
- QA: `bun run test:coverage:critical` numbers improve vs pre-sprint baseline (recorded in commit body); both tasks land in same commit (per `feedback_commit_per_sprint.md`).
- **Pre-sprint check (MANDATORY)**: re-grep `tabSlice.ts` for `comparison` before starting; if architect's "0 matches" finding has changed since this plan was written, re-scope.

**58 — Split `tauriClient.ts` + `groupTransformer.ts` + Test coverage wave 3 — IPC + util gaps (architect [SHOULD] #10, #11: split BEFORE tests)**
- **Task 1 (splits FIRST — split must happen before tests so coverage targets stable files)**:
  - `src/renderer/api/tauriClient.ts` (712, actual path — momus correction) → `src/renderer/api/invokeWrappers.ts` + `src/renderer/api/domain/sessions.ts` + `src/renderer/api/domain/config.ts` + `src/renderer/api/domain/notifications.ts`, re-exported via `src/renderer/api/index.ts` barrel. Parent dies; `tauriClient.ts` becomes a thin re-export shim from `api/` for transition (deletable next sprint).
  - `src/renderer/utils/groupTransformer.ts` (714) → `groupBuilder.ts` + `groupEnhancer.ts` + `displayItemAssembler.ts` (siblings under `src/renderer/utils/grouping/`). Each ≤300 lines.
- **Task 2 (tests, post-split)**: Add tests for: new `api/` modules (revival path), `claudeMdTracker.ts` (637 — already 1 test, expand boundary cases), new `displayItemAssembler.ts`.
- Light mock harness for `invoke` via existing patterns.
- **Knip gate (architect [CONSIDER] #16)**: `bun run quality` already runs knip; sprint commit body must explicitly note "zero new orphan exports" — verify by running knip before and after.
- QA: `bun run test` total file count ≥75; `bun run quality` green; no file past 400-line target after splits.

### Phase G — Performance & Polish (59–65)

**59 — Backend perf — incremental detail streaming (architect [SHOULD] #5: backward-compat)**
- `get_session_detail_incremental` exists (CLAUDE.md). Audit hot path: confirm streaming chunk emit (not buffer-then-emit) for sessions >5MB.
- **Backward-compat rule**: do NOT change wire protocol of existing command. Instead:
  - Add NEW command `get_session_detail_stream` returning `Channel<DetailChunk>` (Tauri 2 `ipc::Channel` primitive).
  - Keep `get_session_detail_incremental` as a thin wrapper that drains the channel for any existing CLI/plugin callers (sprint 53 CLI may use the old form).
- File: `src-tauri/src/commands/sessions.rs` (post-52); existing `SessionCache` untouched.
- Renderer wiring: prefer streaming command; fall back to legacy if `Channel` unavailable on platform.
- QA: benchmark fixture session (50MB JSONL) — first-paint latency reduced; record before/after in commit body; legacy command still passes existing tests.

**60 — Frontend perf — profiling pass (architect [SHOULD] #6: write baseline artifact)**
- Run React Profiler on largest session in dev build. Identify any render in `ChatHistory` tree wider than 16ms.
- Apply `useMemo`/`React.memo` **only** where profiler proves measurable benefit (per global feedback `feedback_no_comments_memo.md`); no speculative memoization.
- **Baseline artifact (MANDATORY)**: write `migration-sprints/perf-baselines/sprint-60.json` with: { fixture, before_p95_ms, after_p95_ms, hotspots[] }. Sprint 61 commit body must reference this file.
- Document profiler delta in commit body.
- QA: no behavior change; profiler 95th-pct render ≤16ms on 5k-chunk fixture; baseline JSON committed.

**61 — Virtual scroll for 50k+ line sessions (metis [CONSIDER] #11: cite profiler basis)**
- `@tanstack/react-virtual` already in use. Audit: variable-row measurement caching, recalc cost on resize.
- **Add row-size memo backed by `chunk.id` ONLY IF** sprint 60 profiler results show row-measurement >2ms p95 on 50k fixture. If not warranted, do not add the memo (per `feedback_no_comments_memo.md`). Cite the sprint-60 profiler delta in commit body either way.
- Stress test fixture: synthetic 50k-chunk session (create `test/fixtures/synthetic-50k.jsonl` generator script).
- QA: scroll FPS ≥45 on 50k fixture in dev build.

**62 — Session list pagination / lazy load**
- `DateGroupedSessions.tsx` (608) currently renders all session rows. Add windowed pagination (50 rows / page) or virtualization (whichever fits sidebar layout).
- File: `src/renderer/components/sidebar/DateGroupedSessions.tsx` + companion `useSessionPagination.ts` (NEW).
- QA: list with 5000 sessions opens in <500ms cold; sidebar scroll smooth.

**63 — LRU cache tuning + memory budget guard**
- `src-tauri/src/cache.rs` (316). Audit `SessionCache` capacity & hit-rate. Expose `cache_metrics` (already wired sprint 46) — adjust default capacity if hit-rate <70% on real workload.
- Add hard memory budget guard (e.g., 200MB cache cap; evict oldest on exceed).
- QA: `cache_metrics` panel in Settings > Debug shows new defaults; integration test for eviction trigger.

**64 — Startup cold-start improvement (metis [SHOULD] #5; auditor [MEDIUM] #12)**
- Measure: `bun run dev` first-paint, Tauri `setup` hook duration. Identify top 3 cost contributors (likely: project scan, settings load, watcher init).
- Defer non-critical work past first-paint via `tokio::spawn`.
- **Security (auditor #12)**: any `tokio::spawn` task that touches the filesystem MUST inherit the same root-confinement (canonicalized `~/.claude/`) as the main thread. Concretely: pass the canonicalized root path as an `Arc<PathBuf>` captured at startup, not re-derived inside the task. Watcher init in particular: confine path scan to the canonicalized root before installing notify watcher; a malicious symlink swap between startup and spawn must not widen scope.
- Target: -200ms on cold start vs baseline (record in commit body).
- QA: cold-start timing dropped; **negative test**: plant symlink swap on `~/.claude/projects/X` between Tauri `setup` and watcher start → watcher does NOT pick up new target.

**65 — Bundle size audit + route code-split**
- Run `bun run build:analyze` (script exists). Identify chunks >300KB.
- Code-split: dashboard widgets (already lazy?), settings, comparison view. Use `React.lazy` + Suspense fallback.
- QA: `dist/` total JS shrinks ≥15%; first paint unaffected.

### Phase H — Feature Wave 2 (66–74)

**66 — Cost projection + budget alerts (sprint 18 carve-out; deps: 18, 40; architect [SHOULD] #9; auditor [LOW] #13)**
- Surface budget alerts via existing notification rules engine (sprint 40).
- File: `src-tauri/src/analytics/forecast.rs` (NEW) + `src/renderer/components/settings/sections/BudgetSection.tsx` (NEW).
- New trigger type `BudgetExceeded { threshold_cents }` in `config/triggers.rs`.
- **Tap point (architect [SHOULD] #9)**: cost forecaster emits on **chunk-finalise** (post `chunk_builder` flush), not on every token. Trigger evaluator runs in the existing rules-engine tick — NO hot-path eval per chunk. Specify in module doc that streaming-cost accumulator is read by rules engine on tick, write-only by forecaster.
- **Prerequisite verification (metis [SHOULD] #9)**: before implementation, confirm sprint 18 `DashboardWidget` contract and sprint 40 `Action::Notification` enum still match. If drifted, sprint 66 first stabilizes the seams, then ships budget logic.
- **Security (auditor [LOW] #13)**:
  - No network egress from `analytics/forecast.rs`. Add a `cargo deny` or `#![forbid(unsafe_code)]`-style assert (since `forbid` can't gate network, instead: code review checklist item in PR description template).
  - `BudgetExceeded` notification payload sent to OS notification API MUST include only: threshold value (cents), session ID hash (first 8 chars), timestamp. No prompts, no project name, no file paths.
- QA: set a low threshold; trigger fires on chunk-finalise after cost crosses; existing sprint 40 unrelated triggers still fire; **negative test**: notification body grep'd in OS notification center → no prompt content, no full path.

**67 — Per-chunk diff in session comparison (architect [SHOULD] #8: robust matching)**
- `SessionComparison.tsx` (574) currently column-level. Add per-chunk diff highlighting (matched-by-prompt-hash chunks shown side-by-side).
- File: `src/renderer/utils/sessionDiff.ts` (NEW); reuse existing `groupTransformer` output (post-sprint-58 split path: `src/renderer/utils/grouping/`).
- **Prompt normalization (REQUIRED before hash)**: trim leading/trailing whitespace; collapse internal runs of whitespace to single space; NFC unicode normalize; drop trailing newline; lowercase ONLY for matching (display unchanged).
- **Fallback**: if exact hash misses, use Levenshtein ≥0.92 similarity over the first 200 chars. Cap candidates to 20 per session to bound O(n*m).
- QA: open 2 sessions with shared prompt prefix (one with trailing whitespace) → matched chunks visibly aligned; ablation test: hash-only matches < hash+fallback matches on a deliberately-noisy fixture.

**68 — Conversation timeline scrubber**
- `SessionMinimap.tsx` exists. Add scrubber UI on top of minimap: drag a marker, viewport snaps to chunk at that offset.
- Reuses existing `ScrollController` writer union (sprint 26 seam).
- QA: drag scrubber across 1000-chunk session; viewport responds <16ms.

**69 — Cross-session tool-call graph (metis [SHOULD] #6; architect [SHOULD] #7: eviction policy)**
- New visualization: nodes = tools, edges = co-occurrence within session. Aggregated across selected sessions.
- File: `src/renderer/components/dashboard/ToolCallGraph.tsx` (NEW); reuse `DashboardWidget` contract (sprint 18 seam).
- **Decision (locked)**: hand-rolled SVG force-directed layout. **NO new dependency**. Verlet integration for spring/repulsion (≤80 lines in `src/renderer/utils/forceLayout.ts`).
- **Eviction policy (REQUIRED)**:
  - Edge weight = co-occurrence count across currently-selected sessions.
  - Node ranking = sum of incident edge weights (degree).
  - On overflow (>200 nodes): evict **lowest-degree** node; tiebreak by **oldest last-seen-timestamp**; further tiebreak by lexical name.
  - "Show top N by frequency" UI control lets user lower N below 200.
- QA: select 10 sessions; graph renders <500ms; clicking a node filters dashboard; eviction unit test on 250-node synthetic fixture.

**70 — Saved searches / smart inbox**
- Sprint 35 shipped saved filter presets; sprint 43 shipped natural-language query. Combine: persist NL queries as named "smart inboxes" in sidebar.
- File: `src-tauri/src/config/types.rs` extend (add `SavedSearch`); `src/renderer/components/sidebar/SmartInboxList.tsx` (NEW).
- QA: save a query → reopen app → query still listed and clickable.

**71 — Inline annotation rendering in chat**
- Sprint 37 ships annotation collections export. Add: render annotation badges inline on chunks they cover; click → open annotation editor.
- File: existing `AnnotationBadge.tsx` already exists — wire into `DisplayItemList.tsx`.
- QA: annotate a chunk → badge visible inline; click badge opens editor.

**72 — Unified export — Markdown / HTML / PDF (metis [CONSIDER] #13; architect [CONSIDER] #12; auditor [MEDIUM] #11)**
- `sessionExporter.ts` (426) exists, already at target ceiling. Audit format coverage; add HTML and Markdown if missing; PDF already shipped.
- **File cap discipline (mandatory)**: BEFORE adding new format handlers, extract `htmlExporter.ts` and `markdownExporter.ts` as siblings; `sessionExporter.ts` becomes thin orchestrator ≤200 lines.
- **Dispatch (architect [CONSIDER] #12)**: orchestrator uses `switch (format)` over an enum + three pure functions. **Do NOT introduce an `Exporter` interface or strategy class** — no exporter plugin extensibility is planned for Phase J, so the abstraction would be speculative (violates "no abstractions for single-use code").
- **Security (auditor [MEDIUM] #11)**: destination file path MUST come from Tauri `dialog::save` (which is OS-sandboxed via `tauri-plugin-dialog`). **Never** call `fs::write` with a renderer-supplied path string directly. Validate received path is within user-chosen scope before write.
- Single dialog with format radio + scope (full / annotated / filtered).
- QA: export each format on a 100-chunk session; output opens correctly; `bun run quality` green (no file past 400-line target); **negative test**: attempt to inject `../../../etc/passwd` via renderer → save dialog path enforcement blocks.

**73 — Quick-action commands (auditor [MEDIUM] #16: clipboard + shell scopes)**
- CommandPalette (477) exists. Add quick-actions: "copy session as markdown", "open project folder in Finder", "open session JSONL in editor".
- File: `src/renderer/components/search/CommandPalette.tsx` + new `src/renderer/commands/quickActions.ts` (NEW).
- **Security**: clipboard write-only (no clipboard:read capability granted in `src-tauri/capabilities/`). Shell open uses `tauri-plugin-shell` `open` with **scoped allowlist** in capabilities — only `file://` URIs under `~/.claude/` and the user's project root. **Never** spawn arbitrary `Command::new`.
- QA: keyboard-trigger each action; verify side-effect (clipboard write succeeds, shell open succeeds for whitelisted paths); **negative test**: craft an "open" intent with `file:///etc/` → capability denies.

**74 — Local session summarization (lexical only; architect [CONSIDER] #14)**
- Generate 3-bullet TL;DR per session using existing tokenizer + heuristics:
  - Bullet 1: first user prompt, truncated to 120 chars at word boundary.
  - Bullet 2: last AI response, truncated to 120 chars at word boundary.
  - Bullet 3: **tool call summary** — top 3 tools by invocation count, formatted as `"Read×4, Bash×2, Edit×1"`. Reuse `src/renderer/utils/toolSummaryHelpers.ts` formatter (do NOT reinvent).
- NO LLM call; pure lexical (per sprint 43 precedent).
- File: `src-tauri/src/analysis/summarizer.rs` (NEW); `src/renderer/components/chat/SessionTLDR.tsx` (NEW).
- QA: summary renders on session open; <50ms compute; format matches contract above for a fixture with known counts.

### Phase I — Cross-Platform & Packaging (75–78)

**75 — Linux/Windows CI matrix**
- `.github/workflows/` audit: confirm build matrix covers macos / linux / windows. If missing, add.
- Smoke job: `cargo check` + `bun run build:frontend` on each.
- QA: PR CI run shows 3 green legs.

**76 — Auto-updater wiring (metis [MUST] #2; auditor [HIGH] #5, #6: rollback + TLS + key gating)**
- Tauri 2 has `tauri-plugin-updater`. Wire endpoint, signature verification, opt-in UI in Settings > General.
- File: `src/renderer/components/settings/sections/UpdaterSection.tsx` (NEW).
- **Mock endpoint MUST return a signed payload** — see test-key handling below. Unsigned mock is forbidden (would skip the only test of the signature path).
- **Rollback / downgrade defense (auditor [HIGH] #5)**:
  - Reject manifest with `version <= current_installed_version`.
  - Manifest must include `timestamp` field inside the signed payload; reject if older than 30 days (replay defense).
- **TLS hardening (auditor [HIGH] #5)**:
  - Updater endpoint scheme MUST be `https://` — enforce at config-load time with a `panic!` if a non-https URL is set in release builds.
  - Public key bundled at **compile time** (`include_str!`), never fetched.
- **Test key handling (auditor [HIGH] #6)**:
  - Commit a clearly-named `TEST_PUBKEY_DO_NOT_USE_IN_PROD` constant in a `#[cfg(test)]`-gated module (NOT a feature flag — features unify across builds).
  - Production builds: `#[cfg(not(test))]` constant `PROD_PUBKEY` from `include_str!("../keys/updater-public.pem")` (file gitignored; populated by release pipeline; runtime assert that constant is non-empty and 64 bytes for ed25519).
  - Test private key clearly labeled `TEST-ONLY-DO-NOT-USE-IN-PROD` in filename and content header.
  - Release build asserts test key not reachable (compile-time `cfg(test)` gate accomplishes this; add a runtime safety check that hashes the loaded pubkey against a known prod fingerprint when available).
- QA: trigger update check → mock signed server returns "newer" → user-facing UI shows update dialog; tampered fixture → rejection; older-version fixture → rejection; non-https URL in test config → panic on load.

**77 — Signing & notarization runbook + supply-chain gates (auditor [HIGH] #14)**
- Documentation sprint: `docs/release.md` (NEW) covers macOS notarization (`xcrun notarytool`), Windows signing (`signtool`), Linux AppImage.
- Add `scripts/release-checklist.sh` — pre-flight gate:
  - `cargo audit` — fail on advisories
  - `bun audit --audit-level high` — fail on high/critical
  - `cargo deny check advisories` — adds `cargo-deny` (pin exact version in `Cargo.toml` dev-deps)
  - Version bump consistency check (Cargo.toml + package.json + tauri.conf.json)
- **Per-sprint dep-add gate (REQUIRED)**: any sprint that adds a new Rust or JS dependency must include `cargo audit` / `bun audit` in its commit-time check. Document this expectation in `docs/release.md`.
- **Exact-version pins (REQUIRED in this sprint)**: ensure `keyring` (sprint 55), `clap` (sprint 53), `russh`/`russh-sftp`/`russh-keys` (already present), `tauri-plugin-updater` (sprint 76), `i18next`/`react-i18next` (sprint 82) all pinned to exact versions; document the policy in `docs/release.md`.
- QA: dry-run script on current main; output is human-readable pass/fail list; CI runs `cargo audit` + `bun audit` as a separate green-required job.

**78 — Tray icon + dock badge + system integration (metis [SHOULD] #10; auditor [MEDIUM] #7)**
- Tauri 2 tray API. Add tray with: show/hide window, recent sessions submenu, quit.
- Dock badge: count of sessions with active subagents (use existing process-active signal).
- File: `src-tauri/src/tray.rs` (NEW); `src/renderer/services/trayBridge.ts` (NEW).
- **Security — display strings (metis [SHOULD] #10)**: tray menu strings derived from JSONL (recent session names) MUST be sanitized — strip newlines/control chars, truncate to 60 chars, escape OS-menu-special chars. Dock badge count clamped to `0..=99`.
- **Security — session ID validation (auditor [MEDIUM] #7)**: tray menu invokes commands by session ID. Renderer→Rust payload MUST be validated on the Rust side: session ID matches UUID v4 regex BEFORE any path join (same root-confinement rule as sprint 53). Reject malformed IDs with structured error; do not pass to filesystem layer.
- QA: app minimizes to tray; right-click shows menu; badge updates when subagent spawns; **negative tests**: 1) session named `"foo\n\u{1B}[bar"` renders sanitized; 2) tray event with payload `{"sessionId":"../../etc/passwd"}` → Rust rejects, command does not execute.

### Phase J — Plugin/Extensibility Wave 2 (79–82)

**79 — Plugin API v2 — broader hooks + permission model + dispatcher (architect [MUST] #4, [CONSIDER] #15; auditor [CRITICAL] #9, [HIGH] #10)**
- Sprint 38/39 shipped sandbox + settings. v2 adds: `onChunkRendered`, `onToolResult`, `onSessionLoaded` lifecycle hooks (additive — v1 hooks unchanged).
- Bump `apiVersion` (existing contract from sprint 38) to 2; plugins declaring v1 still load.
- File: `src/renderer/plugins/pluginHost.ts` (existing — audit path) → extend dispatch table.

**Permission model (REQUIRED before any v2 hook ships — auditor [CRITICAL] #9)**:
- Plugins declare permission scopes in manifest: `permissions: Array<"reads:chunks" | "reads:tools" | "reads:session-meta" | "network:none">`.
- Default permission set is **empty** (no hook receives data without explicit scope).
- Hook dispatcher filters payload per declared scope: a plugin without `reads:chunks` gets `onChunkRendered(metadata-only)` — no chunk content.
- **First-load consent prompt**: when a plugin declares any scope, Settings > Plugins shows a one-time consent dialog enumerating requested scopes BEFORE the plugin loads. User can reject → plugin disabled.
- `network:none` is implied by sandbox (sprint 38) and re-asserted at v2 hook dispatch boundary; outbound `fetch` calls inside plugin code throw if not declared (and `network:*` is not implemented this sprint — only `network:none` is recognized, deferring real network scopes to a future sprint).

**Dispatcher (architect [CONSIDER] #15; auditor [HIGH] #10)**:
- Single-threaded dispatcher with bounded queue (max 1000 events). Drop-policy for `onChunkRendered`: coalesce by `chunk.id` (latest wins).
- Each hook call wrapped in `try/catch + setTimeout(100ms)` timeout.
- Return-value schema validation (zod or hand-rolled type guard) — invalid payloads rejected, plugin warned via console.
- **Kill-switch**: N consecutive faults (default 3) → plugin auto-disabled with surfaced error in Settings > Plugins.

**Contract artifacts (architect [MUST] #4; metis [SHOULD] #7)**:
- `docs/plugin-api-v2.md` (NEW) — versioned contract: hook name, args, return shape, ordering guarantees, re-entrancy rules, error semantics, permission scope each hook requires.
- `test/renderer/plugins/apiV2Snapshot.test.ts` — snapshot test of v2 signatures (function names, arg types, return types). Fails CI on silent drift.

- QA: example plugin updated to use new hook; v1 example still loads; snapshot test passes; consent dialog appears on first load of a scoped plugin; rejection-on-load path tested; deliberate plugin fault triggers kill-switch after 3 faults.

**80 — Plugin marketplace metadata (metis [CONSIDER] #12; auditor [HIGH] #8: comprehensive screenshot guards)**
- Plugins declare `metadata.json` with `name`, `version`, `author`, `category`, `screenshots[]`. Settings UI groups plugins by category.
- No network fetch; local-only metadata. Marketplace listing endpoint deferred to a post-82 sprint.
- **Screenshot guards (REQUIRED)**:
  - **Size**: max 300 KB per screenshot.
  - **Count**: max 5 screenshots per plugin.
  - **Format allowlist**: png / jpg / webp only. Allowlist enforced AT BOTH extension AND **magic-byte sniff** (`image::guess_format`). Polyglot files (e.g., PNG+HTML) caught by sniff. SVG explicitly forbidden (active content risk).
  - **Decompression-bomb defense**: decoded pixel dimensions ≤ 4096×4096 (decode-then-check via `image::ImageReader::with_guessed_format().limits(...)`).
  - **Path traversal**: manifest `screenshots[]` entries resolved RELATIVE to plugin root only; reject any path containing `..`, absolute paths, or escaping the plugin dir after canonicalization.
- File: `src-tauri/src/plugins.rs` validation extension (NEW helper `validate_screenshot`); `src/renderer/plugins/manifestSchema.ts` (NEW); `src/renderer/components/settings/sections/PluginsSettings.tsx` extend.
- QA: install example plugin with metadata → Settings > Plugins shows in correct category with screenshots.
- **Negative tests (REQUIRED)**: 1) 500 KB screenshot → manifest error. 2) `screenshot.png` with HTML magic bytes → reject. 3) 5000×5000 PNG → decode-limit error. 4) `screenshots: ["../../../etc/passwd"]` → traversal reject. 5) SVG file → extension+sniff both reject.

**81 — Plugin host hardening + audit log + permission UI (architect [CONSIDER] #13: workflow recipes deferred)**
- **Sprint 81 REPLACES "workflow recipes"** — architect-reviewer flagged Phase J compounding risk (v2 hooks + marketplace + recipes in 3 consecutive sprints). Per "no abstractions for single-use code", users can compose plugins by writing a plugin that calls others once the v2 contract is documented. Recipes deferred to a post-82 sprint when the v2 surface is proven.
- Instead, sprint 81 hardens the v2 host shipped in sprint 79:
  - **Permission audit log**: every hook dispatch records `{plugin_id, hook, timestamp, payload_size, scope_used, fault?}`. Log persists in `~/.claude/devtools/plugin-audit.log` (rotated at 10MB). Settings > Plugins shows last 100 entries per plugin.
  - **Plugin permission UI**: Settings > Plugins per-plugin panel shows declared scopes with a re-consent button. User can revoke any scope; plugin reloads with reduced permission.
  - **Concurrency limit per plugin**: max 1 in-flight hook call per plugin per hook (re-entrancy denied — caller blocks until prior call returns or times out).
  - **Memory budget per plugin**: 64 MB heap soft cap (V8 isolate or web-worker boundary — depending on existing sandbox impl from sprint 38). Exceeded → plugin disabled with surfaced error.
- File: `src/renderer/plugins/auditLog.ts` (NEW); `src/renderer/plugins/pluginHost.ts` extend; `src/renderer/components/settings/sections/PluginsSettings.tsx` extend.
- QA: 1) trigger hook → audit log row appears. 2) Revoke scope → plugin reload with reduced data. 3) Spawn 2 concurrent hook calls → second blocks. 4) Plugin allocates >64MB → disabled.

**82 — i18n foundation — Settings scope only (metis [SHOULD] #8: scope-cut to fit 1 week)**
- No translation strings yet; sprint sets up. Use `i18next` + `react-i18next` (single dep pair).
- **Scope (limited to fit a week)**: externalize strings in `src/renderer/components/settings/**` only. Chat / sidebar / dashboard string lift is deferred to a future sprint (post-82).
- Locale switcher in Settings > General (only `en` for now); foundation proven on Settings surface.
- File: `src/renderer/i18n/` (NEW); `src/renderer/i18n/en.json` (Settings strings only).
- QA: switch to "en" (no-op) → Settings strings render from JSON; missing-key fallback returns key path; `bun run typecheck` clean; rest of app untouched.

## Dependency Map (critical)
- 51 (ChatHistory split + ScrollController service lift) → 60 (profiler pass needs split components), → 68 (scrubber reuses writer service)
- 52 (commands/mod split + capabilities audit + CSP enable) → 54 (window broadcast helper lives in `commands/window.rs`)
- 52 → 53 (CLI imports from lib path that 52 stabilizes)
- 56 (Rust test wave + parser fuzz) → 59 (perf changes need test coverage to detect regressions)
- 57 (slice tests + correct tabSlice splits) → 60 (frontend profiler pass; tests must catch regression)
- 58 (tauriClient.ts + groupTransformer.ts splits BEFORE tests) → 67 (sessionDiff imports from `grouping/`)
- 60 (profiler baseline json artifact) → 61 (row-size memo conditional on profiler delta — metis #11, arch #6)
- 18 (analytics widget contract), 40 (rules engine) → 66 (budget alerts; cost tap on chunk-finalise, evaluator on rules tick)
- 18 (analytics widget contract) → 69 (ToolCallGraph reuses DashboardWidget; eviction policy specified)
- 26 (ScrollController seam) + 51 (service lift) → 68 (scrubber writer)
- 38/39 (plugin host) → 79 (API v2 additive + permission model + dispatcher)
- 79 (v2 hooks + permission scopes + docs/plugin-api-v2.md + apiV2Snapshot test) → 80 (marketplace metadata can reference permissions in plugin listings)
- 79 → 81 (host hardening builds on v2 surface)
- 75 (CI matrix) → 76 (auto-updater + TLS + rollback defense), 77 (signing runbook + supply-chain gates)
- 77 (cargo audit + cargo deny pinned) ← all sprints that add a new dep (53, 55, 76, 82) per supply-chain gate

## Verification (per sprint)
1. `bun run typecheck` clean
2. `bun run lint` clean
3. `bun run test` relevant suite passes
4. `cargo check` / `cargo test` clean for Rust sprints
5. `bun run quality` green (full gate: types + lint + test + build + format + knip)
6. Manual smoke in `bun run dev` exercising the changed surface

## Implementation Sequencing
1. After momus review passes, implement **sprint 51** immediately (hard-cap remediation — highest urgency).
2. Sprint 51 task: split `ChatHistory.tsx` per its spec above.
3. Subsequent sprints ship on 1-week cadence; one commit per sprint (per `feedback_commit_per_sprint.md`).

## Review Trail

### Metis Plan Consultant
- [x] #1 [MUST] Sprint 55 — SSH credential storage spec'd (no on-disk passphrase; OS keychain via `keyring` crate; agent forwarding declared out of scope)
- [x] #2 [MUST] Sprint 76 — mock endpoint must serve **signed** payload; negative tamper test added
- [x] #3 [MUST] Sprint 53 — path traversal guard on CLI `<id>`/`<project>` args; negative test
- [x] #4 [MUST] Sprint 57 — `tabSlice` split made unconditional (absorbed into sprint 57 as Task 1)
- [x] #5 [SHOULD] Sprint 64 — `bun run dev` replaces `npx vite dev`
- [x] #6 [SHOULD] Sprint 69 — hand-rolled SVG decision locked; no new dep; line removed
- [x] #7 [SHOULD] Sprint 79 — hook contract snapshot test mandatory before sprint 81
- [x] #8 [SHOULD] Sprint 82 — i18n scope reduced to Settings only; chat/sidebar deferred
- [x] #9 [SHOULD] Sprint 66 — deps `18, 40 → 66` added to map; prerequisite seam audit step
- [x] #10 [SHOULD] Sprint 78 — tray menu strings sanitized; dock badge clamped; negative test
- [x] #11 [CONSIDER] Sprint 61 — row-size memo conditional on sprint-60 profiler delta
- [x] #12 [CONSIDER] Sprint 80 — screenshot size (300KB)/count (5)/format (png/jpg/webp) guards
- [x] #13 [CONSIDER] Sprint 72 — pre-emptive file split before adding new format handlers

### Auto-Picked Middle Reviewer(s)
**Auto-picked: security-auditor + architect-reviewer (both, parallel).** Justification recorded above.

#### Security Auditor
- [x] #1 [HIGH] Sprint 53 — symlink/TOCTOU/null-byte/env injection/tail rate-limit hardening added with negative tests
- [x] #2 [CRITICAL] Sprint 55 — host key verification (known_hosts, TOFU, key-change reject, algorithm allowlist)
- [x] #3 [MEDIUM] Sprint 55 — keychain namespacing + Linux fallback + delete-on-removal
- [x] #4 [LOW] Sprint 55 — agent forwarding explicitly disabled in code regardless of user ssh_config
- [x] #5 [HIGH] Sprint 76 — rollback defense (version+timestamp), HTTPS-only, compile-time pubkey
- [x] #6 [HIGH] Sprint 76 — test key cfg(test)-gated, prod key separate, runtime asserts
- [x] #7 [MEDIUM] Sprint 78 — UUID-regex session ID validation on Rust side before path join
- [x] #8 [HIGH] Sprint 80 — magic-byte sniff, decompression bomb cap, SVG ban, screenshot path traversal
- [x] #9 [CRITICAL] Sprints 79–81 — plugin permission scopes + consent prompt + default-deny added in sprint 79
- [x] #10 [HIGH] Sprint 79 — hook timeout (100ms), bounded queue (1000), return-schema validation, kill-switch (3 faults)
- [x] #11 [MEDIUM] Sprint 72 — Tauri `dialog::save` enforced for export destination
- [x] #12 [MEDIUM] Sprint 64 — root path captured at startup, shared via `Arc<PathBuf>` to spawned tasks
- [x] #13 [LOW] Sprint 66 — no network egress; notification payload limited to threshold + ID hash + timestamp
- [x] #14 [HIGH] Sprint 77 — `cargo audit`, `bun audit`, `cargo deny`, exact-version pins, per-sprint dep gate
- [x] #15 [MEDIUM] Sprint 56 — `cargo fuzz` targets + 10 MB per-line cap
- [x] #16 [MEDIUM] Sprint 52 — Tauri capabilities audit + CSP enable in `tauri.conf.json`. Clipboard write-only and shell-open scoped allowlist deferred to sprint 73.

#### Architect Reviewer
- [x] #1 [MUST] Sprint 57 — re-scoped: `comparisonTabSlice` already exists; split into `tabSelectionSlice` + `tabNavigationSlice`. Pre-sprint re-grep mandated.
- [x] #2 [MUST] Sprint 51 — EmptyStates extract removed (sprint 49 already centralised); `ScrollController` lifted to service for sprint 68 reuse
- [x] #3 [MUST] Sprint 52 — six modules (added `commands/files.rs` + `commands/analytics.rs`)
- [x] #4 [MUST] Sprint 79 — `docs/plugin-api-v2.md` versioned contract document mandated alongside snapshot test
- [x] #5 [SHOULD] Sprint 59 — new `get_session_detail_stream` command + legacy wrapper retained for CLI compat
- [x] #6 [SHOULD] Sprint 60/61 — `migration-sprints/perf-baselines/sprint-60.json` artifact mandated; sprint 61 must reference
- [x] #7 [SHOULD] Sprint 69 — eviction policy locked (degree-based, last-seen tiebreak, lexical name tiebreak)
- [x] #8 [SHOULD] Sprint 67 — prompt normalization (trim/collapse/NFC/lowercase) + Levenshtein ≥0.92 fallback (cap 20 candidates)
- [x] #9 [SHOULD] Sprint 66 — cost tap on chunk-finalise; evaluator on rules tick; not per-token hot path
- [x] #10 [SHOULD] Sprint 58 — `tauriClient.ts` + `groupTransformer.ts` splits absorbed; ordering fixed (split FIRST, tests SECOND)
- [x] #11 [SHOULD] Sprint 58 ordering — split before tests asserted
- [x] #12 [CONSIDER] Sprint 72 — switch dispatch (no Exporter interface); rule "no abstractions for single-use code" cited
- [x] #13 [CONSIDER] Sprint 81 — REPLACED workflow recipes with plugin host hardening (audit log + permission UI + concurrency + memory cap); recipes deferred post-82
- [x] #14 [CONSIDER] Sprint 74 — tool call summary contract locked (top-3, format `"Read×4, Bash×2, Edit×1"`, reuse `toolSummaryHelpers.ts`)
- [x] #15 [CONSIDER] Sprint 79 — single-threaded dispatcher + bounded queue + coalesce-on-chunk-id incorporated into permission/dispatcher section
- [x] #16 [CONSIDER] Sprint 58 — knip gate (zero new orphan exports) added as commit-body requirement

### Momus Plan Reviewer
- [x] #1 [WARNING] Sprint 51 — `scrollController.ts` already exists at `src/renderer/utils/`; reworded as move + importer rewrite (SessionMinimap)
- [x] #2 [WARNING] Sprint 58 — corrected source path `src/renderer/api/tauriClient.ts` (was `utils/`)
- [x] #3 [WARNING] Sprints 80/81 — `PluginsSettings.tsx` (actual file), not `PluginsSection.tsx`
- [x] #4 [INFO] Sprint 79 — `pluginHost.ts` (lowercase, repo convention; Linux CI case-sensitive)
- [x] #5 [INFO] Sprint 52 — also tighten `shell:allow-spawn`/`shell:allow-execute` capabilities to scoped `shell:allow-open`
- [x] #6 [INFO] Sprint 56 — `session_parser.rs` 712 lines noted; 10MB cap addition watched against 800 cap
- [x] Line-count claims verified: zero drift on 16 spot-checked files
- [x] CSP string syntactically valid; dev `connect-src` requirement noted

**VERDICT: READY** — Sprint 51 cleared to implement.
