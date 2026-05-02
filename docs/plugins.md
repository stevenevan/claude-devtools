# Plugins API

claude-devtools plugins run inside a sandboxed classic Web Worker. The host
deletes everything off `self` not on a tight allowlist (see
`src/renderer/plugins/capabilityGate.ts`) before any plugin code runs:
no `fetch`, no `XMLHttpRequest`, no `importScripts`, no `WebSocket`.

## Manifest

Every plugin must set `self.manifest` in its top-level scope:

```js
self.manifest = {
  id: 'my-plugin',
  apiVersion: '1.0',
  displayName: 'My Plugin',
};
```

The host rejects loads where `apiVersion`'s major component does not match
the host's `PLUGIN_API_VERSION` (currently `1.0`).

## Discovery

Plugins are discovered as `*.js` files in `~/.claude-devtools/plugins/`.
Anything other than a top-level `.js` file is ignored. Discovery is
read-only on the Rust side — the backend never executes plugin code.

## Public API methods

| Method                      | Description                                                     |
| --------------------------- | --------------------------------------------------------------- |
| `registerPanel(d)`          | Register a panel rendered as sandboxed HTML (max 1 per plugin). |
| `registerCommand(d)`        | Register a callable command (max 10 per plugin).                |
| `registerContextMenuItem(d)`| Register a session/annotation/bookmark menu item (max 5).      |
| `subscribeStoreSlice(s, o)` | Subscribe to one of: `sessions`, `activeSession`, `annotations`, `bookmarks`, `snapshots`. |

### Quotas

| Resource              | Limit                                  |
| --------------------- | -------------------------------------- |
| Concurrent panels     | 1 per plugin                           |
| Concurrent commands   | 10 per plugin                          |
| Context menu items    | 5 per plugin                           |
| Concurrent subscriptions | 5 per plugin                        |
| Subscription payload  | 64 KB per emission (oversized dropped) |
| Teardown timeout      | 100 ms (worker terminated then)        |

Anything beyond a quota returns a quota-exceeded response and is silently
dropped on emission.

## Lifecycle

1. User enables a plugin in **Settings → Plugins**.
2. Host loads the file, prepends the capability preamble, and spawns a
   classic Worker via `Blob` + `URL.createObjectURL`.
3. The plugin runs its top-level code which may call any of the public
   methods above via `pluginAPI`.
4. On disable: pending RPCs reject with `PluginDisposedError`, and the
   worker is terminated within 100 ms.

## Examples

See `examples/plugins/word-count.js` and `examples/plugins/theme-toggle.js`
for end-to-end references.
