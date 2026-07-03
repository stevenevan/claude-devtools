import { api } from '@renderer/api';

import { useStore } from '../useStore';

import type { ListenerContext } from './types';

export function attachMaintenanceListeners(ctx: ListenerContext): void {
  if (api.maintenance?.onScanProgress) {
    const cleanup = api.maintenance.onScanProgress((progress) => {
      useStore.getState().setMaintenanceProgress(progress);
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }
}
