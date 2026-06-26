// Per-tab UI state is keyed by tabId, so the same session in two tabs gets independent state.

import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

export interface TabUIState {
  /** Which AI groups are expanded (by aiGroupId) */
  expandedAIGroupIds: Set<string>;

  /** Which display items within AI groups are expanded: Map<aiGroupId, Set<itemId>> */
  expandedDisplayItemIds: Map<string, Set<string>>;

  /** Which subagent traces are manually expanded (by subagentId) */
  expandedSubagentTraceIds: Set<string>;

  /** Whether the context panel is visible */
  showContextPanel: boolean;

  /** Selected context phase for filtering (null = current/latest phase) */
  selectedContextPhase: number | null;

  /** Saved scroll position for restoring when switching back to this tab */
  savedScrollTop?: number;

  /** Focused turn index for J/K navigation (-1 = none) */
  focusedTurnIndex: number;
}

function createDefaultTabUIState(): TabUIState {
  return {
    expandedAIGroupIds: new Set(),
    expandedDisplayItemIds: new Map(),
    expandedSubagentTraceIds: new Set(),
    showContextPanel: false,
    selectedContextPhase: null,
    savedScrollTop: undefined,
    focusedTurnIndex: -1,
  };
}

export interface TabUISlice {
  tabUIStates: Map<string, TabUIState>;

  initTabUIState: (tabId: string) => void;
  cleanupTabUIState: (tabId: string) => void;

  toggleAIGroupExpansionForTab: (tabId: string, aiGroupId: string) => void;
  isAIGroupExpandedForTab: (tabId: string, aiGroupId: string) => boolean;
  expandAIGroupForTab: (tabId: string, aiGroupId: string) => void;

  toggleDisplayItemExpansionForTab: (tabId: string, aiGroupId: string, itemId: string) => void;
  getExpandedDisplayItemIdsForTab: (tabId: string, aiGroupId: string) => Set<string>;
  expandDisplayItemForTab: (tabId: string, aiGroupId: string, itemId: string) => void;

  toggleSubagentTraceExpansionForTab: (tabId: string, subagentId: string) => void;
  expandSubagentTraceForTab: (tabId: string, subagentId: string) => void;
  isSubagentTraceExpandedForTab: (tabId: string, subagentId: string) => boolean;

  setContextPanelVisibleForTab: (tabId: string, visible: boolean) => void;
  isContextPanelVisibleForTab: (tabId: string) => boolean;

  setSelectedContextPhaseForTab: (tabId: string, phase: number | null) => void;

  saveScrollPositionForTab: (tabId: string, scrollTop: number) => void;
  getScrollPositionForTab: (tabId: string) => number | undefined;

  getFocusedTurnIndexForTab: (tabId: string) => number;
  setFocusedTurnIndexForTab: (tabId: string, index: number) => void;
}

export const createTabUISlice: StateCreator<AppState, [], [], TabUISlice> = (set, get) => ({
  tabUIStates: new Map<string, TabUIState>(),

  initTabUIState: (tabId: string) => {
    const state = get();
    if (state.tabUIStates.has(tabId)) return;

    const newMap = new Map(state.tabUIStates);
    newMap.set(tabId, createDefaultTabUIState());
    set({ tabUIStates: newMap });
  },

  cleanupTabUIState: (tabId: string) => {
    const state = get();
    if (!state.tabUIStates.has(tabId)) return;

    const newMap = new Map(state.tabUIStates);
    newMap.delete(tabId);
    set({ tabUIStates: newMap });
  },

  toggleAIGroupExpansionForTab: (tabId: string, aiGroupId: string) => {
    const state = get();
    const newMap = new Map(state.tabUIStates);
    const tabState = newMap.get(tabId) ?? createDefaultTabUIState();

    const newExpandedIds = new Set(tabState.expandedAIGroupIds);
    if (newExpandedIds.has(aiGroupId)) {
      newExpandedIds.delete(aiGroupId);
    } else {
      newExpandedIds.add(aiGroupId);
    }

    newMap.set(tabId, { ...tabState, expandedAIGroupIds: newExpandedIds });
    set({ tabUIStates: newMap });
  },

  isAIGroupExpandedForTab: (tabId: string, aiGroupId: string) => {
    const tabState = get().tabUIStates.get(tabId);
    return tabState?.expandedAIGroupIds.has(aiGroupId) ?? false;
  },

  expandAIGroupForTab: (tabId: string, aiGroupId: string) => {
    const state = get();
    const tabState = state.tabUIStates.get(tabId);
    if (tabState?.expandedAIGroupIds.has(aiGroupId)) return;

    const newMap = new Map(state.tabUIStates);
    const currentTabState = newMap.get(tabId) ?? createDefaultTabUIState();

    const newExpandedIds = new Set(currentTabState.expandedAIGroupIds);
    newExpandedIds.add(aiGroupId);

    newMap.set(tabId, { ...currentTabState, expandedAIGroupIds: newExpandedIds });
    set({ tabUIStates: newMap });
  },

  toggleDisplayItemExpansionForTab: (tabId: string, aiGroupId: string, itemId: string) => {
    const state = get();
    const newMap = new Map(state.tabUIStates);
    const tabState = newMap.get(tabId) ?? createDefaultTabUIState();

    const newDisplayItemMap = new Map(tabState.expandedDisplayItemIds);
    const currentSet = newDisplayItemMap.get(aiGroupId) ?? new Set<string>();
    const newSet = new Set(currentSet);

    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }

    newDisplayItemMap.set(aiGroupId, newSet);
    newMap.set(tabId, { ...tabState, expandedDisplayItemIds: newDisplayItemMap });
    set({ tabUIStates: newMap });
  },

  getExpandedDisplayItemIdsForTab: (tabId: string, aiGroupId: string) => {
    const tabState = get().tabUIStates.get(tabId);
    return tabState?.expandedDisplayItemIds.get(aiGroupId) ?? new Set<string>();
  },

  expandDisplayItemForTab: (tabId: string, aiGroupId: string, itemId: string) => {
    const state = get();
    const tabState = state.tabUIStates.get(tabId);
    const currentSet = tabState?.expandedDisplayItemIds.get(aiGroupId);
    if (currentSet?.has(itemId)) return;

    const newMap = new Map(state.tabUIStates);
    const currentTabState = newMap.get(tabId) ?? createDefaultTabUIState();

    const newDisplayItemMap = new Map(currentTabState.expandedDisplayItemIds);
    const newSet = new Set(newDisplayItemMap.get(aiGroupId) ?? new Set<string>());
    newSet.add(itemId);
    newDisplayItemMap.set(aiGroupId, newSet);

    newMap.set(tabId, { ...currentTabState, expandedDisplayItemIds: newDisplayItemMap });
    set({ tabUIStates: newMap });
  },

  toggleSubagentTraceExpansionForTab: (tabId: string, subagentId: string) => {
    const state = get();
    const newMap = new Map(state.tabUIStates);
    const tabState = newMap.get(tabId) ?? createDefaultTabUIState();

    const newExpandedIds = new Set(tabState.expandedSubagentTraceIds);
    if (newExpandedIds.has(subagentId)) {
      newExpandedIds.delete(subagentId);
    } else {
      newExpandedIds.add(subagentId);
    }

    newMap.set(tabId, { ...tabState, expandedSubagentTraceIds: newExpandedIds });
    set({ tabUIStates: newMap });
  },

  expandSubagentTraceForTab: (tabId: string, subagentId: string) => {
    const state = get();
    const tabState = state.tabUIStates.get(tabId) ?? createDefaultTabUIState();

    if (tabState.expandedSubagentTraceIds.has(subagentId)) return;

    const newExpandedIds = new Set(tabState.expandedSubagentTraceIds);
    newExpandedIds.add(subagentId);

    const newMap = new Map(state.tabUIStates);
    newMap.set(tabId, { ...tabState, expandedSubagentTraceIds: newExpandedIds });
    set({ tabUIStates: newMap });
  },

  isSubagentTraceExpandedForTab: (tabId: string, subagentId: string) => {
    const tabState = get().tabUIStates.get(tabId);
    return tabState?.expandedSubagentTraceIds.has(subagentId) ?? false;
  },

  setContextPanelVisibleForTab: (tabId: string, visible: boolean) => {
    const state = get();
    const newMap = new Map(state.tabUIStates);
    const tabState = newMap.get(tabId) ?? createDefaultTabUIState();

    newMap.set(tabId, { ...tabState, showContextPanel: visible });
    set({ tabUIStates: newMap });
  },

  isContextPanelVisibleForTab: (tabId: string) => {
    const tabState = get().tabUIStates.get(tabId);
    return tabState?.showContextPanel ?? false;
  },

  setSelectedContextPhaseForTab: (tabId: string, phase: number | null) => {
    const state = get();
    const newMap = new Map(state.tabUIStates);
    const tabState = newMap.get(tabId) ?? createDefaultTabUIState();
    newMap.set(tabId, { ...tabState, selectedContextPhase: phase });
    set({ tabUIStates: newMap });
  },

  saveScrollPositionForTab: (tabId: string, scrollTop: number) => {
    const state = get();
    const newMap = new Map(state.tabUIStates);
    const tabState = newMap.get(tabId) ?? createDefaultTabUIState();

    newMap.set(tabId, { ...tabState, savedScrollTop: scrollTop });
    set({ tabUIStates: newMap });
  },

  getScrollPositionForTab: (tabId: string) => {
    const tabState = get().tabUIStates.get(tabId);
    return tabState?.savedScrollTop;
  },

  getFocusedTurnIndexForTab: (tabId: string) => {
    return get().tabUIStates.get(tabId)?.focusedTurnIndex ?? -1;
  },

  setFocusedTurnIndexForTab: (tabId: string, index: number) => {
    const states = new Map(get().tabUIStates);
    const current = states.get(tabId) ?? createDefaultTabUIState();
    states.set(tabId, { ...current, focusedTurnIndex: index });
    set({ tabUIStates: states });
  },
});
