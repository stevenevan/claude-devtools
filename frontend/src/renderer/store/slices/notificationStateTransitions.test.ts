import { afterEach, beforeEach, expect, test } from 'bun:test';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

import type { DetectedError } from '@renderer/types/data';
import type { NotificationsAPI } from '@shared/types/api';

type NotificationsResult = Awaited<ReturnType<NotificationsAPI['get']>>;

const NOW = new Date(2026, 7, 10, 12, 0, 0).getTime();
const originalNotifications = api.notifications;
const fallbackNotificationsApi: NotificationsAPI = {
  get: async () => {
    throw new Error('Missing notification test API');
  },
  markRead: async () => true,
  markAllRead: async () => true,
  delete: async () => true,
  clear: async () => true,
  getUnreadCount: async () => 0,
  onNew: () => () => undefined,
  onUpdated: () => () => undefined,
  onClicked: () => () => undefined,
  setNotificationPolicy: async () => [0, 0],
  raiseConfigDrift: async () => undefined,
};
const notificationsApi = originalNotifications ?? fallbackNotificationsApi;
api.notifications = notificationsApi;
const originalGet = notificationsApi.get;

function notification(index: number): DetectedError {
  return {
    id: `alert-${index}`,
    timestamp: NOW - index * 1_000,
    sessionId: `session-${index}`,
    projectId: 'project-1',
    filePath: `/Users/alice/project/session-${index}.jsonl`,
    source: 'error-detector',
    message: `Message ${index}`,
    isRead: true,
    createdAt: NOW - index * 1_000,
    context: { projectName: 'client-app' },
  };
}

function result(notifications: DetectedError[]): NotificationsResult {
  return {
    notifications,
    total: notifications.length,
    totalCount: notifications.length,
    unreadCount: 0,
    hasMore: false,
  };
}

function deferredResult(): {
  promise: Promise<NotificationsResult>;
  resolve: (value: NotificationsResult) => void;
  reject: (reason: Error) => void;
} {
  let resolve = (_value: NotificationsResult): void => {};
  let reject = (_reason: Error): void => {};
  const promise = new Promise<NotificationsResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let pending = deferredResult();

beforeEach(() => {
  pending = deferredResult();
  notificationsApi.get = () => pending.promise;
  useStore.setState(useStore.getInitialState(), true);
});

afterEach(() => {
  notificationsApi.get = originalGet;
  api.notifications = originalNotifications;
});

test('moves loading to error to retry to ready across notification fetches', async () => {
  const first = useStore.getState().fetchNotifications();
  expect(useStore.getState().notificationsLoading).toBe(true);
  expect(useStore.getState().notificationsError).toBeNull();

  pending.reject(new Error('reader unavailable'));
  await first;
  expect(useStore.getState().notificationsLoading).toBe(false);
  expect(useStore.getState().notificationsError).toBe('reader unavailable');

  pending = deferredResult();
  notificationsApi.get = () => pending.promise;
  const retry = useStore.getState().fetchNotifications();
  expect(useStore.getState().notificationsLoading).toBe(true);
  expect(useStore.getState().notificationsError).toBeNull();

  pending.resolve(result([notification(0)]));
  await retry;
  expect(useStore.getState().notificationsLoading).toBe(false);
  expect(useStore.getState().notificationsError).toBeNull();
  expect(useStore.getState().notifications.map((item) => item.id)).toEqual(['alert-0']);
});
