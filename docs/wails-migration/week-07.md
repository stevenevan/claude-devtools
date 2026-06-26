# Week 7 — Frontend: Dialogs / Opener / Window / Process + Smoke Test (Wails v3)

**Objective:** Replace the remaining Tauri plugin usages (dialog, opener, window
controls, process) and run a full functional smoke test. After this, no `@tauri-apps`
import remains.

**Prerequisites:** Week 6.

## Tickets

### W7-T1 — Folder dialogs → server-side bound method
Tauri's `@tauri-apps/plugin-dialog` `open({ directory })` runs client-side; in Wails v3,
dialogs are Go-side via `app.Dialog`. Move `selectFolders`/`selectClaudeRootFolder` into
`ConfigService` ([v3 dialogs reference](https://v3.wails.io/reference/dialogs)):
```go
func (s *ConfigService) SelectFolders() ([]string, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Select Folder").
		CanChooseDirectories(true).
		CanChooseFiles(false).
		PromptForSingleSelection() // confirmed v3 API
	if err != nil || path == "" {
		return []string{}, err // never return nil → frontend expects []
	}
	return []string{path}, nil
}
```
- Tauri allowed multi-select; the verified v3 builder shows `PromptForSingleSelection`.
  If true multi-select is required, check the pinned alpha for a multiple-selection method;
  otherwise single-folder is an acceptable simplification for this app's use.
```ts
// config.ts
import { SelectFolders } from '../../bindings/claudedevtools/configservice';
selectFolders: () => SelectFolders(),
```
- Verify: folder picker opens; multi-select returns paths.

### W7-T2 — Opener (URLs + file paths)
- **URLs**: `import { Browser } from '@wailsio/runtime'; Browser.OpenURL(url)`
  (replaces `@tauri-apps/plugin-opener` `openUrl`).
- **File paths**: no frontend API — add a bound Go method using `os/exec`
  (`open` on macOS, `xdg-open` on Linux, `explorer` on Windows). Replaces `openPath`.
```go
func (s *SystemService) OpenPath(target string) error { /* exec platform opener */ }
```
- Verify: "open in finder/editor" and external links work.

### W7-T3 — Window controls → `@wailsio/runtime`
Confirmed v3 API ([frameless docs](https://v3.wails.io/features/windows/frameless)):
```ts
import { Window } from '@wailsio/runtime';
windowControls: {
  minimize: () => Window.Minimise(),
  close:    () => Window.Close(),
  // No frontend toggle helper — maximize-toggle is a bound Go method (below)
  maximize: () => WindowToggleMaximise(),  // from bindings/<module>/systemservice
},
```
For the maximize **toggle** (current app unmaximizes if already maximized), add a Go
method on a service holding the window — matches the verified v3 example:
```go
func (s *SystemService) WindowToggleMaximise() {
	w := application.Get().CurrentWindow()
	if w.IsMaximised() { w.UnMaximise() } else { w.Maximise() }
}
```
- Verify: titlebar buttons work; maximize toggles correctly.

### W7-T4 — Process relaunch + app version
- `relaunch` (`@tauri-apps/plugin-process`): no built-in. Either a bound Go method that
  re-spawns via `os/exec` + exits, or replace the UX with `Application.Quit()` from
  `@wailsio/runtime` if a true relaunch isn't required.
- `getVersion` (`@tauri-apps/api/app`): bound `SystemService.GetAppVersion()`.
- Verify: version string renders; relaunch path works (or is removed deliberately).

### W7-T5 — Autostart (was `tauri-plugin-autostart`)
- Wire `github.com/spiretechnology/go-autostart` behind config (Enable/Disable/IsEnabled).
  macOS uses `~/Library/LaunchAgents` (more reliably regenerated than system-level on
  recent macOS).
- Verify: toggle persists across login.

### W7-T6 — Full smoke test
- Every screen renders; every event-driven update fires: file change → refresh, SSH
  connect sequence, notification new/click, todo change.
- `grep -rn '@tauri-apps' frontend/src` → **must be empty**.

## Exit criteria
- [ ] Dialogs, opener, window controls, version, autostart all functional via v3.
- [ ] Zero `@tauri-apps` imports in the frontend.
- [ ] Full manual smoke test passes.

## Risks this week
- **v3 dialog/window builder API churn**: the exact method names/builders shift between
  alphas — verify each against your pinned version, don't trust this doc blindly.
- **`relaunch` gap**: decide early (re-spawn vs quit) — don't discover it at smoke test.
- **macOS autostart on recent versions**: prefer user-level LaunchAgents; system-level
  plists may not regenerate until reinstall.
