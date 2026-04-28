# 32-Week Sprint Roadmap (Sprints 18–49)

## Goal
Continue feature evolution of claude-devtools-tauri on top of completed sprints 1–17 (analytics backend/dashboard, annotations, code blocks, mermaid/latex, advanced filtering, bulk ops, cost trends, error hotspots, shortcuts, help panel, todos, search index, PDF export, quick actions, session grouping+minimap).

## Principles
- One sprint = one week = one deliverable theme.
- Each sprint is independently shippable; cross-sprint deps explicit.
- Prefer extending existing slices/components over parallel hierarchies.
- No new top-level architecture unless a sprint exists for it (38/39, 44).
- Respect file limits: 400 line target / 800 hard cap per file, 50-line functions.

## Phase Overview

| Phase | Sprints | Theme |
|-------|---------|-------|
| A | 18–25 | Deeper analytics & visualization |
| B | 26–31 | Session playback & exploration |
| C | 32–37 | Customization & workflow |
| D | 38–44 | Integrations & extensibility |
| E | 45–49 | Platform hardening |

## Sprint Index

### Phase A — Deeper Analytics & Visualization
- **18** Cost forecasting + `analytics/` split + `DashboardWidget` contract (full shape)
- **19** Context heatmap (presentational + thin tile wrapper)
- **20** Tool execution flame graph
- **21** Productivity metrics (lives under `analytics/productivity.rs`)
- **22** Tool usage time-of-day heatmap
- **23** Session duration analytics
- **24** Model performance comparison
- **25** Error pattern root-cause clustering

### Phase B — Session Playback & Exploration
- **26** `sessionDetailSlice` split + `ScrollController` open-union + minimap zoom/scrubber
- **27** Session replay mode (replay-cursor writer via ScrollController)
- **28** Multi-session comparison + `tabSlice` split → `comparisonTabSlice`
- **29** Agent team visualization tree
- **30** File dependency graph
- **31** Subagent spawn tree explorer

### Phase C — Customization & Workflow
- **32** Dashboard widget drag-drop (no retroactive refactor — sprint 18 seam)
- **33** Keyboard shortcut editor
- **34** Theme editor + custom CSS-var themes
- **35** Saved filter presets
- **36** Session snapshots (templates/prompt-prefix dropped)
- **37** Annotation/bookmark collections export/import

### Phase D — Integrations & Extensibility
- **38** Plugin sandbox host + API version contract + allowlist gate
- **39** Plugin settings UI + example plugins + docs
- **40** Notification rules engine (ships `Action::Webhook` stub)
- **41** Webhook integration — fills `Action::Webhook`
- **42** Terminal output parser (token accounting uses pre-collapse text)
- **43** Natural language session query (lexical only)
- **44** Cargo workspace split + `commands.rs` split + CLI companion

### Phase E — Platform Hardening
- **45** SSH robustness + from-scratch SFTP streaming (pre-46 so instrumentation wraps real code)
- **46** Backend observability — timings + cache metrics (Settings > Debug only)
- **47** Multi-window / pane split with tagged, coalesced, Lamport-ordered windowBus
- **48** Accessibility audit wave 2
- **49** Onboarding tour + empty-state polish

## Dependency Map (critical)
- 18 → 19–25 all register via `DashboardWidget` (full shape shipped in 18, no retrofit)
- 18 → 32 (widget contract is stable seam)
- 26 → 27 (`ScrollController` writer union extensible)
- 26 → pre-splits `sessionDetailSlice`
- 28 → pre-splits `tabSlice`
- 38 → 39 (sandbox host before settings UI)
- 40 → 41 (`Action::Webhook` stub before dispatch body)
- 44 → 45/46/47 (workspace + `commands.rs` split must compile green before Phase E)
- 45 → 46 (real SFTP before timing instrumentation wraps it)
- 46 → 47 (observability stable before multi-window state bus lands)

## Verification (per sprint)
1. `bun run typecheck` clean
2. `bun run lint:fix` clean
3. `cargo check` / `cargo test` clean for Rust sprints
4. `bun run test` relevant suite passes
5. Manual: feature exercised in dev build (`bun run dev`)

## Implementation Sequencing
1. After momus review passes, implement **sprint 18** immediately.
2. Sprint 18 first task: split `analytics.rs` (currently 1021 lines, past 800 cap) into `analytics/` module directory.
3. Subsequent sprints ship on 1-week cadence; one commit per sprint.

## Review Trail

### Metis Plan Consultant
- [x] Sprint 18 — `analytics.rs` size gate + split mandated (1021 lines confirmed)
- [x] Sprint 18 — budget alert notifications carved out
- [x] Sprint 18 — `DashboardWidget` contract seam added
- [x] Sprint 26 — `ScrollController` authority protocol added
- [x] Sprint 36 — templates/prompt-prefix dropped; snapshot-only
- [x] Sprint 38 split into **38 (sandbox)** + **39 (settings/examples)**
- [x] Original 39–44 shifted to 40–44; original 45+46 merged into new 46
- [x] Sprint 40 — `Action::Webhook` stub before sprint 41 dispatch
- [x] Sprint 43 — "did you mean" chip dropped
- [x] Sprint 44 — architect pre-gate recorded
- [x] Sprint 46 — Settings > Debug only, no dashboard card
- [x] Sprint 47 (then; now 45) — rescoped as from-scratch SFTP

### Architect Reviewer
- [x] Sprint 18 widget contract expanded: `category`, `minSize`, `maxSize`, `onMount/onUnmount` declared now to avoid 7-widget retrofit in 32
- [x] Sprint 19 — `ContextHeatmap` split into presentational + dashboard-tile wrapper
- [x] Sprint 21 — file paths updated to `analytics/productivity.rs` (post-18 split)
- [x] Sprint 26 — `ScrollController` writer identity changed from fixed enum to open string union; `virtualizer` writer noted for tanstack/react-virtual
- [x] Sprint 26 — `sessionDetailSlice.ts` split moved in as prerequisite (~726 lines, sprint 27 pushes past cap)
- [x] Sprint 28 — `tabSlice.ts` → `comparisonTabSlice.ts` split added as prerequisite
- [x] Sprint 38 — `apiVersion` contract required; allowlist capability gate (not denylist); subscription quota (5 concurrent / 64KB payload); 3-file host split to stay under soft cap
- [x] Sprint 42 — context token accounting must use pre-collapse text
- [x] Sprint 44 — `[workspace.dependencies]` unification, `SessionCache` Tauri-agnostic refactor, serde-stable API snapshot test, and `commands.rs` split into `commands/` dir all added
- [x] **Phase E reorder**: old 45 ↔ 47 — new order is **45 SSH → 46 observability → 47 multi-window** (so observability wraps real SFTP code and settles before state-bus lands)
- [x] Sprint 47 — windowBus requirements: origin-tag, 50ms topic coalesce, Lamport seq, `window_ready` handshake before seed, config writes round-trip through Rust

### Momus Plan Reviewer
- [x] File existence swept — all live paths verified
- [x] Sprint 23/24 `analytics.rs` path corrected to `analytics/duration.rs` + `analytics/model_comparison.rs` (post-18 split)
- [x] Sprint 37 `annotations.rs` corrected — annotation backend lives in `config/commands.rs`, `config/manager.rs`, `config/types.rs` (confirmed by `config_add_annotation` et al. in tree)
- [x] Sprint 47 `ShellLayout.tsx` corrected to `PaneContainer.tsx` (real pane host) + `TabbedLayout.tsx` (pop-out trigger)
- [x] Sprint 47 `commands.rs` path corrected to `commands/window.rs` (post-44 split)
- [x] Sprint 18 confirmed ready to start: all file refs resolve, deliverables concrete, QA fixture specified

**VERDICT: READY** — sprint 18 cleared to implement.
