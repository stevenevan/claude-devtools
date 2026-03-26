/**
 * Tests for the tabSlice - tab management and navigation.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createTestStore } from './storeTestUtils';

import type { TestStore } from './storeTestUtils';

let store: TestStore;

beforeEach(() => {
  store = createTestStore();
});

describe('tabSlice', () => {
  describe('initial state', () => {
    it('starts with no open tabs', () => {
      const state = store.getState();
      expect(state.openTabs).toEqual([]);
      expect(state.activeTabId).toBeNull();
      expect(state.selectedTabIds).toEqual([]);
      expect(state.activeProjectId).toBeNull();
    });
  });

  describe('openTab', () => {
    it('opens a session tab in the focused pane', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const state = store.getState();
      expect(state.openTabs).toHaveLength(1);
      expect(state.openTabs[0].type).toBe('session');
      expect(state.openTabs[0].sessionId).toBe('s1');
      expect(state.activeTabId).toBe(state.openTabs[0].id);
    });

    it('deduplicates session tabs by sessionId', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1 Again',
      });

      expect(store.getState().openTabs).toHaveLength(1);
    });

    it('opens multiple different session tabs', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });

      const state = store.getState();
      expect(state.openTabs).toHaveLength(2);
      expect(state.activeTabId).toBe(state.openTabs[1].id);
    });

    it('replaces dashboard tab when opening session', () => {
      store.getState().openTab({
        type: 'dashboard',
        label: 'Dashboard',
      });
      const dashTabId = store.getState().openTabs[0].id;

      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const state = store.getState();
      expect(state.openTabs).toHaveLength(1);
      // The tab ID is reused when replacing
      expect(state.openTabs[0].id).toBe(dashTabId);
      expect(state.openTabs[0].type).toBe('session');
    });

    it('truncates long tab labels', () => {
      const longLabel = 'A'.repeat(200);
      store.getState().openTab({
        type: 'dashboard',
        label: longLabel,
      });

      const tab = store.getState().openTabs[0];
      expect(tab.label.length).toBeLessThan(200);
    });

    it('opens tab with forceNewTab even if duplicate sessionId', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab(
        {
          type: 'session',
          sessionId: 's1',
          projectId: 'p1',
          label: 'Session 1 Forced',
        },
        { forceNewTab: true }
      );

      expect(store.getState().openTabs).toHaveLength(2);
    });
  });

  describe('closeTab', () => {
    it('closes a tab and activates the next one', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's3',
        projectId: 'p1',
        label: 'Session 3',
      });

      const tab2Id = store.getState().openTabs[1].id;
      store.getState().closeTab(tab2Id);

      const state = store.getState();
      expect(state.openTabs).toHaveLength(2);
      expect(state.openTabs.find((t) => t.id === tab2Id)).toBeUndefined();
    });

    it('activates previous tab when closing last tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });

      const tab2Id = store.getState().openTabs[1].id;
      const tab1Id = store.getState().openTabs[0].id;

      // Make tab2 active (it should be already)
      expect(store.getState().activeTabId).toBe(tab2Id);

      store.getState().closeTab(tab2Id);
      expect(store.getState().activeTabId).toBe(tab1Id);
    });

    it('resets state when closing the last tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const tabId = store.getState().openTabs[0].id;
      store.getState().closeTab(tabId);

      const state = store.getState();
      expect(state.openTabs).toHaveLength(0);
      expect(state.activeTabId).toBeNull();
    });

    it('no-ops for non-existent tab', () => {
      store.getState().openTab({
        type: 'dashboard',
        label: 'Dashboard',
      });
      const before = store.getState().openTabs.length;
      store.getState().closeTab('non-existent');
      expect(store.getState().openTabs.length).toBe(before);
    });
  });

  describe('setActiveTab', () => {
    it('switches the active tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });

      const tab1Id = store.getState().openTabs[0].id;
      store.getState().setActiveTab(tab1Id);
      expect(store.getState().activeTabId).toBe(tab1Id);
    });

    it('no-ops for non-existent tab', () => {
      store.getState().openTab({
        type: 'dashboard',
        label: 'Dashboard',
      });
      const before = store.getState().activeTabId;
      store.getState().setActiveTab('non-existent');
      expect(store.getState().activeTabId).toBe(before);
    });
  });

  describe('getActiveTab', () => {
    it('returns null when no tabs are open', () => {
      expect(store.getState().getActiveTab()).toBeNull();
    });

    it('returns the active tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const tab = store.getState().getActiveTab();
      expect(tab).not.toBeNull();
      expect(tab?.sessionId).toBe('s1');
    });
  });

  describe('isSessionOpen', () => {
    it('returns false for unopened session', () => {
      expect(store.getState().isSessionOpen('s1')).toBe(false);
    });

    it('returns true for opened session', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      expect(store.getState().isSessionOpen('s1')).toBe(true);
    });
  });

  describe('openDashboard', () => {
    it('opens a projects tab', () => {
      store.getState().openDashboard();

      const state = store.getState();
      expect(state.openTabs).toHaveLength(1);
      expect(state.openTabs[0].type).toBe('projects');
      expect(state.activeActivity).toBe('projects');
    });
  });

  describe('tab navigation', () => {
    it('enqueues and consumes navigation requests', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const tabId = store.getState().openTabs[0].id;
      const request = {
        id: 'nav-1',
        kind: 'search' as const,
        source: 'commandPalette' as const,
        highlight: 'none' as const,
        payload: { query: 'test', messageTimestamp: 123, matchedText: 'test' },
      };

      store.getState().enqueueTabNavigation(tabId, request);
      expect(store.getState().openTabs[0].pendingNavigation?.id).toBe('nav-1');

      store.getState().consumeTabNavigation(tabId, 'nav-1');
      expect(store.getState().openTabs[0].pendingNavigation).toBeUndefined();
      expect(store.getState().openTabs[0].lastConsumedNavigationId).toBe('nav-1');
    });

    it('does not consume mismatched request id', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const tabId = store.getState().openTabs[0].id;
      const request = {
        id: 'nav-1',
        kind: 'search' as const,
        source: 'commandPalette' as const,
        highlight: 'none' as const,
        payload: { query: 'test', messageTimestamp: 123, matchedText: 'test' },
      };

      store.getState().enqueueTabNavigation(tabId, request);
      store.getState().consumeTabNavigation(tabId, 'nav-wrong');
      expect(store.getState().openTabs[0].pendingNavigation?.id).toBe('nav-1');
    });
  });

  describe('scroll position', () => {
    it('saves and preserves scroll position', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const tabId = store.getState().openTabs[0].id;
      store.getState().saveTabScrollPosition(tabId, 500);
      expect(store.getState().openTabs[0].savedScrollTop).toBe(500);
    });
  });

  describe('updateTabLabel', () => {
    it('updates the label of an existing tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Old Label',
      });

      const tabId = store.getState().openTabs[0].id;
      store.getState().updateTabLabel(tabId, 'New Label');
      expect(store.getState().openTabs[0].label).toBe('New Label');
    });
  });

  describe('context panel', () => {
    it('toggles context panel visibility per tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const tabId = store.getState().openTabs[0].id;
      store.getState().setTabContextPanelVisible(tabId, true);
      expect(store.getState().openTabs[0].showContextPanel).toBe(true);

      store.getState().setTabContextPanelVisible(tabId, false);
      expect(store.getState().openTabs[0].showContextPanel).toBe(false);
    });
  });

  describe('multi-select', () => {
    it('sets and clears selected tab IDs', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });

      const ids = store.getState().openTabs.map((t) => t.id);
      store.getState().setSelectedTabIds(ids);
      expect(store.getState().selectedTabIds).toEqual(ids);

      store.getState().clearTabSelection();
      expect(store.getState().selectedTabIds).toEqual([]);
    });
  });

  describe('closeOtherTabs', () => {
    it('closes all tabs except the specified one', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's3',
        projectId: 'p1',
        label: 'Session 3',
      });

      const keepTabId = store.getState().openTabs[1].id;
      store.getState().closeOtherTabs(keepTabId);

      const state = store.getState();
      expect(state.openTabs).toHaveLength(1);
      expect(state.openTabs[0].id).toBe(keepTabId);
      expect(state.activeTabId).toBe(keepTabId);
    });
  });

  describe('closeTabsToRight', () => {
    it('closes all tabs to the right of specified tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's3',
        projectId: 'p1',
        label: 'Session 3',
      });

      const tab1Id = store.getState().openTabs[0].id;
      store.getState().closeTabsToRight(tab1Id);

      const state = store.getState();
      expect(state.openTabs).toHaveLength(1);
      expect(state.openTabs[0].sessionId).toBe('s1');
    });
  });

  describe('closeAllTabs', () => {
    it('closes all tabs and resets state', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });

      store.getState().closeAllTabs();

      const state = store.getState();
      expect(state.openTabs).toHaveLength(0);
      expect(state.activeTabId).toBeNull();
      expect(state.selectedProjectId).toBeNull();
      expect(state.activeProjectId).toBeNull();
    });
  });

  describe('closeTabs (bulk)', () => {
    it('closes multiple tabs by ID', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's2',
        projectId: 'p1',
        label: 'Session 2',
      });
      store.getState().openTab({
        type: 'session',
        sessionId: 's3',
        projectId: 'p1',
        label: 'Session 3',
      });

      const tab1Id = store.getState().openTabs[0].id;
      const tab3Id = store.getState().openTabs[2].id;
      store.getState().closeTabs([tab1Id, tab3Id]);

      const state = store.getState();
      expect(state.openTabs).toHaveLength(1);
      expect(state.openTabs[0].sessionId).toBe('s2');
    });

    it('resets state when all tabs are closed via bulk', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 's1',
        projectId: 'p1',
        label: 'Session 1',
      });

      const tabId = store.getState().openTabs[0].id;
      store.getState().closeTabs([tabId]);

      expect(store.getState().openTabs).toHaveLength(0);
      expect(store.getState().activeTabId).toBeNull();
    });
  });

  describe('project context', () => {
    it('sets and clears active project', () => {
      store.getState().setActiveProject('p1');
      expect(store.getState().activeProjectId).toBe('p1');

      store.getState().clearActiveProject();
      expect(store.getState().activeProjectId).toBeNull();
      expect(store.getState().selectedProjectId).toBeNull();
    });
  });
});
