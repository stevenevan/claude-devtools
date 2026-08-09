import { MAX_PANES } from '@renderer/types/panes';
import { getEffectiveUIMode } from '@renderer/utils/uiModeBootstrap';

import {
  createEmptyPane,
  findPane,
  findPaneByTabId,
  getAllTabs,
  insertPane,
  removePane,
  syncFocusedPaneState,
  updatePane,
} from '../utils/paneHelpers';

import type { AppState } from '../types';
import type { PaneLayout } from '@renderer/types/panes';
import type { Tab } from '@renderer/types/tabs';
import type { StateCreator } from 'zustand';

export interface PaneSlice {
  paneLayout: PaneLayout;

  focusPane: (paneId: string) => void;
  splitPane: (sourcePaneId: string, tabId: string, direction: 'left' | 'right') => void;
  closePane: (paneId: string) => void;

  moveTabToPane: (
    tabId: string,
    sourcePaneId: string,
    targetPaneId: string,
    insertIndex?: number
  ) => void;
  moveTabToNewPane: (
    tabId: string,
    sourcePaneId: string,
    adjacentPaneId: string,
    direction: 'left' | 'right'
  ) => void;
  reorderTabInPane: (paneId: string, fromIndex: number, toIndex: number) => void;

  resizePanes: (paneId: string, newWidthFraction: number) => void;

  getPaneForTab: (tabId: string) => string | null;
  getAllPaneTabs: () => Tab[];
}

function syncRootState(layout: PaneLayout): Record<string, unknown> {
  const synced = syncFocusedPaneState(layout);
  return {
    paneLayout: layout,
    openTabs: synced.openTabs,
    activeTabId: synced.activeTabId,
    selectedTabIds: synced.selectedTabIds,
  };
}

export const createPaneSlice: StateCreator<AppState, [], [], PaneSlice> = (set, get) => ({
  paneLayout: {
    panes: [
      {
        id: 'pane-default',
        tabs: [],
        activeTabId: null,
        selectedTabIds: [],
        widthFraction: 1,
      },
    ],
    focusedPaneId: 'pane-default',
  },

  focusPane: (paneId: string) => {
    const state = get();
    const { paneLayout } = state;
    if (paneLayout.focusedPaneId === paneId) return;

    const pane = findPane(paneLayout, paneId);
    if (!pane) return;

    const newLayout: PaneLayout = { ...paneLayout, focusedPaneId: paneId };
    set(syncRootState(newLayout));

    if (pane.activeTabId) {
      get().setActiveTab(pane.activeTabId);
    }
  },

  splitPane: (sourcePaneId: string, tabId: string, direction: 'left' | 'right') => {
    const state = get();
    const { paneLayout } = state;

    if (getEffectiveUIMode(state.appConfig?.general.uiMode) === 'simple') return;
    if (paneLayout.panes.length >= MAX_PANES) return;

    const sourcePane = findPane(paneLayout, sourcePaneId);
    if (!sourcePane) return;

    const tab = sourcePane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const newSourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
    let newSourceActiveTabId = sourcePane.activeTabId;
    if (sourcePane.activeTabId === tabId) {
      const oldIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
      newSourceActiveTabId = newSourceTabs[oldIndex]?.id ?? newSourceTabs[oldIndex - 1]?.id ?? null;
    }

    const updatedSource = {
      ...sourcePane,
      tabs: newSourceTabs,
      activeTabId: newSourceActiveTabId,
      selectedTabIds: sourcePane.selectedTabIds.filter((id) => id !== tabId),
    };

    const newPaneId = crypto.randomUUID();
    const newPane = {
      ...createEmptyPane(newPaneId),
      tabs: [tab],
      activeTabId: tab.id,
    };

    let newLayout = updatePane(paneLayout, updatedSource);

    if (newSourceTabs.length === 0 && paneLayout.panes.length > 1) {
      newLayout = removePane(newLayout, sourcePaneId);
    }

    newLayout = insertPane(
      newLayout,
      updatedSource.id !== sourcePaneId ? paneLayout.panes[0].id : sourcePaneId,
      newPane,
      direction
    );
    newLayout = { ...newLayout, focusedPaneId: newPaneId };

    set(syncRootState(newLayout));

    if (tab.type === 'session') {
      get().setActiveTab(tab.id);
    }
  },

  closePane: (paneId: string) => {
    const state = get();
    const { paneLayout } = state;

    if (paneLayout.panes.length <= 1) return;

    const pane = findPane(paneLayout, paneId);
    if (!pane) return;

    for (const tab of pane.tabs) {
      state.cleanupTabUIState(tab.id);
    }

    const newLayout = removePane(paneLayout, paneId);
    set(syncRootState(newLayout));

    const focusedPane = findPane(newLayout, newLayout.focusedPaneId);
    if (focusedPane?.activeTabId) {
      get().setActiveTab(focusedPane.activeTabId);
    }
  },

  moveTabToPane: (
    tabId: string,
    sourcePaneId: string,
    targetPaneId: string,
    insertIndex?: number
  ) => {
    const state = get();
    const { paneLayout } = state;

    if (sourcePaneId === targetPaneId) return;

    const sourcePane = findPane(paneLayout, sourcePaneId);
    const targetPane = findPane(paneLayout, targetPaneId);
    if (!sourcePane || !targetPane) return;

    const tab = sourcePane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const newSourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
    let newSourceActiveTabId = sourcePane.activeTabId;
    if (sourcePane.activeTabId === tabId) {
      const oldIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
      newSourceActiveTabId = newSourceTabs[oldIndex]?.id ?? newSourceTabs[oldIndex - 1]?.id ?? null;
    }

    const newTargetTabs = [...targetPane.tabs];
    if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= newTargetTabs.length) {
      newTargetTabs.splice(insertIndex, 0, tab);
    } else {
      newTargetTabs.push(tab);
    }

    let newLayout = updatePane(paneLayout, {
      ...sourcePane,
      tabs: newSourceTabs,
      activeTabId: newSourceActiveTabId,
      selectedTabIds: sourcePane.selectedTabIds.filter((id) => id !== tabId),
    });
    newLayout = updatePane(newLayout, {
      ...targetPane,
      tabs: newTargetTabs,
      activeTabId: tab.id,
    });

    if (newSourceTabs.length === 0 && newLayout.panes.length > 1) {
      newLayout = removePane(newLayout, sourcePaneId);
    }

    newLayout = { ...newLayout, focusedPaneId: targetPaneId };

    set(syncRootState(newLayout));
  },

  moveTabToNewPane: (
    tabId: string,
    sourcePaneId: string,
    adjacentPaneId: string,
    direction: 'left' | 'right'
  ) => {
    const state = get();
    const { paneLayout } = state;

    if (getEffectiveUIMode(state.appConfig?.general.uiMode) === 'simple') return;
    if (paneLayout.panes.length >= MAX_PANES) return;

    const sourcePane = findPane(paneLayout, sourcePaneId);
    if (!sourcePane) return;

    const tab = sourcePane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const newSourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
    let newSourceActiveTabId = sourcePane.activeTabId;
    if (sourcePane.activeTabId === tabId) {
      const oldIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
      newSourceActiveTabId = newSourceTabs[oldIndex]?.id ?? newSourceTabs[oldIndex - 1]?.id ?? null;
    }

    const newPaneId = crypto.randomUUID();
    const newPane = {
      ...createEmptyPane(newPaneId),
      tabs: [tab],
      activeTabId: tab.id,
    };

    let newLayout = updatePane(paneLayout, {
      ...sourcePane,
      tabs: newSourceTabs,
      activeTabId: newSourceActiveTabId,
      selectedTabIds: sourcePane.selectedTabIds.filter((id) => id !== tabId),
    });

    if (newSourceTabs.length === 0 && newLayout.panes.length > 1) {
      newLayout = removePane(newLayout, sourcePaneId);
    }

    newLayout = insertPane(newLayout, adjacentPaneId, newPane, direction);
    newLayout = { ...newLayout, focusedPaneId: newPaneId };

    set(syncRootState(newLayout));
  },

  reorderTabInPane: (paneId: string, fromIndex: number, toIndex: number) => {
    const { paneLayout } = get();
    const pane = findPane(paneLayout, paneId);
    if (!pane) return;

    if (fromIndex < 0 || fromIndex >= pane.tabs.length) return;
    if (toIndex < 0 || toIndex >= pane.tabs.length) return;
    if (fromIndex === toIndex) return;

    const newTabs = [...pane.tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);

    const newLayout = updatePane(paneLayout, { ...pane, tabs: newTabs });
    set(syncRootState(newLayout));
  },

  resizePanes: (paneId: string, newWidthFraction: number) => {
    const { paneLayout } = get();
    const paneIndex = paneLayout.panes.findIndex((p) => p.id === paneId);
    if (paneIndex === -1 || paneIndex >= paneLayout.panes.length - 1) return;

    const MIN_FRACTION = 0.1;
    const clamped = Math.max(
      MIN_FRACTION,
      Math.min(1 - MIN_FRACTION * (paneLayout.panes.length - 1), newWidthFraction)
    );
    const currentPane = paneLayout.panes[paneIndex];
    const nextPane = paneLayout.panes[paneIndex + 1];
    const combinedWidth = currentPane.widthFraction + nextPane.widthFraction;
    const nextWidth = combinedWidth - clamped;

    if (nextWidth < MIN_FRACTION) return;

    const newPanes = paneLayout.panes.map((p, i) => {
      if (i === paneIndex) return { ...p, widthFraction: clamped };
      if (i === paneIndex + 1) return { ...p, widthFraction: nextWidth };
      return p;
    });

    set({ paneLayout: { ...paneLayout, panes: newPanes } });
  },

  getPaneForTab: (tabId: string) => {
    const pane = findPaneByTabId(get().paneLayout, tabId);
    return pane?.id ?? null;
  },

  getAllPaneTabs: () => {
    return getAllTabs(get().paneLayout);
  },
});
