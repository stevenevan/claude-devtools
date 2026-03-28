# Sprint Plan: claude-devtools (Week 14 - Week 32, 2026)

19 weekly sprints | March 30 - August 9, 2026
Frontend (React/TypeScript) and Backend (Rust/Tauri) only.

## Big Picture

| Phase | Sprints | Weeks | Theme | Key Outcomes |
|-------|---------|-------|-------|-------------|
| 1 | 1-4 | 14-17 | Quality Foundation | 120+ Rust tests, 65+ React/hook tests, test infra for both |
| 2 | 5-8 | 18-21 | Live Session Experience | Incremental parsing, streaming UX, live metrics, <300ms latency |
| 3 | 9-12 | 22-25 | Rust Performance Migration | Tool linking, context tracking, search in Rust; proper tokenizer; path fix |
| 4 | 13-16 | 26-29 | Feature Completeness | Comparison view, bookmarks/tags, subagent nav, dashboard persistence |
| 5 | 17-19 | 30-32 | Polish & Accessibility | Error UX, a11y audit, bundle optimization, performance baselines |

## Phase Descriptions

### Phase 1: Quality Foundation (Weeks 14-17)
Establish a testing safety net before changing anything. 12,600 lines of untested Rust and 183 untested React components. Any feature work without coverage risks expensive regressions.

### Phase 2: Live Session Experience (Weeks 18-21)
Make watching an ongoing Claude Code session feel real-time. The `isStreaming` flag exists in `TabSessionData` but the UX is incomplete. Implement incremental parsing in Rust, progressive message rendering, streaming-aware auto-scroll, and live metrics.

### Phase 3: Rust Performance Migration (Weeks 22-25)
Move expensive TypeScript computations to Rust: tool linking (`toolLinkingEngine.ts`), visible context computation (`contextTracker.ts`), and search filtering. Each runs in the renderer process on every refresh today. Also fix lossy path decoding and rough token estimation.

### Phase 4: Feature Completeness (Weeks 26-29)
Finish partially-built features. The `comparison` tab type exists but has no view. Bookmarks/tags have 4 Rust commands but no frontend. Subagent navigation has breadcrumbs but limited store support. Todo panel was recently added and needs refinement.

### Phase 5: Polish & Accessibility (Weeks 30-32)
Error dialogs replacing silent `console.error`, comprehensive a11y audit, bundle analysis/code splitting, SSH retry/recovery, and memoization audit.

## Key Dependencies

- Sprint 5 depends on Sprints 1-2 (Rust parsing tests before modifying parser)
- Sprint 6 depends on Sprint 5 (frontend streaming needs incremental backend)
- Sprints 9-11 depend on Sprints 1-2 (Rust migrations need baseline tests)
- Sprint 13 depends on Sprint 3 (ComparisonView needs component test infra)

## Capacity

~4 productive dev days per sprint. S < 1 day, M = 1-2 days, L = 3-5 days. 15% buffer for unexpected issues.
