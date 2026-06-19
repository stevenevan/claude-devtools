import { api } from '@renderer/api';

import { useStore } from '../useStore';

import type { ListenerContext } from './types';

export function attachConnectionListeners(ctx: ListenerContext): void {
  // NOTE: Only syncs connection status here. Data fetching is handled by
  // connectionSlice.connectSsh/disconnectSsh and contextSlice.switchContext.
  if (api.ssh?.onStatus) {
    const cleanup = api.ssh.onStatus((_event: unknown, status: unknown) => {
      const s = status as { state: string; host: string | null; error: string | null };
      useStore
        .getState()
        .setConnectionStatus(
          s.state as 'disconnected' | 'connecting' | 'connected' | 'error',
          s.host,
          s.error
        );
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

  if (api.context?.onChanged) {
    const cleanup = api.context.onChanged((_event: unknown, data: unknown) => {
      const { id } = data as { id: string; type: string };
      const currentContextId = useStore.getState().activeContextId;
      if (id !== currentContextId) {
        // Main process switched context externally (e.g., SSH disconnect)
        void useStore.getState().switchContext(id);
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }
}
