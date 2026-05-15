# Autonomous Run Plan — 2026-05-22 (sprint 56 wave 2)

Wave 1 (commit `f8fef33`) shipped: per-line 10 MB cap in `session_parser.rs` + 9 tests + `docs/security.md`. PLAN.md sprint 56 target: +20 tests. Gap to close: +11.

**Metis applied** — 6/11 of the original proposals were duplicates of existing tests. Plan redistributed to real coverage gaps:

| File | Existing | Added | After |
| ---- | -------- | ----- | ----- |
| `src-tauri/src/analysis/chunk_builder.rs` (548 lines, 18 tests) | 18 | +7 | 25 |
| `src-tauri/src/analysis/tool_linking.rs` (345 lines, 7 tests) | 7 | +4 | 11 |

`message_classifier.rs` (799 lines) untouched — at 1 below the 800-line hard cap.

Cargo-fuzz target work continues deferred (sandbox blocks `cargo install cargo-fuzz`); install + target template already documented in `docs/security.md` (wave 1).

## Test plan (+11)

### `chunk_builder.rs` boundary cases (+7) — genuine gaps verified vs existing 18 tests

1. **`test_system_message_flushes_ai_buffer_mid_sequence`** — `[ai, ai, system, ai]` → 3 chunks: AI(2 responses), System, AI(1). Current `test_system_chunk_in_sequence` only puts system at END; never tests flush-and-resume mid-stream.
2. **`test_event_message_flushes_ai_buffer_mid_sequence`** — `[ai, ai, event, ai]` → 3 chunks. Current `test_event_chunk_in_sequence` only puts event at END.
3. **`test_compact_message_flushes_ai_buffer_mid_sequence`** — `[ai, compact, ai]` → 3 chunks. Current `test_compact_chunk_in_sequence` is `[ai, compact, user]` and doesn't verify the resume side.
4. **`test_isolated_meta_user_does_not_create_user_chunk`** — single `isMeta: true` user with empty Blocks content → empty chunks Vec. `test_typical_conversation_pattern` only verifies meta absorption *inside* a sequence; isolated case is uncovered.
5. **`test_incremental_no_new_messages_returns_empty`** — `build_chunks_incremental(&[], &[], 5)` returns `replace_from_index: 5` (or equivalent boundary) and empty `chunks`. The shrink-from-empty edge isn't covered.
6. **`test_incremental_returns_chunks_matching_full_build`** — for the same `msgs`, `build_chunks_incremental(&msgs, &[], 0).chunks` equals `build_chunks(&msgs, &[])`. Verifies the incremental path doesn't drift from the canonical builder.
7. **`test_multiple_sidechain_messages_all_filtered`** — `[u1, sidechain, sidechain, a1]` → 2 chunks (User, AI). Existing `test_sidechain_messages_filtered_out` only filters one sidechain.

### `tool_linking.rs` boundary cases (+4) — verified against existing 7 tests

1. **`stray_tool_result_without_matching_call_is_ignored`** — semantic step is only a tool_result (no tool_call) → empty map. Stray-result is the symmetric case of `orphaned_call_without_result` and is currently uncovered.
2. **`skill_call_without_instructions_response_has_none`** — Skill tool_call + matching tool_result, but the response carries NO `Base directory for this skill:` text → `skill_instructions` is `None`. Counterpart to `extracts_skill_instructions`.
3. **`error_result_defaults_to_false_when_unset`** — tool_call + tool_result without `is_error` → linked entry's `result.is_error` is false. Counterpart to `error_result_detected`.
4. **`skill_instructions_token_count_proportional_to_length`** — two skill calls, one with short instructions and one with long; long entry's `skill_instructions_token_count` is strictly greater. Boundary on the heuristic estimate that `extracts_skill_instructions` only asserts `is_some()` on.

## Non-goals

- No production code changes; pure `#[test]` additions in existing `#[cfg(test)] mod tests` blocks.
- No new dependencies.
- No fuzz install (sandbox-blocked).
- No refactor of either file.
- `message_classifier.rs` untouched (800-line hard cap).
- `chunk_factory.rs` not extended in wave 2 — already has 12 tests; metis CONSIDER not actioned this run.

## Verification

1. `cargo check --tests` clean.
2. `cargo test --lib` count rises by 11 (467 → 478).
3. `bun run typecheck` / `bun run lint` unchanged.
4. Hard-cap check: `wc -l` on both files — both stay under 700.

## Commit

- `test(rust): sprint 56 wave 2 - chunk_builder + tool_linking boundary tests`

## Review Trail

### Metis Plan Consultant
- [x] MUST: 6 of 11 originally proposed tests dropped as duplicates of existing tests.
- [x] MUST: replacement targets identified — 3 mid-sequence flush boundaries (System/Event/Compact); incremental builder gaps; symmetric stray-tool-result + Skill-without-instructions + error_default cases.
- [x] SHOULD: distribution rebalanced 7+4 to fit genuine gaps.
- [x] CONSIDER: `chunk_factory.rs` flagged as next sprint's coverage opportunity (12 existing tests; not actioned this run).
- [x] CONSIDER: `tests/` integration dir as way to grow `message_classifier` coverage without breaching 800-cap — flagged future, not actioned.

### Middle Reviewers
**Auto-picked: SKIP** — pure test additions, no security or architecture surface per `feedback_auto_middle_reviewer.md`.

### Momus Plan Reviewer
(pending)
