# Sprint 9 (Week 22: May 25 - May 31)

**Phase**: 3 - Rust Performance Migration
**Theme**: Tool Linking -> Rust
**Depends on**: Sprints 1-2 (Rust baseline tests)

## Deliverables

- [x] Tests for `tool_execution_builder.rs` — call/result matching, orphaned calls, dedup, sorting [BE] [M]
- [ ] Full TS→Rust port of `linkToolCallsToResults` — deferred (display-layer concern, different from chunk-level tool_executions) [BE] [L]
- [ ] IPC command `get_linked_tools` — deferred [BE] [M]
- [ ] Frontend wiring + benchmark — deferred [FE+BE] [M]

## Key Files

- `src/renderer/utils/toolLinkingEngine.ts` (source to port)
- `src-tauri/src/analysis/` (new: tool_linking.rs)
- `src-tauri/src/commands.rs`
- `src/renderer/utils/aiGroupEnhancer.ts`

## Done When

500-tool session links in < 10ms Rust; frontend shows identical results; TS fallback works.
