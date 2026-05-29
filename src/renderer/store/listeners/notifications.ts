import { api } from '@renderer/api';

import { useStore } from '../useStore';

import type { DetectedError } from '../../types/data';
import type { ListenerContext } from './types';

export function attachNotificationListeners(ctx: ListenerContext): void {
  // Listen for new notifications from main process
  if (api.notifications?.onNew) {
    const cleanup = api.notifications.onNew((_event: unknown, error: unknown) => {
      // Cast the error to DetectedError type
      const notification = error as DetectedError;
      if (notification?.id) {
        // Keep list in sync immediately; unread count is synced via notification:updated/fetch.
        useStore.setState((state) => {
          if (state.notifications.some((n) => n.id === notification.id)) {
            return {};
          }
          return { notifications: [notification, ...state.notifications].slice(0, 200) };
        });
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

  // Listen for notification updates from main process
  if (api.notifications?.onUpdated) {
    const cleanup = api.notifications.onUpdated(
      (_event: unknown, payload: { total: number; unreadCount: number }) => {
        const unreadCount =
          typeof payload.unreadCount === 'number' && Number.isFinite(payload.unreadCount)
            ? Math.max(0, Math.floor(payload.unreadCount))
            : 0;
        useStore.setState({ unreadCount });
      }
    );
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

  // Navigate to error when user clicks a native OS notification
  if (api.notifications?.onClicked) {
    const cleanup = api.notifications.onClicked((_event: unknown, data: unknown) => {
      const error = data as DetectedError;
      if (error?.id && error?.sessionId && error?.projectId) {
        useStore.getState().navigateToError(error);
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }
}
