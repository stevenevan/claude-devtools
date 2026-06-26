# Execution Plan — Wails Migration Weeks 1–4

Status: APPROVED (metis ✓ · architect-reviewer ✓ · momus GO ✓)
Scope: Execute `docs/wails-migration/week-01.md` … `week-04.md`.
Owner outcome: Wails v3 (Go) app boots with the existing React UI, full
`parsing/` + `analysis/` pipeline ported to Go, **parity gate GREEN** (Go CLI emits
byte-identical JSON to the Rust CLI on every golden session).

## Context

- Tauri 2.x (Rust) → Wails v3 (Go alpha). ~95% of `src-tauri/src/` is pure
  data-transform logic with zero Tauri coupling; the hard part is a faithful Go
  rewrite proven byte-identical against the Rust CLI.
- Tauri stack (`src-tauri/`, `src/`) stays **untouched** — both run side-by-side
  until Week 8. Nothing here deletes or edits Rust/Tauri code.
- The **parity gate** is the single acceptance criterion for W3–W4. No parity = not done.

## Verified current state (recon done)

| Fact | Value | Impact |
|---|---|---|
| Rust CLI | `claude-devtools-cli show-session <proj> <id> --format json` (json is default) | golden snapshot command works as docs describe |
| Tokenizer | `cl100k_base` via `tiktoken_rs` (`src-tauri/src/analysis/tokenizer.rs`) | Go side = `weaviate/tiktoken-go` `cl100k_base` |
| Frontend | `src/renderer/**` + `src/shared/**`; `@tauri-apps` imported in **6 files** (`lib/logger.ts`, `api/domain/{analytics,config,system,files,sessions}.ts`) | W1 copy is mechanical; tauri break surface is small (fixed in W6, out of scope here) |
| LOC to port | parsing ≈1278, analysis ≈4302, types ≈781 (non-test) | W3–W4 are large; harness is the loop |
| Go | **1.22.0** installed | **BLOCKER**: Wails v3 requires Go **1.25+** |
| wails3 | **not installed** | must `go install` + pin |
| bun / python3 | 1.3.14 / 3.14.6 | golden normalization (`json.tool --sort-keys`) available |
| frontend/ , go.mod , golden/ | none exist | greenfield scaffold |

## Pre-flight (BLOCKER — resolve before W1)

P0. **Upgrade Go to 1.25+.** Wails v3 + `go install wails3` both require it.
  - Verify how Go is installed (`which go`; brew vs go.dev pkg), upgrade, confirm
    `go version` ≥ 1.25. **Requires user confirmation — system-level change.**
P1. **Install + pin wails3.** `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`,
    then after init pin `go.mod` to the exact `v3.0.0-alpha.NN` the init produced.
    `wails3 doctor` must be green.
P2. **Build the Rust CLI release** (needed for golden snapshots in W2-T5):
    `cd src-tauri && cargo build --release --bin claude-devtools-cli`. Verify the
    binary runs `show-session … --format json` on one real session.
P3. **Verify v3 alpha API before relying on any doc snippet.** v3 is alpha; window,
    dialog, event, service-lifecycle APIs move between releases. Cross-check every
    snippet against the pinned alpha via context7 (`/websites/v3_wails_io`,
    quick-start `/websites/v3alpha_wails_io_quick-start`) — the docs site 403s direct fetch.
P4. **Lock the Go JSON encoding strategy BEFORE writing any DTO** (highest-leverage
    pre-task — every W2–W4 ticket depends on it). Two rules, encoded once in a DTO
    template then applied mechanically:
  - **Key omission:** Rust `Option<T>` + `skip_serializing_if="Option::is_none"`
    **omits the key**. Go `*T` alone emits `null`. To match, every such field needs
    `json:"name,omitempty"` **and** a pointer type. Enumerate the full field list now:
    `grep -n "skip_serializing_if" src-tauri/src/types/chunks.rs src-tauri/src/types/messages.rs src-tauri/src/types/domain.rs`
    (≈38 in chunks, 29 in messages, 15 in domain).
  - **Enum encoding** (no native Go equivalent — custom marshaling, not a struct copy):
    - `ParsedMessageContent` is `#[serde(untagged)]` `Text(String) | Blocks(Vec<ContentBlock>)`
      → Go interface + custom `UnmarshalJSON` (try string, fall back to `[]ContentBlock`)
      + `MarshalJSON`.
    - `ContentBlock` is `#[serde(tag="type", rename_all="snake_case")]` → two-pass decode
      (`json.RawMessage` + switch on `"type"`), all variant fields pointer-optional.
      Never `interface{}`/`map[string]any` — the gate needs exact shape. Variant list in
      `src-tauri/src/types/jsonl.rs`.

## Phase W1 — Project init & scaffolding

Goal: `wails3 dev` launches a window with the React app (broken only on `@tauri-apps`
imports); bindings generated for 10 services; both stacks coexist.

- **W1-T1 Scaffold.** `wails3 init --help` first — confirm it writes only `go.mod`,
  `main.go`, `wails.json`, `frontend/` and does **not** overwrite repo-root
  `package.json`/`vite.config.ts`/`src/` (stage existing root files in git first as a
  safety net). Then `wails3 init -l` (list templates) and
  `wails3 init -n claude-devtools -t <react-ts-template-id>` at repo root. Keep Tauri
  tree untouched. Pin alpha in `go.mod`; record version in `README.md`.
- **W1-T2 Port frontend → `frontend/src/`.** Copy `src/renderer/**`; port Vite aliases
  (`@renderer`,`@shared`) — `@shared` lives in `src/shared/**`, copy it too; Tailwind 4
  + `index.css` theme vars; deps (Zustand 5, `@tanstack/react-virtual`, lucide-react,
  fontsource, base-ui, dnd-kit, etc. — copy from existing `package.json`). `bun add
  @wailsio/runtime`. Use **bun**. Specifics that bite (from metis):
  - The wails3 react-ts template scaffolds an npm app with its own minimal `vite.config.ts`.
    After init: delete `frontend/node_modules` + `frontend/package-lock.json`, then
    `cd frontend && bun install`.
  - Port the **full** existing `vite.config.ts` plugin list into `frontend/`:
    `@tailwindcss/vite`, `@vitejs/plugin-react`, `@rolldown/plugin-babel` (React Compiler
    preset) — the template omits all three.
  - Set `frontend` Vite `build.outDir` to `dist` (so `//go:embed all:frontend/dist` resolves).
  - **Do NOT touch repo-root `package.json` / `vite.config.ts`** (Tauri side still uses them).
  - Verify `cd frontend && bun run build` fails **only** on `@tauri-apps` imports.
- **W1-T3 Define 10 service structs** (`internal/<svc>/service.go`). Event-emitting
  ones (ssh, notifications, system, watcher) implement
  `ServiceStartup(ctx, application.ServiceOptions) error` + `ServiceShutdown() error`;
  pure-logic ones need no lifecycle hook. One real-ish bound method each so binding
  generation has something to emit.
- **W1-T4 `main.go`** — `application.New` registering all services + `Window.NewWithOptions`.
- **W1-T5 Generate bindings** — `wails3 generate bindings -ts`; confirm
  `frontend/bindings/<module>/...` per service and `@wailsio/runtime` resolves.

Exit: `wails3 dev` launches; `frontend/bindings/` has all 10; alpha pinned; Tauri intact.

## Phase W2 — Package layout, window chrome, parity harness

Goal: compiling empty Go skeleton mirroring `src-tauri/src/`; custom title bar; golden
snapshots committed; parity harness runs **red**.

- **W2-T1 `internal/` skeleton** mirroring the Rust tree (parsing, analysis, discovery,
  analytics, config, notifications, ssh, snapshots, domain, claroot). Stub signatures
  matching Rust public API; bodies return zero values + `errors.New("todo")`.
  **`go build ./...` builds the whole tree** — stub the **six off-gate-path** modules
  never ported in W1–4: `analysis/error_hotspots/`, `analysis/tool_analytics/`,
  `analysis/content_search`, `analysis/file_graph`, `analysis/summarizer`, and the
  `parsing/session_parser/incremental` reader (stub only — full port → W5).
  **NOTE (arch C1):** `analysis/timeline_gap_filling` is **on** the gate path
  (`chunk_factory.rs:105` calls `fill_timeline_gaps` on every AI chunk) — it is **not** a
  stub; it ports in W4-T3. Stubs only here, no logic. Verify `go build ./...` passes.
  - **Boundary rule (arch M1/M2 — draw package edges right from day one):** Go has no
    Rust-style sub-module escape hatch; an import cycle is a hard compile error. Keep
    `internal/domain`, `internal/parsing`, `internal/analysis` depending **downward only**
    (`domain` is a pure leaf — stdlib/encoding only, never imports a logic package; add a
    one-line import-check test so a later port can't violate it). Put shared leaf concerns
    (`path_decoder`, `claroot`, `time_util`) in leaf packages that never import
    `analysis`/watcher-service — this pre-empts the W5 cycle where `error_hotspots`/
    `tool_analytics`/`file_graph` reach "upward" into `watcher`/`discovery`/`commands`.
- **W2-T2 DTO package `internal/domain/`** from `src-tauri/src/types/`. **Every** field
  `json:"camelCaseName"` (serde `rename_all="camelCase"`). Apply the P4 encoding rules:
  `Option<T>` + `skip_serializing_if` → `*T` with `json:"name,omitempty"` (omits absent
  keys; `*T` alone wrongly emits `null`); custom marshal for `ParsedMessageContent` /
  `ContentBlock`. `ParsedMessage` itself (in `SessionDetail.messages[]`) has 10+ such
  optional fields — apply the rule there too. Frontend-iterated slices init `[]T{}` never `nil`.
  Tests: (a) round-trip casing vs a captured Rust JSON sample; (b) marshal a struct with
  all optionals nil → assert those keys are **absent** (not `null`).
- **W2-T3 Window chrome** — transparent title bar (`Mac.TitleBar.AppearsTransparent`,
  `InvisibleTitleBarHeight: 40`), drag region. **Confirm exact attrs against pinned alpha (P3).**
  Verify window drags; traffic lights render.
- **W2-T4 Icons + build profile** — `src-tauri/icons/` → `build/appicon.png`; confirm
  `wails3 build` produces a bundle.
- **W2-T5 Parity harness (the gate).** Pick 10–20 representative sessions (small, large,
  subagents, **teams, compaction, errors, thinking blocks** — cover the weird ones).
  Snapshot each via the Rust CLI into `docs/wails-migration/golden/<id>.json`
  (`python3 -m json.tool --sort-keys`). **Project id = the encoded folder name** under
  `~/.claude/projects/` (e.g. `-Users-stevenevan-Documents-GitHub-claude-devtools-tauri`),
  not a human-readable name. Build the Go CLI (`cmd/cli/main.go`) to assemble the embedded
  `Session` with the **same hardcoded stub fields the Rust CLI uses** (`src-tauri/src/bin/cli.rs`
  ~lines 168-186: `IsOngoing: ptr(false)`, `HasSubagents: false`, `ContextConsumption: nil`,
  etc.) and call `BuildSessionDetail(session, messages, []Process{})` — the CLI passes an
  empty processes slice. **Pin those stub values in one commented const block in the Go CLI
  citing `cli.rs:168-186` by line** (arch L2) so a future Rust-CLI change is a findable
  one-spot fix — this harness is throwaway at W8, don't over-build it. Write `internal/paritytest/parity_test.go`: run the Go pipeline over
  the same sessions, key-sort JSON, diff vs golden. Red now (stubs) — proves the loop.

Exit: `go build ./...` passes; DTOs json-tagged + null-correct; title bar drags on macOS;
golden committed; harness executes red.

## Phase W3 — Port `parsing/` + file watcher

Goal: `parsing/` Go modules pass ported unit tests vs Rust fixtures; watcher emits
debounced `file-change`/`todo-change` recursively without fd exhaustion.

- **W3-T1 `session_parser`** — the gate entry point is `session_parser/mod.rs::parse_session_file`,
  not just `streaming.rs` (arch L1). Port: `streaming.rs` (`parse_jsonl_file` + the shared
  `parse_jsonl_line` core — keep it in `streaming.go`, both readers share it) **and**
  `mod.rs::process_messages`, which calls `calculate_metrics`, `get_task_calls`, builds the
  `MessagesByType`/sidechain splits, and surfaces `custom_title`/`agent_name` from
  `SessionFileMetadata` — the CLI feeds these into the `Session` it compares (`cli.rs:177,184,185`).
  `incremental.rs` stays stubbed → W5. Streaming `bufio.Scanner` with large buffer
  (`scanner.Buffer(make([]byte,1MB),16MB)`); preserve line numbers (`session_scroll_to_line`
  depends on them). **Oversized-line semantics = drop, not error:** Rust drops lines over
  `MAX_JSONL_LINE_BYTES` (10MB) with a warn and continues; on Go's `bufio.ErrTooLong` log
  path + line number, **skip, and keep scanning** — do not abort the file. Verify line count
  + raw values vs Rust. (`process_messages` calls `calculate_metrics`, ported in W3-T4 — port
  metrics alongside, or stub it here and turn this gate green after W3-T4.)
- **W3-T2 `entry_parser` → `ParsedMessage`** — all roles + content types (text, thinking,
  tool_use, tool_result, images). Densest file; port struct-by-struct, test each variant.
  Depends on the P4 custom marshaling for `ParsedMessageContent`/`ContentBlock` (do that
  first). **Also port `parsing/content_normalization.rs`, `parsing/system_event.rs`, and
  `parsing/tool_extraction.rs` in this ticket** — `entry_parser.rs` imports all three
  directly (`entry_parser.rs:12` `use super::tool_extraction::{extract_tool_calls,
  extract_tool_results}`; plus `parse_message_content`, `parse_usage`,
  `build_system_event_data`). Without `tool_extraction` here, `go build` breaks (arch H1).
- **W3-T3 `message_classifier` → `MessageCategory`** — `HardNoise|User|Ai|System|Event|Compact`.
  Port `category_rules.rs` verbatim (isMeta is load-bearing). Reuse `category_rules_tests.rs`
  / `entry_parser_tests.rs` as Go table tests.
- **W3-T4 `metrics`, `deduplication`** (`tool_extraction` moved to W3-T2, arch H1) —
  **`metrics::calculate_metrics` has no tokenizer dependency** (arch C2): token counts are
  read straight from the JSONL `usage` field and `cost_usd` is `None`. So `SessionMetrics`
  is fully computable here in W3. Per-module table tests ported from Rust.
- **W3-T5 Watcher v3 service** — `rjeczalik/notify` recursive (`path/...` glob, **not** `**`),
  100ms debounce (matches Rust `DEBOUNCE_MS`), path-keyed map dedup. Source `projectsPath`
  from immutable `ClaudeRoot`; `todosPath` = `~/.claude/todos`. **Gate first flush on a
  frontend "ready" signal** (`ServiceStartup` runs before window mounts → early emits lost).
  `recover()` at the goroutine boundary. Verify a `touch` produces one debounced event.

Exit: parsing tests green vs fixtures; watcher emits debounced events recursively.

## Phase W4 — Port `analysis/` + tokenizer → PARITY GATE

Goal: full message→chunk→`SessionDetail` pipeline in Go; **parity gate GREEN on 100% of
golden sessions**.

- **W4-T1 Tokenizer — OFF the parity gate (arch C2; reclassified).** The gate path does
  **not** use `analysis/tokenizer.rs` (real tiktoken). The only token call reachable from
  `build_session_detail` is a file-local `count_tokens` in `semantic_step_extractor.rs:221`
  that is a **`ceil(len/4)` char estimate**, not tiktoken. Real `cl100k_base` is called only
  from analytics (`commands/analytics.rs`, `lib.rs`, `tool_analytics`) — all off-gate.
  - **For the gate (W4-T4):** port the `len/4` estimate as a private Go helper inside
    `semantic_step_extractor` — do **not** substitute tiktoken-go (it would diverge the gate).
  - **Real `weaviate/tiktoken-go` `cl100k_base`** (encoder cached, parity-tested vs
    `tiktoken-rs` on 50 varied strings) is a **W5 deliverable** (analytics path). If done
    here, mark it explicitly off-gate, not a gate prerequisite.
- **W4-T2 `chunk_builder`** state machine — AI-buffer-flush-on-non-AI-message is the core;
  port states/transitions exactly. **Port `analysis/state_machine.rs` (`ChunkBuildState`)
  first within this ticket** — `chunk_builder.rs` depends on it. Reuse `chunk_builder_tests.rs`
  as Go table tests.
- **W4-T3 `chunk_factory` + `tool_execution_builder` + `timeline_gap_filling`** — typed
  chunks with metrics; build `ToolExecution` from linked tool_use→tool_result pairs
  (`chunk_factory.rs:100`). **Port `analysis/timeline_gap_filling.rs` as a prerequisite
  here (arch C1)** — `chunk_factory.rs:105` calls `fill_timeline_gaps` on every AI chunk,
  setting serialized `effectiveEndTime`/`effectiveDurationMs`/`isGapFilled` on each
  `SemanticStep`; stubbing it diffs every AI session. **`tool_linking.rs` is OFF the gate
  (arch H2)** — its `link_tool_calls_to_results` HashMap is only used by analytics; defer to
  W5 (this also removes the only serialized-HashMap ordering risk from the W4 path).
  Verify vs Rust.
- **W4-T4 `semantic_step_extractor` + `semantic_step_grouper`** — extract+group reasoning
  steps; verify vs semantic fixtures.
- **W4-T5 `context_accumulator` + `process_linker`** — 6-category visible-context stats,
  reset on compaction phases; link subagent processes to parent chunks. **Wording fix
  (arch M3):** `SessionDetail` has **no** top-level `contextStats` field
  (`types/chunks.rs:262`) — `context_accumulator` output lands **inside** AI-chunk semantic
  steps (per-step `calculate_step_context`), which the gate **does** cover. **`process_linker`
  is NOT gated:** the CLI passes `[]` processes, so its output is empty in golden JSON; port
  it for correctness but exercise it via a separate unit test + W5's full `get_session_detail`
  path. Note both in the exit criteria.
- **W4-T6 Assemble `BuildSessionDetail`, run the gate** — `go test ./internal/paritytest/...`
  GREEN on all golden. On diff: bisect by stage (ParsedMessage → chunks → detail) to localize;
  add the failing session as a permanent fixture.

Exit: tokenizer matches `tiktoken-rs`; **parity GREEN on 100% golden**; divergences → fixtures.

## Verification strategy

Each phase has a hard gate (above). The loop for W3–W4 is the parity harness:
port a module → run `go test ./internal/paritytest/...` → bisect any diff → fix → repeat.
Run `go build ./...` + `go test ./...` after every ticket.

**What the gate proves — and does NOT (arch M3, honest acceptance contract):** the gate
proves transform parity for the CLI's **stubbed-`Session`, empty-`processes`** input —
i.e. `chunks`, `metrics`, `messages`, per-step context. It does **not** exercise the live
`get_session_detail` path: real `Session` fields, populated `processes`/subagent linking,
ongoing detection, context-consumption assembly — those are **not gated here** and are
validated in W5. Two harness hygiene items: (a) `--sort-keys` normalizes object keys but
**not array order** — `extract_primary_model` (`metrics.rs:77`) tie-breaks via
`HashMap.max_by_key`, nondeterministic on a model-count tie; port it with a stable secondary
key (e.g. model name lexical) matching the golden, so the gate can't flake. (b) Compare
floats numerically, not as strings.

## Risks (docs + recon)

1. **Go 1.22 < 1.25 required** — pre-flight P0, blocks everything.
2. **Floating alpha** drifts mid-project — pin exact, bump deliberately, verify snippets via context7 (P3).
3. **`skip_serializing_if` ≠ `omitempty`** (metis, top silent killer) — Rust omits absent keys; Go `*T` alone emits `null`. Use `*T` + `json:",omitempty"`; test that nil-optional keys are absent. (P4)
4. **Untagged/tagged enums** — `ParsedMessageContent`/`ContentBlock` need custom Go marshaling, not struct copies. (P4)
5. **JSON casing** — serde camelCase everywhere; Go needs explicit `json:` on **every** field or the frontend silently misses it.
6. **nil slice → `null`** — init `[]T{}`.
7. **Optional `time.Time`** — use `*T` (zero serializes `0001-01-01`, not `null`).
8. **Oversized JSONL line** — Rust drops + continues; Go must catch `bufio.ErrTooLong`, skip, continue (not abort the file). (W3-T1)
9. **Tokenizer drift — NOT a W1-4 gate risk (arch C2).** Gate uses a `len/4` estimate, not tiktoken; real tiktoken-go parity is a W5 (analytics) concern. Port the estimate verbatim for the gate.
10. **Map iteration order** randomized in Go — sort keys / ordered slices where Rust relied on order.
11. **Float formatting** of cost — compare numerically, not as strings, in the harness.
12. **Scanner buffer** default 64KB chokes on long JSONL → silent truncation.
13. **Emit-before-ready** — gate watcher first flush on frontend ready.
14. **Golden coverage gaps** — must include teams/compaction/error/thinking sessions or prod breaks.
15. **CLI Session stub mismatch** — Go CLI must replicate the Rust CLI's hardcoded `Session` fields exactly or the `session` object diffs. (W2-T5)
16. **Panics crash the app** — `recover()` at every goroutine boundary; bound methods return `error`.

## Open decisions (surface at approval)

- **D1 (Go upgrade):** how to upgrade Go to 1.25+ on this machine, and confirm it won't
  break the existing Rust/Tauri toolchain. Needs user go-ahead (system change).
- **D2 (scope realism):** W3–W4 port ≈5600 LOC to byte-parity — this is the bulk of the
  work and proceeds incrementally with the harness as the loop, not one-shot. Confirm
  appetite to run it as a long sequential effort (commit per ticket, per memory feedback).
- **D3 (golden session selection):** which real sessions become golden fixtures (need
  team/compaction/error/thinking coverage from the user's `~/.claude/projects`). Without
  the right ones the gate passes on easy sessions and breaks in prod.
- **D4 (incremental reader):** `parsing/session_parser/incremental.rs` is not in the parity
  gate (CLI uses the full reader). Stub-only in W1–4 (full port → W5) unless you want live
  tailing sooner. Default: stub now.

## Review Trail

### Metis Plan Consultant
- [x] P4 added: lock Go JSON encoding strategy first (`omitempty` for key omission; custom marshal for `ParsedMessageContent`/`ContentBlock`).
- [x] W2-T1: stub all build-referenced analysis modules (error_hotspots, tool_analytics, content_search, file_graph, summarizer, timeline_gap_filling) + incremental reader, else `go build ./...` fails.
- [x] W2-T2: `omitempty` + absent-key test; apply to `ParsedMessage` optionals too.
- [x] W2-T5: Go CLI must replicate Rust CLI `Session` stub fields + pass `[]` processes; encoded project-folder names.
- [x] W1-T1/T2: `wails3 init --help` safety check; delete scaffold node_modules + `bun install`; port full vite plugin list; outDir `dist`; don't touch root `package.json`/`vite.config.ts`.
- [x] W3-T1: drop (not error) on oversized line; port `streaming.rs`, stub `incremental.rs`.
- [x] W3-T2: port `content_normalization.rs` + `system_event.rs` in-ticket.
- [x] W4-T2: port `state_machine.rs` as prerequisite.
- [x] W4-T5: process_linker not covered by parity gate — noted.
- [x] Risks + open decisions (D4 incremental reader) updated.

### Architect Reviewer
- [x] **C1** `timeline_gap_filling` is ON the gate path (`chunk_factory.rs:105`) → moved from W2-T1 stubs into W4-T3 as a prerequisite port.
- [x] **C2** Tokenizer is OFF the gate: `metrics` reads token counts from JSONL `usage` (no tokenizer); `semantic_step_extractor` uses a `len/4` estimate, not tiktoken. Reclassified W4-T1; port the estimate for the gate, defer real tiktoken-go to W5.
- [x] **H1** `entry_parser` imports `tool_extraction` → moved into W3-T2 (was W3-T4) to keep `go build` green.
- [x] **H2** `tool_linking.rs` is OFF the gate (analytics only) → deferred; `tool_execution_builder` is the gate-critical item in W4-T3.
- [x] **M1/M2** Go package-cycle boundary rule added to W2-T1 (downward-only deps; `domain` pure leaf + import-check test; leaf packages for `path_decoder`/`claroot`/`time_util`).
- [x] **M3** Honest acceptance contract added (gate proves stubbed-Session/empty-processes transform only); fixed W4-T5 `contextStats` wording (no top-level field); `extract_primary_model` tie-break determinism note.
- [x] **L1** W3-T1 scope widened to `parse_session_file`/`process_messages` + metadata (`custom_title`/`agent_name`), not just `streaming.rs`.
- [x] **L2** Go CLI Session stub pinned in one commented const block citing `cli.rs:168-186`.
- [x] **L3** (noted) Go `*T`-everywhere idiom debt concentrated in `entry_parser` — budget extra review, lean on per-variant table tests.
- Approved-after-fold: strategic shape (coexisting stacks, parity-gate-as-contract, 1:1 mirror, service/concurrency model) confirmed sound.

### Momus Plan Reviewer
- [x] Verdict: **GO**. Every concrete `file:line`/symbol claim spot-checked against the codebase — all PASS (Session stub `cli.rs:168-186`, `chunk_factory.rs:100/105`, `semantic_step_extractor.rs:221` `len/4`, `metrics` no-tokenizer + `cost_usd:None`, `entry_parser.rs:12` import, `chunks.rs:262` no top-level `contextStats`, `cl100k_base`, `skip_serializing_if` 38/29/15).
- [x] Contradiction check clean: `timeline_gap_filling` on-gate (not double-listed), `tool_extraction` in W3-T2 only, `tool_linking`/`process_linker` consistently off-gate.
- [x] Executability + per-phase exit gates concrete and checkable; pre-flight blockers (Go 1.22<1.25, wails3 missing) accurately flagged.
- [x] Nit fixed: `extract_primary_model` cite `metrics.rs:75`→`:77`.

---

**Plan status: APPROVED for execution** (metis ✓ · architect-reviewer ✓ · momus GO ✓).
