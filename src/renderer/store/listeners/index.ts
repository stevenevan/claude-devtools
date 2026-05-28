import { useStore } from '../useStore';

import { attachConnectionListeners } from './connection';
import { attachFileChangeListeners } from './fileChange';
import { attachNotificationListeners } from './notifications';
import { createRefreshHelpers } from './refreshHelpers';
import { attachUpdaterListeners } from './updater';

import type { ListenerContext } from './types';

/**
 * Initialize notification event listeners and fetch initial notification count.
 * Call this once when the app starts (e.g., in App.tsx useEffect).
 */
export function initializeNotificationListeners(): () => void {
  const helpers = createRefreshHelpers();
  const ctx: ListenerContext = {
    cleanupFns: [],
    pendingSessionRefreshTimers: helpers.pendingSessionRefreshTimers,
    pendingProjectRefreshTimers: helpers.pendingProjectRefreshTimers,
    sessionLastActivityAt: helpers.sessionLastActivityAt,
    scheduleSessionRefresh: helpers.scheduleSessionRefresh,
    scheduleProjectRefresh: helpers.scheduleProjectRefresh,
    markSessionOngoing: helpers.markSessionOngoing,
    isSessionVisibleInAnyPane: helpers.isSessionVisibleInAnyPane,
    getBaseProjectId: helpers.getBaseProjectId,
  };

  attachNotificationListeners(ctx);

  // Fetch after listeners are attached so startup events do not get overwritten by a stale response.
  void useStore.getState().fetchNotifications();
  void useStore.getState().fetchBookmarks();
  void useStore.getState().fetchAnnotations();

  attachFileChangeListeners(ctx);
  attachUpdaterListeners(ctx);
  attachConnectionListeners(ctx);

  return () => {
    for (const timer of ctx.pendingSessionRefreshTimers.values()) {
      clearTimeout(timer);
    }
    ctx.pendingSessionRefreshTimers.clear();
    for (const timer of ctx.pendingProjectRefreshTimers.values()) {
      clearTimeout(timer);
    }
    ctx.pendingProjectRefreshTimers.clear();
    clearInterval(helpers.ongoingCheckInterval);
    ctx.sessionLastActivityAt.clear();
    ctx.cleanupFns.forEach((fn) => fn());
  };
}
