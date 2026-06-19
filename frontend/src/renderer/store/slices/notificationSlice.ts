import { api } from '@renderer/api';
import { createErrorNavigationRequest, findTabBySessionAndProject } from '@renderer/types/tabs';
import { createLogger } from '@shared/utils/logger';

import { getAllTabs } from '../utils/paneHelpers';

import type { AppState } from '../types';
import type { DetectedError } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:notification');
const NOTIFICATIONS_FETCH_LIMIT = 200;

export interface NotificationSlice {
  notifications: DetectedError[];
  unreadCount: number;
  notificationsLoading: boolean;
  notificationsError: string | null;

  fetchNotifications: () => Promise<void>;
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
) => ({
  notifications: [],
  unreadCount: 0,
  notificationsLoading: false,
  notificationsError: null,

  fetchNotifications: async () => {
    set({ notificationsLoading: true, notificationsError: null });
    try {
      // Fetch the full stored history (manager currently caps storage at 100).
      const result = await api.notifications.get({
        limit: NOTIFICATIONS_FETCH_LIMIT,
        offset: 0,
      });
      const notifications = result.notifications || [];
      const unreadCount =
        typeof result.unreadCount === 'number' && Number.isFinite(result.unreadCount)
          ? Math.max(0, Math.floor(result.unreadCount))
          : notifications.filter((n: { isRead: boolean }) => !n.isRead).length;
      set({
        notifications,
        unreadCount,
        notificationsLoading: false,
      });
    } catch (error) {
      set({
        notificationsError:
          error instanceof Error ? error.message : 'Failed to fetch notifications',
        notificationsLoading: false,
      });
    }
  },

  markNotificationRead: async (id: string) => {
    try {
      const success = await api.notifications.markRead(id);
      if (!success) {
        await get().fetchNotifications();
        return;
      }
      set((state) => {
        const notifications = state.notifications.map((n) =>
          n.id === id ? { ...n, isRead: true } : n
        );
        const unreadCount = notifications.filter((n) => !n.isRead).length;
        return { notifications, unreadCount };
      });
    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
    }
  },

  markAllNotificationsRead: async (triggerName?: string) => {
    try {
      if (triggerName !== undefined) {
        // Scoped: mark only matching unread notifications
        const { notifications } = get();
        const matching = notifications.filter((n) => {
          const label = n.triggerName ?? 'Other';
          return label === triggerName && !n.isRead;
        });
        if (matching.length === 0) return;
        const results = await Promise.all(matching.map((n) => api.notifications.markRead(n.id)));
        if (results.some((r) => !r)) {
          await get().fetchNotifications();
          return;
        }
        const matchingIds = new Set(matching.map((n) => n.id));
        set((state) => {
          const updated = state.notifications.map((n) =>
            matchingIds.has(n.id) ? { ...n, isRead: true } : n
          );
          return { notifications: updated, unreadCount: updated.filter((n) => !n.isRead).length };
        });
      } else {
        // Unscoped: mark all
        const success = await api.notifications.markAllRead();
        if (!success) {
          await get().fetchNotifications();
          return;
        }
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
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
        const notifications = state.notifications.filter((n) => n.id !== id);
        const unreadCount = notifications.filter((n) => !n.isRead).length;
        return { notifications, unreadCount };
      });
    } catch (error) {
      logger.error('Failed to delete notification:', error);
    }
  },

  clearNotifications: async (triggerName?: string) => {
    try {
      if (triggerName !== undefined) {
        // Scoped: delete only matching notifications
        const { notifications } = get();
        const matching = notifications.filter((n) => {
          const label = n.triggerName ?? 'Other';
          return label === triggerName;
        });
        if (matching.length === 0) return;
        const results = await Promise.all(matching.map((n) => api.notifications.delete(n.id)));
        if (results.some((r) => !r)) {
          await get().fetchNotifications();
          return;
        }
        const matchingIds = new Set(matching.map((n) => n.id));
        set((state) => {
          const remaining = state.notifications.filter((n) => !matchingIds.has(n.id));
          return {
            notifications: remaining,
            unreadCount: remaining.filter((n) => !n.isRead).length,
          };
        });
      } else {
        // Unscoped: clear all
        const success = await api.notifications.clear();
        if (!success) {
          await get().fetchNotifications();
          return;
        }
        set({
          notifications: [],
          unreadCount: 0,
        });
      }
    } catch (error) {
      logger.error('Failed to clear notifications:', error);
    }
  },

  navigateToError: (error: DetectedError) => {
    const state = get();

    // Switch away from global activity (e.g. notifications) so session tab is visible
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

    const focusedPane = state.paneLayout.panes.find((p) => p.id === state.paneLayout.focusedPaneId);
    const notificationsTab = focusedPane?.tabs.find((t) => t.type === 'notifications');
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
});
