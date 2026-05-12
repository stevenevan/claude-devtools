# Autonomous Sprint Run Plan — 2026-05-16

Continuation of the 2026-05-15 autonomous run. Picks up the tractable
sprint work that fits the sandbox (no live dev runtime, no crates.io / no
`bun add`). One commit per sprint per `feedback_commit_per_sprint.md`.

## Scope (3 sprints, ordered)

| # | Sprint | Why now |
| - | ------ | ------- |
| 1 | 58 — `tauriClient.ts` + `groupTransformer.ts` splits | Highest-priority pickup per 2026-05-15 log; pure refactor, no runtime needed |
| 2 | 75 — CI matrix (macos + windows legs) | Repo-config; needs no runtime; sprint 76/77 depend on it |
| 3 | 77 — Release runbook + supply-chain checklist script | Documentation + shell script; no new deps |

**Sprint 74 UI add-on — REMOVED from this run** (after reviewer findings):
- security-auditor HIGH-1: `resolve_session_path` performs zero validation — adding a new command that reuses it widens the unvalidated surface. Path-hardening is a dedicated sprint, not a 1-commit UI add-on.
- architect-reviewer MUST-3: shipping a component + client method + types without a mount produces orphan exports; knip will flag.
- Combining mount + AppConfig feature-flag + path-validation hardening in one autonomous run is multi-day work that violates simplicity-first. Defer to a dedicated future sprint.

Out of scope this run: sprints 59 (channel API), 60 (live profiler),
61 / 62 / 64 / 65 (UI runtime needed), 66 (multi-day), 67–73 (UI heavy),
74 UI (see above), 76 (`tauri-plugin-updater` dep — `bun add` gated), 78
(tray API + UI verify), 79–81 (plugin v2, compounded risk per
architect-reviewer), 82 (i18next dep — `bun add` gated).

---

## Sprint 58 — Split `tauriClient.ts` + `groupTransformer.ts`

### Current state
- `src/renderer/api/tauriClient.ts` = 712 lines, class `TauriAPIClient` implements `ElectronAPI`. Methods are arrow-function class fields — splittable only by composition or by extracting helper modules and delegating from the class.
- `src/renderer/utils/groupTransformer.ts` = 714 lines, one exported entry point `transformChunksToConversation` plus many private helpers (slash-command parsing, file-ref extraction, AI summary builder, status detection).

### Split strategy

**`tauriClient.ts` — dissolve the class into a factory (architect MUST-1):**

The class is purely cosmetic — every method is an arrow-function class field with no `this`, no constructor logic, no shared state. Keep the `ElectronAPI` interface as the contract; replace the class with a factory.

- `src/renderer/api/reviveDates.ts` (NEW) — extract `reviveDates` + `ISO_DATE_RE` (~30 lines).
- Domain modules (NEW, pure functions, ≤200 lines each):
  - `src/renderer/api/domain/sessions.ts` — projects, sessions (paginated/search/detail/metrics), waterfall, subagent detail.
  - `src/renderer/api/domain/analytics.ts` — analytics, cost forecast, productivity, model comparison, file graph, tldr (already-shipped backend; client method NOT exposed this sprint).
  - `src/renderer/api/domain/config.ts` — config + notifications invoke wrappers.
  - `src/renderer/api/domain/files.ts` — validatePath, validateMentions, readClaudeMd*, readMentionedFile.
  - `src/renderer/api/domain/window.ts` — windowControls, ssh, context, httpServer, openPath, openExternal, updater, listeners (zoom, file-change, todo-change).
- `src/renderer/api/tauriClient.ts` becomes a factory:
  ```ts
  export function createTauriClient(): ElectronAPI {
    return { ...sessionsApi, ...analyticsApi, ...configApi, ...filesApi, ...windowApi };
  }
  ```
  Target ≤80 lines. `TauriAPIClient` class is deleted; `src/renderer/api/index.ts` updated from `new TauriAPIClient()` to `createTauriClient()` (2 sites — `index.ts:16,22`).
- `src/shared/types/api.ts:4` JSDoc comment "Implemented by TauriAPIClient" updated to "Implemented by `createTauriClient()` factory".

**`groupTransformer.ts` — split by responsibility (architect MUST-2):**

Splitting by chunk type would arbitrarily glue parsing utilities to user-chunk code. Split by *responsibility* instead:

- `src/renderer/utils/grouping/contentParsing.ts` (NEW) — `extractCommands`, `extractFileReferences`, `extractImages`, `extractText`, `KNOWN_DIRS`, `FILE_REF_PATTERN`, `COMMAND_PATTERN`. Pure parsing utilities. **Fix** the stateful-regex bug (architect CONSIDER-6): instantiate `COMMAND_PATTERN` as a local `new RegExp(...)` inside `extractCommands` instead of module-level `lastIndex` reset.
- `src/renderer/utils/grouping/aiSummary.ts` (NEW) — `calculateTokensFromSteps`, `getAIGroupSummary`, `getAIGroupStatus`, `getAITimestamp`, `getAIPriorTimestamp`.
- `src/renderer/utils/grouping/userContent.ts` (NEW) — `buildUserGroup`, `buildUserGroupFromMessage`, `extractUserGroupContent`, `isCommandContent` consumers, `THINKING_PREVIEW_LENGTH`.
- `src/renderer/utils/groupTransformer.ts` retains the orchestrator: `transformChunksToConversation` plus per-chunk-type `buildSystemGroup` / `buildCompactGroup` / `buildEventGroup` / `buildAIGroup` (single-call helpers that delegate to `aiSummary` for math). Target ≤350 lines.

No transition shim. Existing callers import `transformChunksToConversation` from `@renderer/utils/groupTransformer` — that import path stays intact because the orchestrator stays in the parent file. The new `grouping/` modules are internal — only the orchestrator surfaces.

**JSDoc cleanup (architect CONSIDER-6):**
- `.claude/rules/react.md` bans JSDoc. Strip JSDoc blocks from `groupTransformer.ts` (lines 1-7, 68-78, 198-203, 208-214, 227-232, 289-294 per architect spot-check) and `tauriClient.ts` (reviveDates header). Net line count drops further.

### Behavior contract
- ZERO public-API change. `ElectronAPI` signatures untouched. `transformChunksToConversation` signature + output structure unchanged.
- All existing tests must pass without modification.

### Tests added
- `test/renderer/api/reviveDates.test.ts` — boundary cases (ISO with timezone, ISO without, non-string, nested object, array). Target ≥6 cases. **UNCONDITIONAL** (architect CONSIDER-6 override): recursive type-coerce regex is exactly what regresses silently — coverage required regardless of integration coverage.
- Grouping tests: **SKIP** unless pre-grep shows zero existing coverage. Existing integration tests on `transformChunksToConversation` already exercise slash-command / file-ref paths. Don't add speculative unit tests.

### File-cap discipline
- After split: re-run `wc -l` on each new file; assert each ≤400 lines.
- Mention `bun run quality` knip output in commit body — must show zero new orphan exports (per architect [CONSIDER] #16).

### Knip handling (metis MUST-2 → architect MUST-2 supersedes)
- No transition shims. `tauriClient.ts` keeps the same path (now exporting `createTauriClient` factory). `groupTransformer.ts` keeps the same path (orchestrator). Existing import sites unchanged.
- Pre-commit verification (REQUIRED): run `bun run quality` and grep for `Unused exports` — must be zero new entries. If a domain-module function ends up unused (e.g., `windowApi.openExternal` exposed but never imported), keep only the surface that the factory actually composes.

### QA
1. `bun run typecheck` clean.
2. `bun run test` — total file count rises by 2; existing tests pass unchanged.
3. `bun run quality` green (full gate).
4. `bun run lint` clean.
5. Manual grep: no caller imports the **old** internal helpers from `tauriClient.ts` or `groupTransformer.ts` (only the thin re-exports remain importable).

### Commit
`refactor(api): sprint 58 - tauriClient factory + groupTransformer split`

---

## Sprint 75 — CI matrix (macos + windows legs)

### Current state
- `.github/workflows/ci.yml` runs only `ubuntu-latest` for both `frontend` and `rust` jobs.

### Triggers (architect SHOULD-4 — gate non-linux off PR hot path)

Current `ci.yml` runs on every push + PR. Adding 2× OSes to both jobs = 6 jobs per PR. That's a step-change in cost for a project not yet shipping cross-platform binaries. Apply this gating:

- **PR + main push**: ubuntu-latest only (current behavior preserved on the hot path).
- **macos-latest + windows-latest**: run only when:
  - `github.event_name == 'push' && github.ref == 'refs/heads/main'` (after-merge verify), OR
  - nightly cron `'0 6 * * *'` (UTC) on main.
- Implement via `if:` on each matrix leg OR via two job definitions (cleaner). Prefer two jobs: keep `frontend` + `rust` linux-only (existing) and add `cross-platform` job with `strategy.matrix.os: [macos-latest, windows-latest]` guarded by the `if:` above.

### Tasks

1. **Workflow-level permissions (security HIGH-2)**:
   - Add at the top of `ci.yml`:
     ```yaml
     permissions:
       contents: read
     ```
   - No jobs in this workflow write to the repo or release artifacts. Locked-down default-deny.

2. **Pin all GHA actions to commit SHAs (security MED-1)**:
   - `actions/checkout@v4` → pin to a specific SHA. Look up the latest released SHA in the PR diff prep step.
   - `oven-sh/setup-bun@v2` → pin to SHA.
   - `dtolnay/rust-toolchain@stable` → pin to SHA (the action itself; the toolchain stays `stable`).
   - `Swatinem/rust-cache@v2` → pin to SHA.
   - Document the SHAs in commit body for traceability.

3. **Cross-platform job (new, gated)**:
   - `cross-platform-frontend`: matrix `os: [macos-latest, windows-latest]`. Steps: checkout, setup-bun (pinned), `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`.
   - `cross-platform-rust`: matrix `os: [macos-latest, windows-latest]`. Steps: checkout, rust-toolchain (pinned, with `targets: x86_64-apple-darwin` for macos / `x86_64-pc-windows-msvc` for windows — set via `target: ${{ matrix.target }}` inside an inline matrix include). `Swatinem/rust-cache@<SHA>` with default OS-keyed cache (security MED-2 — `runner.os` is the default cache key prefix; documented in commit body). Run `cargo check --manifest-path src-tauri/Cargo.toml`. **No tests on windows** (Tauri link deps complex); macos runs `cargo test`.
   - System-deps step (`apt-get`) untouched — stays in the linux `rust` job only.

4. **Concurrency**: keep existing `concurrency` block; no changes.

### Tests
- N/A. Verification = on first push to main after merge, the cross-platform jobs trigger; PR jobs unchanged.

### QA
- Syntax check: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` (Python is universally available; no extra dep). The fabricated js-yaml step (architect CONSIDER-6) is dropped.

### Commit
`ci: sprint 75 - matrix across linux/macos/windows`

---

## Sprint 77 — Release runbook + supply-chain checklist

### Current state
- No `docs/release.md`. No `scripts/release-checklist.sh`. Sprint 77 spec mandates both.

### Tasks

1. **`docs/release.md` (NEW)** — sections:
   - **Pre-flight gate**: `cargo audit`, `bun audit --audit-level high` (moderate findings tracked, 30-day SLA — security LOW-3), `cargo deny check` (no subcommand → runs `advisories + bans + licenses + sources` per security MED-3), version-bump consistency (Cargo.toml + package.json + tauri.conf.json).
   - **Exact-version pin policy**: list of currently-landed deps that MUST be exact-pinned: `keyring` (sprint 55 — verify present in Cargo.toml; if deferred per 2026-05-15 log, drop from list), `clap` (sprint 53), `russh` / `russh-sftp` / `russh-keys` (already present). **Drop** speculative pin documentation for `tauri-plugin-updater` (sprint 76 not landed) and `i18next` (sprint 82 not landed) — per architect CONSIDER-7, document the policy generally; do not list specific unlanded deps.
   - **General policy**: "any new Rust or JS dep added in a future sprint must (a) include an exact-version pin in the commit, and (b) include a `cargo audit` / `bun audit` run in the same commit's quality gate output."
   - **macOS notarization runbook**: prerequisites (Apple ID, app-specific password, Developer ID Application cert), `xcrun notarytool submit --apple-id "$APPLE_ID" --password "$APPLE_ID_APP_PASSWORD" --team-id "$APPLE_TEAM_ID"` with **secrets read from env, never literal args** (security LOW-4). All three vars MUST be stored in GitHub Actions encrypted secrets. `--wait` flag + staple step. No credential values in the doc.
   - **Windows signing runbook**: `signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f <cert>.pfx /p <pass> <binary>` (security LOW-5 — `/tr` RFC 3161 timestamp URL specified; `/td SHA256` algorithm). EV cert prerequisites listed. Password via env, not literal.
   - **Linux AppImage runbook**: `appimagetool` step, signing optional, distribution channel (placeholder).

2. **`deny.toml` (NEW)** — required for `cargo deny check` (security MED-3):
   - `[advisories] vulnerability = "deny"` `unmaintained = "warn"` `yanked = "deny"`.
   - `[licenses] allow = ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "Unicode-DFS-2016", "Zlib"]` (expand as needed when checking against actual transitive deps; may need iteration to converge).
   - `[bans] multiple-versions = "warn"` `wildcards = "deny"`.
   - `[sources] unknown-registry = "deny"` `allow-registry = ["https://github.com/rust-lang/crates.io-index"]`.
   - **Acknowledge**: `cargo deny check` may flag pre-existing license / version multiplicity findings on first run. Document expected baseline in commit body; if unresolvable in one sprint, downgrade `multiple-versions` to `warn` and file a follow-up note.

3. **`scripts/release-checklist.sh` (NEW)** — pure bash:
   - Shebang `#!/usr/bin/env bash`; `set -euo pipefail`; `IFS=$'\n\t'`.
   - `cargo audit --deny warnings` — fail on advisories.
   - `bun audit --audit-level high` — fail on high/critical.
   - `cargo deny check` — guarded by `command -v cargo-deny`; print install instructions and exit 1 if missing.
   - Version-bump consistency: extract from `src-tauri/Cargo.toml` (anchored regex `^version = "..."` per security LOW-1), `package.json` (top-level `"version":` only — no nested matches), `src-tauri/tauri.conf.json` (top-level `"version":`); assert all three identical; exit 1 otherwise.
   - File lands executable: commit with `git add --chmod=+x scripts/release-checklist.sh`.

4. **`.github/workflows/release-audit.yml` (NEW — architect SHOULD-5)**:
   - Separate workflow, NOT inline in `ci.yml`.
   - Triggers: `on: { push: { branches: ['release/**'], tags: ['v*'] } }`.
   - Workflow-level `permissions: contents: read` (security HIGH-2).
   - Single `audit:` job:
     - Checkout (pinned SHA).
     - `dtolnay/rust-toolchain@<SHA>` stable.
     - `Swatinem/rust-cache@<SHA>`.
     - `taiki-e/install-action@<SHA>` with `tool: cargo-audit@0.21.2,cargo-deny@0.16.4` (exact pins per security MED-1 + LOW-3).
     - `oven-sh/setup-bun@<SHA>` + `bun install --frozen-lockfile`.
     - Run `cargo audit --deny warnings`; run `bun audit --audit-level high`; run `cargo deny check`.
   - Per-sprint dep-add cross-reference removed (architect CONSIDER-7) — policy now lives only in `docs/release.md`.

### Tests
- `bash -n scripts/release-checklist.sh` — syntax-only check.
- Manual: run `scripts/release-checklist.sh` on the sandbox — `cargo audit` may not be installed; document that as expected and the script exits non-zero with a clear message (so the test asserts the *failure mode*, not success).

### QA
- `docs/release.md` markdown lint clean (no special tooling — visual inspect).
- `bash -n` clean.
- `ci.yml` parses (see sprint 75 verification).

### Commit
`docs(release): sprint 77 - release runbook + supply-chain checklist`

---

## Cross-Sprint Discipline

- Each sprint = independent commit; no batching. Per `feedback_commit_per_sprint.md`.
- Every commit body MUST run through `bun run quality` first; gate blocks if not green.
- Knip check on sprint 58 commit body (architect [CONSIDER] #16).
- After all three sprints land: append a new dated autonomous-run log noting shipped + deferred.

### Abort conditions

- **Sprint 58 fails `bun run quality`**: abort sprint 58. Sprints 75 + 77 are independent — proceed.
- **Sprint 75 ci.yml syntax invalid**: abort sprint 75. Sprint 77's separate workflow file is unaffected — proceed.
- **Sprint 77 script syntax invalid**: abort sprint 77 only. Earlier sprints already landed.

## Open Risks

1. **Sprint 58 risk**: dissolving `TauriAPIClient` to a factory touches `src/renderer/api/index.ts:16,22` (singleton sites) and `src/shared/types/api.ts:4` (JSDoc only). The `ElectronAPI` interface contract is unchanged. Risk vector = the spread-merge in `createTauriClient()` — if two domain modules export the same key, the later one silently wins. Mitigation: each domain module exports a `Pick<ElectronAPI, ...>` slice with explicit keys; TypeScript surfaces overlap as a duplicate-key error.
2. **Sprint 75 risk**: cross-platform jobs only run on main-merge + nightly cron (architect SHOULD-4 applied). PR cost unchanged. Trade-off: a windows-only regression lands on main before any contributor sees the failure. Mitigation: trigger cross-platform on any branch matching `release/*` too (already covered by sprint 77's audit workflow paths conceptually; document the gap in commit body).
3. **Sprint 77 risk**: `cargo deny check` may surface pre-existing license / multiple-versions findings on first run. Mitigation: `deny.toml` ships with `multiple-versions = "warn"` (not `deny`) initially; iteration to tighten happens in a follow-up sprint.
4. **Sprint 77 risk**: graceful exit for missing `cargo-deny` already addressed in script design.

---

## Verification Order

1. Sprint 58 implement → `bun run quality` green → commit.
2. Sprint 75 implement (ci.yml edit only) → yml parses + bun typecheck/lint unaffected → commit.
3. Sprint 77 implement (docs + deny.toml + script + new release-audit.yml workflow) → `bash -n` script → commit.

Final step: append a new dated autonomous-run log noting what shipped.

---

## Review Trail

### Metis Plan Consultant
- [x] MUST-1 — Sprint 74 mount deferred; component built but NOT mounted (AppConfig has no `features` field; adding one is scope creep). docs/cli.md appendix dropped.
- [x] MUST-2 — Knip shim handling spelled out: re-export shims stay USED via existing import chain; pre-commit knip grep required.
- [x] MUST-3 — Rust struct fields verified against `summarizer.rs:21-25` (camelCase via serde; `Option<String>` → `string | null`).
- [x] SHOULD-4 — Per-sprint abort conditions enumerated.
- [x] SHOULD-5 — Windows runner: MSVC target pinned, WebView2 preinstalled noted, `cargo check` fallback to `--no-default-features` documented.
- [x] SHOULD-6 — `cargo-audit` version pinned (`cargo-audit@0.21.2` via `taiki-e/install-action`).
- [x] CONSIDER-7 — docs/cli.md appendix entry dropped.
- [x] CONSIDER-8 — Sprint 58 test additions gated on pre-grep showing zero existing coverage.

### Auto-Picked Middle Reviewer(s) — security-auditor + architect-reviewer (parallel)

#### Security Auditor
- [x] HIGH-1 — Sprint 74 REMOVED from run. `resolve_session_path` is a pre-existing flaw across many commands; needs dedicated hardening sprint. Documented as out-of-scope.
- [x] HIGH-2 — `permissions: contents: read` added at workflow level on both `ci.yml` (sprint 75) and new `release-audit.yml` (sprint 77).
- [x] MED-1 — All GHA actions pinned to commit SHAs in sprints 75 + 77. SHAs to be looked up at implementation time and recorded in commit body.
- [x] MED-2 — `Swatinem/rust-cache@<SHA>` uses default OS-keyed cache; documented in commit body.
- [x] MED-3 — `cargo deny check` (no subcommand) runs all four checks; `deny.toml` shipped.
- [x] LOW-1 — Anchored regex for version extraction in `release-checklist.sh`.
- [x] LOW-3 — `bun audit --audit-level high`; moderate findings 30-day SLA documented in `release.md`.
- [x] LOW-4 — macOS notarization secrets via env vars from GHA secrets, never literal args.
- [x] LOW-5 — Windows `signtool` runbook uses `/tr` (RFC 3161) + DigiCert timestamp URL + `/td SHA256`.

#### Architect Reviewer
- [x] MUST-1 — Sprint 58 dissolves `TauriAPIClient` class into `createTauriClient()` factory; 2 import sites updated.
- [x] MUST-2 — Sprint 58 `groupTransformer` split by responsibility (`contentParsing.ts`, `aiSummary.ts`, `userContent.ts`), NOT by chunk type.
- [x] MUST-3 — Sprint 74 REMOVED from run (orphan code + AppConfig flag + path validation = multi-day; not autonomous-run-compatible).
- [x] SHOULD-4 — Cross-platform CI jobs gated to main-push + nightly cron only; PR hot path stays linux-only.
- [x] SHOULD-5 — Audit job moved to separate `.github/workflows/release-audit.yml`.
- [x] CONSIDER-6 — `reviveDates` test unconditional; JSDoc strip planned; `COMMAND_PATTERN` stateful-global fix included; fabricated js-yaml verification dropped (replaced with Python yaml).
- [x] CONSIDER-7 — `release.md` per-sprint dep-add gate cross-ref dropped; pin-policy for unlanded deps removed.

### Momus Plan Reviewer
- [x] All file paths verified; NEW markers correct (deny.toml / docs/release.md / scripts/release-checklist.sh / .github/workflows/release-audit.yml).
- [x] All line-number citations verified accurate (`tauriClient.ts:111`, `groupTransformer.ts` JSDoc lines, `summarizer.rs:21-25`, `path_util.rs:3-19`, `api/index.ts:16,22`, `api.ts:4`).
- [x] Sandbox executability confirmed; GHA SHA lookups marked as implementation-time tasks.
- [x] W-4 — Stale sprint 74 references removed (abort conditions + "four sprints" line).
- [x] W-5 — Commit prefixes normalized to single-domain (`refactor(api):` and `docs(release):`).
- [x] No scope creep; QA scenarios runnable.

**VERDICT: READY** — Sprints 58, 75, 77 cleared to implement autonomously.
