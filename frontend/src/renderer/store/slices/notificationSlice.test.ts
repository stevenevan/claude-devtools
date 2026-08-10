import { afterEach, beforeEach, expect, test } from 'bun:test';

import { api } from '@renderer/api';
import { attachNotificationListeners } from '@renderer/store/listeners/notifications';
import { useStore } from '@renderer/store';

import type { DetectedError } from '@renderer/types/data';
import type { ListenerContext } from '@renderer/store/listeners/types';
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
const originalOnNew = notificationsApi.onNew;
const originalOnUpdated = notificationsApi.onUpdated;
const originalOnClicked = notificationsApi.onClicked;

function notification(index: number, overrides: Partial<DetectedError> = {}): DetectedError {
  return {
    id: `alert-${index}`,
    timestamp: NOW - index * 1_000,
    sessionId: `session-${index}`,
    projectId: 'project-1',
    filePath: `/Users/alice/project/session-${index}.jsonl`,
    source: 'error-detector',
    message: `Message ${index}`,
    isRead: index % 2 === 0,
    createdAt: NOW - index * 1_000,
    context: { projectName: 'client-app' },
    ...overrides,
  };
}

function result(
  notifications: DetectedError[],
  unreadCount: number,
  hasMore: boolean
): NotificationsResult {
  return {
    notifications,
    total: notifications.length,
    totalCount: notifications.length,
    unreadCount,
    hasMore,
  };
}

function listenerContext(): ListenerContext {
  return {
    cleanupFns: [],
    pendingSessionRefreshTimers: new Map(),
    pendingProjectRefreshTimers: new Map(),
    sessionLastActivityAt: new Map(),
    scheduleSessionRefresh: () => undefined,
    scheduleProjectRefresh: () => undefined,
    markSessionOngoing: () => undefined,
    isSessionVisibleInAnyPane: () => false,
    getBaseProjectId: (projectId) => projectId ?? null,
  };
}

beforeEach(() => {
  api.notifications = notificationsApi;
  useStore.setState(useStore.getInitialState(), true);
});

afterEach(() => {
  notificationsApi.get = originalGet;
  notificationsApi.onNew = originalOnNew;
  notificationsApi.onUpdated = originalOnUpdated;
  notificationsApi.onClicked = originalOnClicked;
  api.notifications = originalNotifications;
});

test('fetches recent and earlier pages, deduplicates IDs, and preserves server unread counts', async () => {
  const recent = [notification(0), notification(1)];
  const earlier = [notification(1), notification(2), notification(3)];
  const calls: number[] = [];
  notificationsApi.get = async (options) => {
    const offset = options?.offset ?? 0;
    calls.push(offset);
    return offset === 0 ? result(recent, 41, true) : result(earlier, 39, false);
  };

  await useStore.getState().fetchNotifications();
  expect(useStore.getState().notifications.map((item) => item.id)).toEqual(['alert-0', 'alert-1']);
  expect(useStore.getState().notificationsOffset).toBe(2);
  expect(useStore.getState().notificationsHasMore).toBe(true);
  expect(useStore.getState().unreadCount).toBe(41);

  await useStore.getState().fetchMoreNotifications();
  expect(calls).toEqual([0, 2]);
  expect(useStore.getState().notifications.map((item) => item.id)).toEqual([
    'alert-0',
    'alert-1',
    'alert-2',
    'alert-3',
  ]);
  expect(useStore.getState().notificationsOffset).toBe(5);
  expect(useStore.getState().notificationsHasMore).toBe(false);
  expect(useStore.getState().unreadCount).toBe(39);
});

test('stops requesting when an append page does not advance', async () => {
  const recent = [notification(0)];
  let calls = 0;
  notificationsApi.get = async () => {
    calls++;
    return calls === 1 ? result(recent, 5, true) : result(recent, 5, true);
  };

  await useStore.getState().fetchNotifications();
  await useStore.getState().fetchMoreNotifications();
  await useStore.getState().fetchMoreNotifications();

  expect(calls).toBe(2);
  expect(useStore.getState().notificationsHasMore).toBe(false);
  expect(useStore.getState().notificationsAppendError).toContain('did not advance');
  expect(useStore.getState().notificationsLoadingMore).toBe(false);
});

test('keeps initial and append failures in separate fields', async () => {
  notificationsApi.get = async () => {
    throw new Error('initial network down');
  };

  await useStore.getState().fetchNotifications();
  expect(useStore.getState().notificationsError).toBe('initial network down');
  expect(useStore.getState().notificationsAppendError).toBeNull();

  let call = 0;
  notificationsApi.get = async () => {
    call++;
    if (call === 1) return result([notification(0)], 4, true);
    throw new Error('append network down');
  };

  await useStore.getState().fetchNotifications();
  await useStore.getState().fetchMoreNotifications();
  expect(useStore.getState().notificationsError).toBeNull();
  expect(useStore.getState().notificationsAppendError).toBe('append network down');
  expect(useStore.getState().notificationsHasMore).toBe(true);
  expect(useStore.getState().notificationsLoadingMore).toBe(false);
});

test('keeps more than 200 records when live records prepend and advances after the live record', async () => {
  const recent = Array.from({ length: 200 }, (_, index) => notification(index));
  const earlier = [notification(200)];
  let newListener: (event: unknown, error: unknown) => void = () => undefined;
  let updatedListener: (
    event: unknown,
    payload: { total: number; unreadCount: number }
  ) => void = () => undefined;
  const offsets: number[] = [];
  notificationsApi.get = async (options) => {
    const offset = options?.offset ?? 0;
    offsets.push(offset);
    return offset === 0 ? result(recent, 77, true) : result(earlier, 76, false);
  };
  notificationsApi.onNew = (callback) => {
    newListener = callback;
    return () => undefined;
  };
  notificationsApi.onUpdated = (callback) => {
    updatedListener = callback;
    return () => undefined;
  };
  notificationsApi.onClicked = () => () => undefined;

  attachNotificationListeners(listenerContext());
  await useStore.getState().fetchNotifications();
  const live = notification(999, {
    id: 'live-alert',
    timestamp: NOW + 1_000,
    createdAt: NOW + 1_000,
    isRead: false,
  });
  newListener({}, live);

  expect(useStore.getState().notifications).toHaveLength(201);
  expect(useStore.getState().notifications[0]?.id).toBe('live-alert');
  expect(useStore.getState().notificationsOffset).toBe(201);
  expect(useStore.getState().unreadCount).toBe(77);

  updatedListener({}, { total: 201, unreadCount: 123 });
  expect(useStore.getState().unreadCount).toBe(123);

  await useStore.getState().fetchMoreNotifications();
  expect(offsets).toEqual([0, 201]);
  expect(useStore.getState().notifications).toHaveLength(202);
  expect(useStore.getState().notifications.map((item) => item.id)).toContain('alert-200');
  expect(useStore.getState().notificationsOffset).toBe(202);
  expect(useStore.getState().unreadCount).toBe(76);
});
