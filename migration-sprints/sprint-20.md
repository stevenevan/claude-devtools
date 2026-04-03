# Sprint 20 (Week 33: Aug 10 - Aug 16)

**Phase**: Cleanup
**Theme**: Remove Unnecessary Comments

## Deliverables

- [ ] Remove redundant/obvious comments from TypeScript source files [FE] [L]
- [ ] Remove redundant/obvious comments from Rust source files [BE] [M]
- [ ] Keep only comments that explain non-obvious logic or "why" decisions [FE+BE] [S]

## Guidelines

Comments to REMOVE:
- Comments that restate the code (e.g., `// Set the name` above `setName(...)`)
- Section separators that don't add value
- Commented-out code
- TODOs without actionable context
- JSDoc that restates the function signature

Comments to KEEP:
- Explanations of non-obvious behavior or workarounds
- "Why" comments explaining business logic or design decisions
- Type annotations that clarify complex generics
- Warning comments about gotchas or edge cases

## Done When

All source files have been audited; no redundant comments remain; existing tests still pass.
