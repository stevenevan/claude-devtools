# W02 — IPC + event seam   ·   Cycle A: Scaffold & seam

## Goal
Insert the dual-backend switch so the frontend can target Wails or Tauri by flag, running unchanged against Wails today.

## Scope
IPC + event seam. Add `createTauriClient()` beside `createWailsClient()`; `api/index.ts` selects one by flag; bridge Wails `Events.On` → Tauri `listen`; freeze `WailsAPI` as the parity contract.

## Packages / files to port
- `frontend/src/renderer/api/wailsClient.ts` (existing `createWailsClient()`) → add sibling `tauriClient.ts` exposing `createTauriClient()` returning the **same** `WailsAPI`.
- `frontend/src/renderer/api/index.ts` — the single dual-mode switch: choose factory by build/env flag (`initializeApi()` / `getImpl()` Proxy stays).
- Event bridge: the ~10 `Events.On` call sites → Tauri `listen`; keep the frontend event contract identical.
- Freeze `@shared/types/api` (`WailsAPI`) as the parity contract — do not change its shape (invariant #2).

## Parity check
Frontend runs against Wails unchanged with the switch inserted; zero component diffs.

## Invariants in force
- Always: #1, #2 (this week freezes `WailsAPI`), #5, #6.
- **#4 dual-mode** — this week *establishes* the `api/index.ts` factory switch; the flag lives until W15.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version (uses Tauri `invoke` / `listen` per the version confirmed at W01).

## Depends on
W01 (Tauri shell must boot).

## Per-week loop
`/plan-with-review` scoped to this week → implement (frontend seam) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
