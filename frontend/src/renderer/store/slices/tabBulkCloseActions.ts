/**
 * Bulk tab close action bodies extracted from tabSlice.
 *
 * Exposed as functions that take the slice's `get`/`set` pair so they
 * remain compatible with Zustand's StateCreator wiring. Importing slice
 * code retrieves these and forwards them as method bodies.
 */
import {
  findPaneByTabId,
  getAllTabs,
  removePane as removePaneHelper,
  updatePane,
} from '../utils/paneHelpers';
import { syncFromLayout } from '../utils/paneLayoutMutations';
import { getFullResetState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type { PaneLayout } from '@renderer/types/panes';

type Get = () => AppState;
type Set = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  replace?: false
) => void;

export function closeOtherTabsAction(get: Get, set: Set, tabId: string): void {
  const state = get();
  const { paneLayout } = state;
  const pane = findPaneByTabId(paneLayout, tabId);
  if (!pane) return;

  const tabsToClose = pane.tabs.filter((t) => t.id !== tabId);
  for (const tab of tabsToClose) {
    state.cleanupTabUIState(tab.id);
  }

  const keepTab = pane.tabs.find((t) => t.id === tabId);
  if (!keepTab) return;

  const updatedPane = {
    ...pane,
    tabs: [keepTab],
    activeTabId: tabId,
    selectedTabIds: [],
  };
  const newLayout = updatePane(paneLayout, updatedPane);
  set(syncFromLayout(newLayout) as Partial<AppState>);
  get().setActiveTab(tabId);
}

export function closeTabsToRightAction(get: Get, set: Set, tabId: string): void {
  const state = get();
  const { paneLayout } = state;
  const pane = findPaneByTabId(paneLayout, tabId);
  if (!pane) return;

  const index = pane.tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return;

  const tabsToClose = pane.tabs.slice(index + 1);
  for (const tab of tabsToClose) {
    state.cleanupTabUIState(tab.id);
  }

  const newTabs = pane.tabs.slice(0, index + 1);
  const activeStillExists = newTabs.some((t) => t.id === pane.activeTabId);
  const newActiveId = activeStillExists ? pane.activeTabId : tabId;
  const updatedPane = {
    ...pane,
    tabs: newTabs,
    activeTabId: newActiveId,
    selectedTabIds: [],
  };
  const newLayout = updatePane(paneLayout, updatedPane);
  set(syncFromLayout(newLayout) as Partial<AppState>);
  if (newActiveId) {
    get().setActiveTab(newActiveId);
  }
}

export function closeAllTabsAction(get: Get, set: Set): void {
  const state = get();
  const allTabs = getAllTabs(state.paneLayout);
  for (const tab of allTabs) {
    state.cleanupTabUIState(tab.id);
    state.cleanupTabSessionData(tab.id);
  }

  const defaultPaneId = state.paneLayout.panes[0]?.id ?? 'pane-default';
  const newLayout: PaneLayout = {
    panes: [
      {
        id: defaultPaneId,
        tabs: [],
        activeTabId: null,
        selectedTabIds: [],
        widthFraction: 1,
      },
    ],
    focusedPaneId: defaultPaneId,
  };

  set({
    ...(syncFromLayout(newLayout) as Partial<AppState>),
    ...getFullResetState(),
  });
}

export function closeTabsAction(get: Get, set: Set, tabIds: string[]): void {
  const state = get();
  const idSet = new Set(tabIds);

  for (const id of idSet) {
    state.cleanupTabUIState(id);
    state.cleanupTabSessionData(id);
  }

  let { paneLayout } = state;
  const panesToRemove: string[] = [];

  for (const pane of paneLayout.panes) {
    const remainingTabs = pane.tabs.filter((t) => !idSet.has(t.id));

    if (remainingTabs.length === pane.tabs.length) continue;

    if (remainingTabs.length === 0 && paneLayout.panes.length > 1) {
      panesToRemove.push(pane.id);
      continue;
    }

    let newActiveId = pane.activeTabId;
    if (newActiveId && idSet.has(newActiveId)) {
      const oldIndex = pane.tabs.findIndex((t) => t.id === newActiveId);
      newActiveId = null;
      for (let i = oldIndex; i < pane.tabs.length; i++) {
        if (!idSet.has(pane.tabs[i].id)) {
          newActiveId = pane.tabs[i].id;
          break;
        }
      }
      if (!newActiveId) {
        for (let i = oldIndex - 1; i >= 0; i--) {
          if (!idSet.has(pane.tabs[i].id)) {
            newActiveId = pane.tabs[i].id;
            break;
          }
        }
      }
      newActiveId = newActiveId ?? remainingTabs[0]?.id ?? null;
    }

    paneLayout = updatePane(paneLayout, {
      ...pane,
      tabs: remainingTabs,
      activeTabId: newActiveId,
      selectedTabIds: pane.selectedTabIds.filter((id) => !idSet.has(id)),
    });
  }

  const allRemainingTabs = getAllTabs(paneLayout);
  if (allRemainingTabs.length === 0) {
    state.closeAllTabs();
    return;
  }

  for (const paneId of panesToRemove) {
    paneLayout = removePaneHelper(paneLayout, paneId);
  }

  set(syncFromLayout(paneLayout) as Partial<AppState>);

  const newActiveTabId = get().activeTabId;
  if (newActiveTabId) {
    get().setActiveTab(newActiveTabId);
  }
}
