# W01 — Tauri 2.x scaffold beside Wails   ·   Cycle A: Scaffold & seam

## Goal
Stand up an empty Tauri 2.x shell that boots to the same window chrome as the Wails app, without disturbing the existing Wails build.

## Scope
Tauri 2.x scaffold beside Wails. New `src-tauri/` Rust workspace; window config reproducing the transparent titlebar + traffic lights from `main.go`; Vite wiring so the same frontend serves both backends.

## Packages / files to port
- New `src-tauri/` — Rust workspace root: `tauri.conf.json`, `Cargo.toml` (does not exist yet; W01 creates it).
- Window config → reproduce from `main.go`: `AppearsTransparent`, `InvisibleTitleBarHeight: 40`, 1400×900 default / 900×600 min. Tauri equivalent: `titleBarStyle: "Overlay"` + `hiddenTitle` + transparency/decorations keys — resolve the exact keys at the premise gate.
- Vite wiring: `beforeDevCommand` / `frontendDist` in `tauri.conf.json` pointing at the existing `frontend/` build, leaving Wails' own build untouched.

## Parity check
Empty Tauri shell boots to the same window chrome; Wails build still works.

## Invariants in force
- Always: #1 parity-gate, #2 frozen `WailsAPI`, #5 no-dep-drift, #6 commit-per-week-explicit-paths.
- Keep the Wails build runnable (invariant #1: both backends runnable until W16).
(full text: see migration-prompt.md "Invariants")

## Premise gate — RESOLVE BEFORE BUILDING
1. **Tauri major version = 2.x.** Impact if wrong: `tauri.conf.json` schema, `invoke`/`listen` API, and capability/permission model differ. Check: confirm the desired Tauri major, then verify config + IPC API via context7 / tauri.app docs.
2. **Transparent-titlebar chrome reproducible in Tauri** the way `main.go` does it in Wails. Impact if wrong: W01 window styling needs a platform tweak. Check: Tauri window `titleBarStyle: "Overlay"` / `hiddenTitle` docs (the original Tauri build used exactly this).

## Depends on
— (first week).

## Per-week loop
`/plan-with-review` scoped to this week → implement → **keep the Wails build runnable** → run parity check + gates (`cargo build`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
