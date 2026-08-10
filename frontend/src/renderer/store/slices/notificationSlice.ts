import { api } from '@renderer/api';
import { createErrorNavigationRequest, findTabBySessionAndProject } from '@renderer/types/tabs';
import { createLogger } from '@shared/utils/logger';

import { getAllTabs } from '../utils/paneHelpers';

import type { AppState } from '../types';
import type { DetectedError } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:notification');
const NOTIFICATIONS_FETCH_LIMIT = 200;
const NON_ADVANCING_PAGE_ERROR = 'Could not load earlier alerts because the server page did not advance.';

function compareNotifications(left: DetectedError, right: DetectedError): number {
  const rightTimestamp = Number.isFinite(right.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY;
  const leftTimestamp = Number.isFinite(left.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY;
  if (rightTimestamp > leftTimestamp) return 1;
  if (rightTimestamp < leftTimestamp) return -1;

  const rightCreatedAt = Number.isFinite(right.createdAt) ? right.createdAt : Number.NEGATIVE_INFINITY;
  const leftCreatedAt = Number.isFinite(left.createdAt) ? left.createdAt : Number.NEGATIVE_INFINITY;
  if (rightCreatedAt > leftCreatedAt) return 1;
  if (rightCreatedAt < leftCreatedAt) return -1;

  return left.id.localeCompare(right.id);
}

function mergeNotifications(
  current: readonly DetectedError[],
  incoming: readonly DetectedError[]
): DetectedError[] {
  const byId = new Map<string, DetectedError>();
  for (const notification of current) byId.set(notification.id, notification);
  for (const notification of incoming) byId.set(notification.id, notification);
  return Array.from(byId.values()).toSorted(compareNotifications);
}

function normalizeUnreadCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface NotificationSlice {
  notifications: DetectedError[];
  unreadCount: number;
  notificationsLoading: boolean;
  notificationsError: string | null;
  notificationsOffset: number;
  notificationsHasMore: boolean;
  notificationsLoadingMore: boolean;
  notificationsAppendError: string | null;

  fetchNotifications: () => Promise<void>;
  fetchMoreNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: (triggerName?: string) => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearNotifications: (triggerName?: string) => Promise<void>;
  navigateToError: (error: DetectedError) => void;
  openNotificationsTab: () => void;
}

export const createNotificationSlice: StateCreator<AppState, [], [], NotificationSlice> = (
  set,
  get
) => {
  let generation = 0;
  let initialRequest: Promise<void> | null = null;
  let appendRequest: Promise<void> | null = null;

  return {
    notifications: [],
    unreadCount: 0,
    notificationsLoading: false,
    notificationsError: null,
    notificationsOffset: 0,
    notificationsHasMore: false,
    notificationsLoadingMore: false,
    notificationsAppendError: null,

    fetchNotifications: () => {
      if (initialRequest) return initialRequest;

      const requestGeneration = ++generation;
      set({
        notificationsLoading: true,
        notificationsLoadingMore: false,
        notificationsError: null,
        notificationsAppendError: null,
      });
      const request = api.notifications
        .get({ limit: NOTIFICATIONS_FETCH_LIMIT, offset: 0 })
        .then((result) => {
          if (generation !== requestGeneration) return;

          set((state) => {
            const page = result.notifications ?? [];
            const pageIds = new Set(page.map((notification) => notification.id));
            const prependedCount = state.notifications.filter(
              (notification) => !pageIds.has(notification.id)
            ).length;
            const notifications = mergeNotifications(state.notifications, page);
            const unreadCount = normalizeUnreadCount(result.unreadCount);
            const pageOffset = page.length + prependedCount;
            const notificationsOffset = Math.max(state.notificationsOffset, pageOffset);
            return {
              notifications,
              unreadCount: unreadCount ?? notifications.filter((notification) => !notification.isRead).length,
              notificationsOffset,
              notificationsHasMore: Boolean(result.hasMore),
              notificationsLoading: false,
            };
          });
        })
        .catch((error: unknown) => {
          if (generation !== requestGeneration) return;
          const message = getErrorMessage(error, 'Failed to fetch notifications');
          logger.error('Failed to fetch notifications:', error);
          set({ notificationsLoading: false, notificationsError: message });
        })
        .finally(() => {
          if (initialRequest === request) initialRequest = null;
        });
      initialRequest = request;
      return request;
    },

    fetchMoreNotifications: () => {
      const state = get();
      if (state.notificationsLoading || !state.notificationsHasMore) return Promise.resolve();
      if (appendRequest) return appendRequest;

      const requestGeneration = generation;
      const requestedOffset = state.notificationsOffset;
      set({ notificationsLoadingMore: true, notificationsAppendError: null });
      const request = api.notifications
        .get({ limit: NOTIFICATIONS_FETCH_LIMIT, offset: requestedOffset })
        .then((result) => {
          if (generation !== requestGeneration) return;

          set((current) => {
            const page = result.notifications ?? [];
            const notifications = mergeNotifications(current.notifications, page);
            const nextOffset = current.notificationsOffset + page.length;
            if (page.length === 0 || notifications.length <= current.notifications.length) {
              return {
                notificationsLoadingMore: false,
                notificationsHasMore: false,
                notificationsAppendError: NON_ADVANCING_PAGE_ERROR,
              };
            }

            const unreadCount = normalizeUnreadCount(result.unreadCount);
            return {
              notifications,
              unreadCount: unreadCount ?? current.unreadCount,
              notificationsOffset: nextOffset,
              notificationsHasMore: Boolean(result.hasMore),
              notificationsLoadingMore: false,
              notificationsAppendError: null,
            };
          });
        })
        .catch((error: unknown) => {
          if (generation !== requestGeneration) return;
          const message = getErrorMessage(error, 'Failed to fetch earlier notifications');
          logger.error('Failed to fetch earlier notifications:', error);
          set({ notificationsLoadingMore: false, notificationsAppendError: message });
        })
        .finally(() => {
          if (appendRequest === request) appendRequest = null;
        });
      appendRequest = request;
      return request;
    },

    markNotificationRead: async (id: string) => {
      try {
        const success = await api.notifications.markRead(id);
        if (!success) {
          await get().fetchNotifications();
          return;
        }
        set((state) => {
          const notification = state.notifications.find((item) => item.id === id);
          const notifications = state.notifications.map((item) =>
            item.id === id ? { ...item, isRead: true } : item
          );
          const unreadCount =
            notification && !notification.isRead
              ? Math.max(0, state.unreadCount - 1)
              : state.unreadCount;
          return { notifications, unreadCount };
        });
      } catch (error) {
        logger.error('Failed to mark notification as read:', error);
      }
    },

    markAllNotificationsRead: async (triggerName?: string) => {
      try {
        if (triggerName !== undefined) {
          const { notifications } = get();
          const matching = notifications.filter((notification) => {
            const label = notification.triggerName ?? 'Other';
            return label === triggerName && !notification.isRead;
          });
          if (matching.length === 0) return;
          const results = await Promise.all(matching.map((notification) => api.notifications.markRead(notification.id)));
          if (results.some((result) => !result)) {
            await get().fetchNotifications();
            return;
          }
          const matchingIds = new Set(matching.map((notification) => notification.id));
          set((state) => {
            const updated = state.notifications.map((notification) =>
              matchingIds.has(notification.id) ? { ...notification, isRead: true } : notification
            );
            return {
              notifications: updated,
              unreadCount: Math.max(0, state.unreadCount - matching.length),
            };
          });
        } else {
          const success = await api.notifications.markAllRead();
          if (!success) {
            await get().fetchNotifications();
            return;
          }
          set((state) => ({
            notifications: state.notifications.map((notification) => ({ ...notification, isRead: true })),
            unreadCount: 0,
          }));
        }
      } catch (error) {
        logger.error('Failed to mark all notifications as read:', error);
      }
    },

    deleteNotification: async (id: string) => {
      try {
        const success = await api.notifications.delete(id);
        if (!success) {
          await get().fetchNotifications();
          return;
        }
        set((state) => {
          const deleted = state.notifications.find((notification) => notification.id === id);
          const notifications = state.notifications.filter((notification) => notification.id !== id);
          const unreadCount =
            deleted && !deleted.isRead ? Math.max(0, state.unreadCount - 1) : state.unreadCount;
          return {
            notifications,
            unreadCount,
            notificationsOffset: Math.max(0, state.notificationsOffset - 1),
          };
        });
      } catch (error) {
        logger.error('Failed to delete notification:', error);
      }
    },

    clearNotifications: async (triggerName?: string) => {
      try {
        if (triggerName !== undefined) {
          const { notifications } = get();
          const matching = notifications.filter((notification) => {
            const label = notification.triggerName ?? 'Other';
            return label === triggerName;
          });
          if (matching.length === 0) return;
          const results = await Promise.all(matching.map((notification) => api.notifications.delete(notification.id)));
          if (results.some((result) => !result)) {
            await get().fetchNotifications();
            return;
          }
          const matchingIds = new Set(matching.map((notification) => notification.id));
          set((state) => {
            const remaining = state.notifications.filter((notification) => !matchingIds.has(notification.id));
            const deletedUnread = matching.filter((notification) => !notification.isRead).length;
            return {
              notifications: remaining,
              unreadCount: Math.max(0, state.unreadCount - deletedUnread),
              notificationsOffset: Math.max(0, state.notificationsOffset - matching.length),
            };
          });
        } else {
          const success = await api.notifications.clear();
          if (!success) {
            await get().fetchNotifications();
            return;
          }
          set({
            notifications: [],
            unreadCount: 0,
            notificationsOffset: 0,
            notificationsHasMore: false,
            notificationsAppendError: null,
          });
        }
      } catch (error) {
        logger.error('Failed to clear notifications:', error);
      }
    },

    navigateToError: (error: DetectedError) => {
      const state = get();

      set({ activeActivity: 'projects' });

      void state.markNotificationRead(error.id);

      const navRequest = createErrorNavigationRequest(
        {
          errorId: error.id,
          errorTimestamp: error.timestamp,
          toolUseId: error.toolUseId,
          subagentId: error.subagentId,
          lineNumber: error.lineNumber,
        },
        'notification',
        error.triggerColor
      );

      const allTabs = getAllTabs(state.paneLayout);
      const existingTab = findTabBySessionAndProject(allTabs, error.sessionId, error.projectId);

      if (existingTab) {
        state.setActiveTab(existingTab.id);
        state.enqueueTabNavigation(existingTab.id, navRequest);
      } else {
        state.openTab({
          type: 'session',
          label: 'Loading...',
          projectId: error.projectId,
          sessionId: error.sessionId,
        });

        const newTabId = get().activeTabId;
        if (newTabId) {
          state.enqueueTabNavigation(newTabId, navRequest);
          get().setActiveTab(newTabId);
        }
      }
    },

    openNotificationsTab: () => {
      const state = get();

      const focusedPane = state.paneLayout.panes.find((pane) => pane.id === state.paneLayout.focusedPaneId);
      const notificationsTab = focusedPane?.tabs.find((tab) => tab.type === 'notifications');
      if (notificationsTab) {
        state.setActiveTab(notificationsTab.id);
        void state.fetchNotifications();
        return;
      }

      state.openTab({
        type: 'notifications',
        label: 'Notifications',
      });
    },
  };
};
