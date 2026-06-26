# Week 4 — Port `analysis/` + Tokenizer → **Parity Gate**

**Objective:** Full message → chunk → `SessionDetail` pipeline in Go, producing
byte-identical JSON to the Rust CLI on every golden session. This is the make-or-break week.

**Prerequisites:** Week 3 `parsing/` complete.

## Tickets

### W4-T1 — Tokenizer (`analysis/tokenizer.rs` → tiktoken-go)
```go
import tiktoken "github.com/weaviate/tiktoken-go" // pkoukk is unmaintained
```
- Match the encoding the Rust side uses (`cl100k_base` vs `o200k_base` — check
  `tokenizer.rs`). Cache the encoder (`tiktoken.GetEncoding(...)`); it's expensive to build.
- **Parity-critical**: token counts drive user-visible cost. Golden-test `count_tokens`
  and `count_tokens_batch` against Rust output on varied text before trusting metrics.
- Verify: `count_tokens` matches `tiktoken-rs` on 50 sample strings (ASCII, unicode,
  code, emoji). If counts diverge, the encoding or special-token handling differs.

### W4-T2 — Port `chunk_builder.rs` (state machine)
- The AI-buffer-flush-on-non-AI-message logic is the core. Port the state machine
  states/transitions exactly. Reuse `chunk_builder_tests.rs` as Go table tests.
- Verify: chunk boundaries match Rust on golden sessions.

### W4-T3 — Port `chunk_factory.rs` + `tool_linking.rs` + `tool_execution_builder.rs`
- `chunk_factory`: typed chunks (User/AI/System/Compact/Event) with metrics.
- `tool_linking`: link tool_use→tool_result by ID.
- `tool_execution_builder`: build `ToolExecution` from linked pairs.
- Verify: tool linking + execution objects match Rust.

### W4-T4 — Port `semantic_step_extractor.rs` + `semantic_step_grouper.rs`
- Extract + group reasoning steps from AI responses.
- Verify against `semantic` test fixtures.

### W4-T5 — Port `context_accumulator.rs` + `process_linker.rs`
- `context_accumulator`: the 6-category visible-context stats (claude-md, mentioned-file,
  tool-output, thinking-text, team-coordination, user-message). Reset on compaction phases.
- `process_linker`: link subagent processes to parent chunks.
- Verify: `contextStats` + processes match Rust.

### W4-T6 — Assemble `BuildSessionDetail` and **run the parity gate**
```bash
go test ./internal/paritytest/...
```
- Must be **green on all golden sessions** (key-sorted JSON diff-clean).
- When a session diffs: bisect by comparing intermediate stages (ParsedMessage → chunks
  → detail) to localize the divergence. Add the failing session as a permanent fixture.

## Exit criteria
- [ ] Tokenizer counts match `tiktoken-rs`.
- [ ] **Parity harness GREEN on 100% of golden sessions.**
- [ ] Any divergence found becomes a committed regression fixture.

## Risks this week
- **Tokenizer drift** is the silent killer — verify counts in isolation (W4-T1) before
  blaming chunk logic for metric diffs.
- **Map iteration order**: Go map ranging is randomized; if any Rust output relied on
  insertion order (e.g. context categories, tool maps), use ordered slices or sort keys.
- **Float formatting**: cost is a float; Rust and Go may format `0.0001` differently in
  JSON. Round/format consistently or compare numerically, not as strings, in the harness.
- **Compaction phase reset**: `ContextPhaseInfo` reset semantics are subtle — test a
  session with a compaction event explicitly.
