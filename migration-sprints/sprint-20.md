# Sprint 20 (Week 33: Aug 10 - Aug 16)

**Phase**: Cleanup
**Theme**: Remove Unnecessary Comments

## Deliverables

- [ ] Remove redundant/obvious comments from TypeScript source files [FE] [L]
- [ ] Remove redundant/obvious comments from Rust source files [BE] [M]
- [ ] Keep only comments that explain non-obvious logic or "why" decisions [FE+BE] [S]

## Guidelines

Comments REMOVED:
- 459 three-line separator blocks (// ===...===) from 83 files → single-line section names
- 33 restating comments from 20 files (e.g., "// Filter to main thread" before `.filter(|m| !m.is_sidechain)`)

Comments KEPT:
- Explanations of non-obvious behavior or workarounds
- "Why" comments explaining business logic or design decisions
- eslint-disable with explanations
- Warning comments about gotchas or edge cases

## Done

All source files audited; 473 vitest and 288 Rust tests pass.
