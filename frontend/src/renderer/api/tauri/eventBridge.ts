import { listen } from '@tauri-apps/api/event';

// Wails `Events.On` returns its unlisten fn synchronously; Tauri `listen` returns
// `Promise<UnlistenFn>`. Bridge the gap: return a synchronous unsubscribe that
// unlistens once the pending listen resolves — and immediately if it was
// unsubscribed before resolving. Double-unlisten is guarded by nulling the ref.
export function bridgeEvent<T>(event: string, handler: (data: T) => void): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  void listen<T>(event, (e) => handler(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  };
}
