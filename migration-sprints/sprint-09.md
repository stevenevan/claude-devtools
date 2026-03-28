# Sprint 9 (Week 22: May 25 - May 31)

**Phase**: 3 - Rust Performance Migration
**Theme**: Tool Linking -> Rust
**Depends on**: Sprints 1-2 (Rust baseline tests)

## Deliverables

- [ ] `tool_linking.rs` — port `linkToolCallsToResults` from `toolLinkingEngine.ts`, handle orphaned calls [BE] [L]
- [ ] IPC command `get_linked_tools` — accepts chunks, returns pre-linked tool map [BE] [M]
- [ ] Frontend consumes Rust-linked tools — replace TS calls, keep TS fallback [FE] [M]
- [ ] Benchmark: Rust vs TypeScript for 50/200/500+ tool sessions [BE] [S]

## Key Files

- `src/renderer/utils/toolLinkingEngine.ts` (source to port)
- `src-tauri/src/analysis/` (new: tool_linking.rs)
- `src-tauri/src/commands.rs`
- `src/renderer/utils/aiGroupEnhancer.ts`

## Done When

500-tool session links in < 10ms Rust; frontend shows identical results; TS fallback works.
