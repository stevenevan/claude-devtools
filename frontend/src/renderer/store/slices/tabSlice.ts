

import {
  createSearchNavigationRequest,
  findTabBySession,
  findTabBySessionAndProject,
  truncateLabel,
} from '@renderer/types/tabs';

import { findPane, findPaneByTabId, getAllTabs, updatePane } from '../utils/paneHelpers';
import { syncFromLayout, updateTabInLayout } from '../utils/paneLayoutMutations';
import { getFullResetState } from '../utils/stateResetHelpers';

import {
  closeAllTabsAction,
  closeOtherTabsAction,
  closeTabsAction,
  closeTabsToRightAction,
} from './tabBulkCloseActions';
import { syncSidebarForSessionTab } from './tabSessionSync';

import type { AppState, SearchNavigationContext } from '../types';
import type { OpenTabOptions, Tab, TabInput, TabNavigationRequest } from '@renderer/types/tabs';
import type { StateCreator } from 'zustand';

export interface TabSlice {
  openTabs: Tab[];
  activeTabId: string | null;
  selectedTabIds: string[];

  // Actions
  openTab: (tab: TabInput, options?: OpenTabOptions) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  openDashboard: () => void;
  getActiveTab: () => Tab | null;
  isSessionOpen: (sessionId: string) => boolean;
  enqueueTabNavigation: (tabId: string, request: TabNavigationRequest) => void;
  consumeTabNavigation: (tabId: string, requestId: string) => void;
  saveTabScrollPosition: (tabId: string, scrollTop: number) => void;

  // Per-tab UI state actions
  setTabContextPanelVisible: (tabId: string, visible: boolean) => void;
  updateTabLabel: (tabId: string, label: string) => void;

  // Multi-select actions
  setSelectedTabIds: (ids: string[]) => void;
  clearTabSelection: () => void;

  // Bulk close actions
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeAllTabs: () => void;
  closeTabs: (tabIds: string[]) => void;

  // Navigation actions
  navigateToSession: (
    projectId: string,
    sessionId: string,
    fromSearch?: boolean,
    searchContext?: SearchNavigationContext
  ) => void;
}

export const createTabSlice: StateCreator<AppState, [], [], TabSlice> = (set, get) => ({
  openTabs: [],
  activeTabId: null,
  selectedTabIds: [],

  // Open a tab in the focused pane, or focus existing if sessionId matches
  openTab: (tab: TabInput, options?: OpenTabOptions) => {
    const state = get();
    const { paneLayout } = state;
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    if (tab.type === 'session' && tab.sessionId && !options?.forceNewTab) {
      const allTabs = getAllTabs(paneLayout);
      const existing = findTabBySession(allTabs, tab.sessionId);
      if (existing) {
        state.setActiveTab(existing.id);
        return;
      }

      const activeTab = focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId);
      if (activeTab && (options?.replaceActiveTab || activeTab.type === 'dashboard')) {
        if (activeTab.type === 'session') {
          state.cleanupTabUIState(activeTab.id);
          state.cleanupTabSessionData(activeTab.id);
        }

        const replacementTab: Tab = {
          ...tab,
          id: activeTab.id,
          label: truncateLabel(tab.label),
          createdAt: Date.now(),
        };

        const updatedPane = {
          ...focusedPane,
          tabs: focusedPane.tabs.map((t) => (t.id === activeTab.id ? replacementTab : t)),
          activeTabId: replacementTab.id,
        };
        const newLayout = updatePane(paneLayout, updatedPane);
        set(syncFromLayout(newLayout));
        return;
      }
    }

    const newTab: Tab = {
      ...tab,
      id: crypto.randomUUID(),
      label: truncateLabel(tab.label),
      createdAt: Date.now(),
    };

    const updatedPane = {
      ...focusedPane,
      tabs: [...focusedPane.tabs, newTab],
      activeTabId: newTab.id,
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  closeTab: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const index = pane.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    state.cleanupTabUIState(tabId);
    state.cleanupTabSessionData(tabId);

    const newTabs = pane.tabs.filter((t) => t.id !== tabId);

    let newActiveId = pane.activeTabId;
    if (pane.activeTabId === tabId) {
      newActiveId = newTabs[index]?.id ?? newTabs[index - 1]?.id ?? null;
    }

    if (newTabs.length === 0 && paneLayout.panes.length > 1) {
      state.closePane(pane.id);
      return;
    }

    const allOtherTabs = paneLayout.panes.filter((p) => p.id !== pane.id).flatMap((p) => p.tabs);
    if (newTabs.length === 0 && allOtherTabs.length === 0) {
      const updatedPane = { ...pane, tabs: [], activeTabId: null, selectedTabIds: [] };
      const newLayout = updatePane(paneLayout, updatedPane);
      set({
        ...syncFromLayout(newLayout),
        ...getFullResetState(),
      });
      return;
    }

    const updatedPane = {
      ...pane,
      tabs: newTabs,
      activeTabId: newActiveId,
      selectedTabIds: pane.selectedTabIds.filter((id) => id !== tabId),
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    if (newActiveId) {
      get().setActiveTab(newActiveId);
    }
  },

  setActiveTab: (tabId: string) => {
    const { paneLayout } = get();
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const updatedPane = { ...pane, activeTabId: tabId };
    let newLayout = updatePane(paneLayout, updatedPane);
    newLayout = { ...newLayout, focusedPaneId: pane.id };
    set(syncFromLayout(newLayout));

    syncSidebarForSessionTab(get, set, tab, tabId);
  },

  openDashboard: () => {
    const state = get();
    const { paneLayout } = state;
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    set({ activeActivity: 'projects' });

    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: 'projects',
      label: 'Projects',
      createdAt: Date.now(),
    };

    const updatedPane = {
      ...focusedPane,
      tabs: [...focusedPane.tabs, newTab],
      activeTabId: newTab.id,
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  getActiveTab: () => {
    const state = get();
    const focusedPane = findPane(state.paneLayout, state.paneLayout.focusedPaneId);
    if (!focusedPane?.activeTabId) return null;
    return focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? null;
  },

  isSessionOpen: (sessionId: string) => {
    const allTabs = getAllTabs(get().paneLayout);
    return allTabs.some((t) => t.type === 'session' && t.sessionId === sessionId);
  },

  enqueueTabNavigation: (tabId: string, request: TabNavigationRequest) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      pendingNavigation: request,
    }));
    set(syncFromLayout(newLayout));
  },

  consumeTabNavigation: (tabId: string, requestId: string) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) =>
      tab.pendingNavigation?.id === requestId
        ? { ...tab, pendingNavigation: undefined, lastConsumedNavigationId: requestId }
        : tab
    );
    set(syncFromLayout(newLayout));
  },

  saveTabScrollPosition: (tabId: string, scrollTop: number) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      savedScrollTop: scrollTop,
    }));
    set(syncFromLayout(newLayout));
  },

  updateTabLabel: (tabId: string, label: string) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      label,
    }));
    set(syncFromLayout(newLayout));
  },

  setTabContextPanelVisible: (tabId: string, visible: boolean) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      showContextPanel: visible,
    }));
    set(syncFromLayout(newLayout));
  },

  setSelectedTabIds: (ids: string[]) => {
    const { paneLayout } = get();
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    const updatedPane = { ...focusedPane, selectedTabIds: ids };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  clearTabSelection: () => {
    const { paneLayout } = get();
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    const updatedPane = { ...focusedPane, selectedTabIds: [] };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  closeOtherTabs: (tabId: string) => closeOtherTabsAction(get, set, tabId),
  closeTabsToRight: (tabId: string) => closeTabsToRightAction(get, set, tabId),
  closeAllTabs: () => closeAllTabsAction(get, set),
  closeTabs: (tabIds: string[]) => closeTabsAction(get, set, tabIds),

  navigateToSession: (
    projectId: string,
    sessionId: string,
    fromSearch = false,
    searchContext?: SearchNavigationContext
  ) => {
    const state = get();

    const allTabs = getAllTabs(state.paneLayout);
    const existingTab =
      findTabBySessionAndProject(allTabs, sessionId, projectId) ??
      findTabBySession(allTabs, sessionId);

    if (existingTab) {
      state.setActiveTab(existingTab.id);

      if (searchContext) {
        const navRequest = createSearchNavigationRequest({
          query: searchContext.query,
          messageTimestamp: searchContext.messageTimestamp,
          matchedText: searchContext.matchedText,
          ...(searchContext.targetGroupId !== undefined && {
            targetGroupId: searchContext.targetGroupId,
          }),
          ...(searchContext.targetMatchIndexInItem !== undefined && {
            targetMatchIndexInItem: searchContext.targetMatchIndexInItem,
          }),
          ...(searchContext.targetMatchStartOffset !== undefined && {
            targetMatchStartOffset: searchContext.targetMatchStartOffset,
          }),
          ...(searchContext.targetMessageUuid !== undefined && {
            targetMessageUuid: searchContext.targetMessageUuid,
          }),
        });
        state.enqueueTabNavigation(existingTab.id, navRequest);
      }
    } else {
      state.openTab({
        type: 'session',
        label: 'Loading...',
        projectId,
        sessionId,
        fromSearch,
      });

      if (searchContext) {
        const newState = get();
        const newTabId = newState.activeTabId;
        if (newTabId) {
          state.setActiveTab(newTabId);

          const navRequest = createSearchNavigationRequest({
            query: searchContext.query,
            messageTimestamp: searchContext.messageTimestamp,
            matchedText: searchContext.matchedText,
            ...(searchContext.targetGroupId !== undefined && {
              targetGroupId: searchContext.targetGroupId,
            }),
            ...(searchContext.targetMatchIndexInItem !== undefined && {
              targetMatchIndexInItem: searchContext.targetMatchIndexInItem,
            }),
            ...(searchContext.targetMatchStartOffset !== undefined && {
              targetMatchStartOffset: searchContext.targetMatchStartOffset,
            }),
            ...(searchContext.targetMessageUuid !== undefined && {
              targetMessageUuid: searchContext.targetMessageUuid,
            }),
          });
          state.enqueueTabNavigation(newTabId, navRequest);
        }
      }

      const newTabIdForFetch = get().activeTabId ?? undefined;
      void state.fetchSessionDetail(projectId, sessionId, newTabIdForFetch);
    }
  },
});
