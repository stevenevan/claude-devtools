# Week 8 — Tauri Purge, Validation & Stabilization (Wails v3)

**Objective:** Remove all Tauri/Rust artifacts, pass full regression, profile for leaks,
optimize the binary, produce signed builds.

**Prerequisites:** Week 7 — zero `@tauri-apps` imports, full smoke test green.

## Tickets

### W8-T1 — Purge Tauri
- Delete `src-tauri/` (Rust backend, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `icons/`
  after migrating to `build/`).
- Remove `@tauri-apps/*` from `package.json`; drop `tauri dev`/`tauri build` scripts.
- Move `src/renderer/**` fully under `frontend/src/` if not already; delete the old `src/` tree.
- Update root `CLAUDE.md`, `src-tauri/CLAUDE.md` (delete), `src/CLAUDE.md` to describe the
  Go/Wails layout. Update path-alias docs.
- Verify: `grep -rn 'tauri' . --include='*.ts' --include='*.tsx' --include='*.json'` → only
  historical/doc references remain; repo builds clean.

### W8-T2 — Regression suite
- Frontend: `cd frontend && bun run test` (vitest) + `bun run typecheck`.
- Go: `go test ./...` (ported unit tests) + the **parity harness** one last time on all
  golden sessions.
- Manual regression of the high-risk surfaces: SSH connect/retry/disconnect, snapshots
  create/open, notifications + triggers, config persistence, autostart, file-watch refresh.
- Verify: all green; parity diff-clean.

### W8-T3 — Leak & profiling pass
- **Goroutine leaks**: open/close many sessions and SSH connections; `runtime.NumGoroutine()`
  should return to baseline. Ensure the watcher channel + every spawned goroutine has a
  termination path.
- **Listener leaks**: every `Events.On` cleanup must run on component unmount (React
  `useEffect` teardown). Repeatedly mount/unmount chat views and watch listener count.
- **WebView memory**: long session open/close loop; confirm no unbounded growth.
- Verify: goroutine + listener counts stable across stress loop.

### W8-T4 — Binary optimization & packaging
```bash
wails3 build -ldflags="-s -w"        # strip symbol table + DWARF
# optional: upx --best <binary>       # smaller, slower cold start; test thoroughly
```
- Expect a **larger** binary than Tauri (Go runtime vs system WebView bindings) — set
  expectations; `-s -w` + UPX narrows the gap.
- Configure CSP via the v3 AssetServer (Tauri's `tauri.conf.json` CSP does not carry over).
- Produce platform bundles (macOS `.app`/`.dmg`, Windows NSIS, Linux deb/AppImage) and
  re-establish code signing / notarization.
- Verify: signed artifacts launch on a clean machine.

## Exit criteria
- [ ] No Tauri/Rust artifacts; repo builds and tests green.
- [ ] Parity harness green; manual regression passes.
- [ ] No goroutine/listener/memory leaks under stress.
- [ ] Optimized, signed builds for all targets.

## Risks this week
- **Hidden Tauri coupling**: a stray `window.__TAURI__` or capability assumption surfaces
  late. The `grep` gate catches imports; also test packaged (not just `wails3 dev`) builds.
- **CSP regressions**: moving CSP can silently break asset/connect-src; verify SSH WS and
  local asset loading still work.
- **Notarization**: macOS signing/notarization differs from Tauri's tooling — budget time.
- **UPX cold-start cost**: only ship it if the size win justifies the slower launch.
