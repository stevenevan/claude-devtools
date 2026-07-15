import { api } from '@renderer/api';

import { useStore } from '../useStore';

import type { ListenerContext } from './types';

// Set by maintenance:mute-watcher around bulk trash batches; fileChange.ts
// consults isWatcherMuted() to skip the session-list refresh storm.
let isMuted = false;

export function isWatcherMuted(): boolean {
  return isMuted;
}

export function attachMaintenanceListeners(ctx: ListenerContext): void {
  if (api.maintenance?.onScanProgress) {
    const cleanup = api.maintenance.onScanProgress((progress) => {
      useStore.getState().setMaintenanceProgress(progress);
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

  if (api.maintenance?.onMuteWatcher) {
    const cleanup = api.maintenance.onMuteWatcher((muted) => {
      isMuted = muted;
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

  if (api.maintenance?.onTrashed) {
    const cleanup = api.maintenance.onTrashed((projects) => {
      const selectedProjectId = useStore.getState().selectedProjectId;
      const baseId = ctx.getBaseProjectId(selectedProjectId);
      if (selectedProjectId && baseId && projects.includes(baseId)) {
        ctx.scheduleProjectRefresh(selectedProjectId);
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }
}
