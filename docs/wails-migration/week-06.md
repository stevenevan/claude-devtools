# Week 6 — Frontend: invoke → Bindings, Events (Wails v3)

**Objective:** Swap the data-call and event layers in `src/renderer/api/domain/*.ts`
from `@tauri-apps` to v3 generated bindings + `@wailsio/runtime`. Components untouched
(they go through the `Proxy` in `api/index.ts`).

**Prerequisites:** Week 5 — all bindings generated under `frontend/bindings/`.

## Key translation rules

| Tauri | Wails v3 |
|---|---|
| `invoke('get_session_detail', { projectId, sessionId })` | `GetSessionDetail(projectId, sessionId)` — **positional args** from `frontend/bindings/<module>/sessionservice` |
| `listen('ssh-status', e => cb(e.payload))` → returns unlisten | `Events.On('ssh-status', e => cb(e.data))` → returns cleanup fn |
| return value | unchanged; `reviveDates()` still wraps it (Go `time.Time` → RFC3339) |
| `Result<T, String>` rejection | Go `error` → rejected promise; `.catch` gets the message |

> Wails v3 events deliver `{ data }` (sometimes `{ data, name, sender }`), not Tauri's
> `{ payload }`. Update every callback to read `e.data`.

## Tickets

### W6-T1 — `sessions.ts`
```ts
// before
import { invoke } from '@tauri-apps/api/core';
getSessionDetail: async (projectId, sessionId) =>
  reviveDates(await invoke('get_session_detail', { projectId, sessionId })),

// after
import { GetSessionDetail } from '../../bindings/claudedevtools/sessionservice'; // confirm path
getSessionDetail: async (projectId, sessionId) =>
  reviveDates(await GetSessionDetail(projectId, sessionId)),
```
- Convert all 10 session/project/todo/detail/incremental/by-ids calls. Keep `reviveDates`
  on the same 5 call sites it wraps today.
- Verify: session list + detail render identically; dates are `Date` objects.

### W6-T2 — `analytics.ts`, `files.ts`
- Mechanical invoke → binding swap. Watch argument **order** (positional now).
- Verify: dashboards, file-graph, CLAUDE.md panels render.

### W6-T3 — `config.ts` (data calls + notification events)
- 45 config calls + notifications CRUD → bindings.
- Events: `notification:new|updated|clicked` via `Events.On(...)`, reading `e.data`.
  Preserve the existing "return a cleanup function" contract:
```ts
import { Events } from '@wailsio/runtime';
onNew: (callback) => {
  const cleanup = Events.On('notification:new', (e) => callback(null, e.data));
  return cleanup;
},
```
- Verify: notifications panel updates live; unread count tracks.

### W6-T4 — `system.ts` event listeners
- `file-change`, `todo-change`, `ssh-status` → `Events.On(name, e => cb(e.data))`.
- Keep returning the cleanup fn so React `useEffect` teardown still unsubscribes.
- Verify: editing a JSONL refreshes the session; SSH status badge updates.

## Exit criteria
- [ ] `sessions/analytics/files/config` data calls use `frontend/bindings/`.
- [ ] All event listeners use `@wailsio/runtime` `Events.On`, reading `e.data`, returning cleanup.
- [ ] No component file changed — only `api/domain/*.ts`.

## Risks this week
- **Positional args**: a wrong arg order is silent. Cross-check each call against the
  generated `.d.ts` signature.
- **`e.payload` → `e.data`**: every listener callback must change shape or it reads `undefined`.
- **Bindings import path**: `frontend/bindings/<gomodule>/<package>` — verify the exact
  module name your `go.mod`/`wails3` produced; it's not `wailsjs/go/`.
- **Listener leaks**: every `Events.On` cleanup must be returned and called on unmount.
