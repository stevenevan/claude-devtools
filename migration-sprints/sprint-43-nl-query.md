# Sprint 43 — Week of 2026-10-26 | Extensibility

## Natural Language Session Query

### Deliverables
1. **Query parser (Rust)** — lexical translator from NL phrase to `AdvancedFilter`. Supports intent tokens: `last N (days|weeks|months)`, `using <tool>`, `over $X`, `with errors`, `containing "text"`, `by <author>`.
2. New command `parse_nl_query(query: String) -> AdvancedFilter`.
3. `SearchBar` extension: NL toggle; applies parsed filter on submit. Parsed filter rendered below input as read-only chips (so user sees what was interpreted).

### Files
- `src-tauri/src/nl_query.rs` (new)
- `src-tauri/src/lib.rs`
- `src/renderer/components/search/SearchBar.tsx` (NL toggle)
- `src/renderer/components/search/ParsedFilterChips.tsx` (new — read-only display)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 7 (advanced filters as translation target)
- Sprint 14 (search index; unchanged)

### Verification
- `cargo test` — 15 phrases → expected filter structs (golden table)
- Manual: unsupported phrase returns empty filter + inline "nothing matched" hint

### Out of Scope (explicit)
- "Did you mean" disambiguation chip — dropped per metis directive
- Semantic / embedding-based search
