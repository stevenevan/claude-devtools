/**
 * Notification slice tests — initial state and synchronous behavior.
 * Async actions (fetchNotifications, markRead, etc.) require API mocking,
 * tested separately.
 */

import { describe, expect, it } from 'vitest';

import { createTestStore } from './storeTestUtils';

describe('notificationSlice', () => {
  describe('initial state', () => {
    it('starts with empty notifications', () => {
      const store = createTestStore();
      const state = store.getState();
      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
      expect(state.notificationsLoading).toBe(false);
      expect(state.notificationsError).toBeNull();
    });
  });

  describe('openNotificationsTab', () => {
    it('creates a notifications tab when none exists', () => {
      const store = createTestStore();
      store.getState().openNotificationsTab();
      const state = store.getState();
      const pane = state.paneLayout.panes.find((p) => p.id === state.paneLayout.focusedPaneId);
      const notifTab = pane?.tabs.find((t) => t.type === 'notifications');
      expect(notifTab).toBeDefined();
      expect(notifTab!.label).toBe('Notifications');
    });

    it('focuses existing notifications tab if already open', () => {
      const store = createTestStore();
      // Open notifications tab
      store.getState().openNotificationsTab();
      const firstTabId = store.getState().activeTabId;

      // Open another tab
      store.getState().openTab({ type: 'dashboard', label: 'Dashboard' });
      expect(store.getState().activeTabId).not.toBe(firstTabId);

      // Re-open notifications should focus the existing one
      store.getState().openNotificationsTab();
      expect(store.getState().activeTabId).toBe(firstTabId);
    });
  });
});
