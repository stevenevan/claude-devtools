

import type { AppState } from '../types';
import type { Tab } from '@renderer/types/tabs';
import type { StateCreator } from 'zustand';

const MAX_COMPARE_COLUMNS = 5;

export interface ComparisonTabSlice {

  addCompareSession: (tabId: string, projectId: string, sessionId: string) => void;

  removeCompareSession: (tabId: string, sessionId: string) => void;
}

function updateTabInPane(state: AppState, tabId: string, updater: (tab: Tab) => Tab): AppState {
  const paneLayout = {
    ...state.paneLayout,
    panes: state.paneLayout.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
    })),
  };
  const openTabs = state.openTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  return { ...state, paneLayout, openTabs };
}

export const createComparisonTabSlice: StateCreator<AppState, [], [], ComparisonTabSlice> = (
  set,
  get
) => ({
  addCompareSession: (tabId, projectId, sessionId) => {
    const state = get();
    const tab = state.openTabs.find((t) => t.id === tabId);
    if (tab?.type !== 'comparison') return;
    // Skip duplicates vs. the base pair and any already-added extras.
    const alreadyCompared =
      tab.sessionId === sessionId ||
      tab.compareSessionId === sessionId ||
      (tab.extraCompareSessions ?? []).some((s) => s.sessionId === sessionId);
    if (alreadyCompared) return;

    const nextExtras = [...(tab.extraCompareSessions ?? []), { projectId, sessionId }];
    const totalColumns = 2 + nextExtras.length;
    if (totalColumns > MAX_COMPARE_COLUMNS) return;

    set(updateTabInPane(state, tabId, (t) => ({ ...t, extraCompareSessions: nextExtras })));
  },

  removeCompareSession: (tabId, sessionId) => {
    const state = get();
    const tab = state.openTabs.find((t) => t.id === tabId);
    if (tab?.type !== 'comparison') return;
    const existing = tab.extraCompareSessions ?? [];
    if (!existing.some((s) => s.sessionId === sessionId)) return;
    set(
      updateTabInPane(state, tabId, (t) => ({
        ...t,
        extraCompareSessions: existing.filter((s) => s.sessionId !== sessionId),
      }))
    );
  },
});
