import { api } from '@renderer/api';

import { useStore } from '../useStore';

import type { ListenerContext } from './types';
import type { UpdaterStatus } from '@shared/types';

export function attachUpdaterListeners(ctx: ListenerContext): void {
  if (api.updater?.onStatus) {
    const cleanup = api.updater.onStatus((_event: unknown, status: unknown) => {
      const s = status as UpdaterStatus;
      switch (s.type) {
        case 'checking':
          useStore.setState({ updateStatus: 'checking' });
          break;
        case 'available':
          useStore.setState({
            updateStatus: 'available',
            availableVersion: s.version ?? null,
            releaseNotes: s.releaseNotes ?? null,
            showUpdateDialog: true,
          });
          break;
        case 'not-available':
          useStore.setState({ updateStatus: 'not-available' });
          break;
        case 'downloading':
          useStore.setState({
            updateStatus: 'downloading',
            downloadProgress: s.progress?.percent ?? 0,
          });
          break;
        case 'downloaded':
          useStore.setState({
            updateStatus: 'downloaded',
            downloadProgress: 100,
            availableVersion: s.version ?? useStore.getState().availableVersion,
          });
          break;
        case 'error':
          useStore.setState({
            updateStatus: 'error',
            updateError: s.error ?? 'Unknown error',
          });
          break;
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }
}
