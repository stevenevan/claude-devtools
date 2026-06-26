# Week 2 — Go Package Layout, Window Chrome & Parity Harness

**Objective:** Compiling (empty) Go package skeleton mirroring `src-tauri/src/`,
the custom title bar reproduced, and committed golden snapshots that gate Weeks 3–5.

**Prerequisites:** Week 1 complete.

## Tickets

### W2-T1 — `internal/` package skeleton
Mirror the Rust module tree so porting is 1:1:
```
internal/
├── parsing/      # session_parser, entry_parser, message_classifier, tool_extraction, metrics, deduplication
├── analysis/     # chunk_builder, chunk_factory, tool_linking, semantic_step_*, context_accumulator, process_linker, tokenizer
├── discovery/    # project_scanner, session_lister, path_decoder, subagent_resolver/locator, ongoing_detector, subproject_registry
├── analytics/    # aggregate, duration, productivity, forecasting, session_scan
├── config/       # manager (ConfigState), triggers, types
├── notifications/# manager, trigger_matcher, error_detector, webhook
├── ssh/          # connection_manager, config_parser, sftp_provider, known_hosts, retry, agent_discovery
├── snapshots/
├── domain/       # shared DTOs (the types/ equivalent) — ALL with json: tags
└── claroot/      # ClaudeRoot (immutable, resolved once)
```
- Each file: package decl + stub signatures matching the Rust public API.
- Verify: `go build ./...` passes (empty bodies returning zero values + `errors.New("todo")`).

### W2-T2 — DTO package with explicit JSON tags
- Port `src-tauri/src/types/` structs into `internal/domain/`.
- **Every** field gets `json:"camelCaseName"` (serde uses `rename_all = "camelCase"`).
- Optional fields (`Option<T>`) → pointer types (`*T`) so they serialize to `null`.
- Slices that the frontend iterates → never leave `nil`; constructors init `[]T{}`.
- Verify: round-trip test — marshal a sample struct, assert key casing matches a
  captured Rust JSON sample.

### W2-T3 — Window chrome (custom title bar, v3)
The Tauri config uses `titleBarStyle: "Overlay"` + `hiddenTitle: true` (transparent
title bar, traffic lights visible, content under the bar). Reproduce in the
`WebviewWindowOptions` from W1-T4:
```go
app.Window.NewWithOptions(application.WebviewWindowOptions{
	Title:     "claude-devtools",
	Width:     1400, Height: 900,
	MinWidth:  900, MinHeight: 600,
	Mac: application.MacWindow{
		TitleBar:                application.MacTitleBar{AppearsTransparent: true},
		InvisibleTitleBarHeight: 40, // drag region height
	},
})
```
- The `InvisibleTitleBarHeight` band is draggable; for additional drag zones add the
  Wails draggable CSS to that element (`style="--wails-draggable: drag"`) — confirm the
  exact attribute against your pinned alpha.
- Windows/Linux: keep standard decorations or add a custom bar later (out of scope now).
- Verify: window drags by the title bar; min/maximize/close render correctly.

### W2-T4 — Icons & build profiles
- Convert `src-tauri/icons/` into `build/appicon.png` (Wails generates platform icons).
- Configure `wails.json` build options; confirm `wails build` produces an app bundle.

### W2-T5 — **Parity harness** (the gate)
- Build the existing Rust CLI: `cd src-tauri && cargo build --release --bin claude-devtools-cli`.
- Pick 10–20 representative sessions (small, large, with subagents, with teams, with
  compaction, with errors) from `~/.claude/projects`.
- Snapshot each:
```bash
mkdir -p docs/wails-migration/golden
for s in <list>; do
  ./src-tauri/target/release/claude-devtools-cli show-session <proj> "$s" --format json \
    | python3 -m json.tool --sort-keys > docs/wails-migration/golden/"$s".json
done
```
- Write `internal/paritytest/parity_test.go`: runs the Go pipeline over the same
  sessions, key-sorts JSON, diffs against golden. (Stubs fail now — that's expected;
  it turns green in W4.)
- Verify: harness runs and reports diffs (red), proving the loop works.

## Exit criteria
- [ ] `go build ./...` passes; DTOs have full `json:` tags + null-correct optionals.
- [ ] Custom title bar + dragging works on macOS.
- [ ] Golden snapshots committed; parity harness executes (red).

## Risks this week
- **`time.Time` zero value** serializes to `0001-01-01T00:00:00Z`, not `null` — use
  `*time.Time` for any `Option<DateTime>` field now, or W4 parity will fail subtly.
- **Number precision**: Rust `u64` token counts exceeding 2^53 lose precision as JS
  `number`. Same as today — keep as `int64`/`number`, don't switch to string.
- **Golden coverage gaps**: if you snapshot only simple sessions, parity passes but
  real edge cases (teams, compaction) break in prod. Cover the weird ones now.
