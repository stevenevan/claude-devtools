import { api } from '@renderer/api';

import { useStore } from '../useStore';

import type { DetectedError } from '../../types/data';
import type { ListenerContext } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDetectedError(value: unknown): value is DetectedError {
  if (!isRecord(value) || !isRecord(value.context)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    typeof value.sessionId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.filePath === 'string' &&
    typeof value.source === 'string' &&
    typeof value.message === 'string' &&
    typeof value.isRead === 'boolean' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.context.projectName === 'string'
  );
}

export function attachNotificationListeners(ctx: ListenerContext): void {
  if (api.notifications?.onNew) {
    const cleanup = api.notifications.onNew((_event: unknown, error: unknown) => {
      if (!isDetectedError(error)) return;

      useStore.setState((state) => {
        if (state.notifications.some((notification) => notification.id === error.id)) {
          return {};
        }
        return {
          notifications: [error, ...state.notifications],
          notificationsOffset: state.notificationsOffset + 1,
        };
      });
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

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

  if (api.notifications?.onClicked) {
    const cleanup = api.notifications.onClicked((_event: unknown, data: unknown) => {
      if (!isDetectedError(data)) return;
      if (data.id && data.sessionId && data.projectId) {
        useStore.getState().navigateToError(data);
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }
}
