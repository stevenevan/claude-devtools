// IMPORTANT: subscribes to `tabUIStates` map directly (not getters) for proper reactivity.
// Getter function refs don't change when underlying state changes, so useMemo on them won't re-render.

import { useCallback, useMemo } from 'react';

import { useTabIdOptional } from '@renderer/contexts/useTabUIContext';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

interface UseTabUIReturn {
  tabId: string | null;
  isAIGroupExpanded: (aiGroupId: string) => boolean;
  toggleAIGroupExpansion: (aiGroupId: string) => void;
  expandAIGroup: (aiGroupId: string) => void;
  getExpandedDisplayItemIds: (aiGroupId: string) => Set<string>;
  toggleDisplayItemExpansion: (aiGroupId: string, itemId: string) => void;
  expandDisplayItem: (aiGroupId: string, itemId: string) => void;
  isSubagentTraceExpanded: (subagentId: string) => boolean;
  toggleSubagentTraceExpansion: (subagentId: string) => void;
  expandSubagentTrace: (subagentId: string) => void;
  isContextPanelVisible: boolean;
  setContextPanelVisible: (visible: boolean) => void;
  selectedContextPhase: number | null;
  setSelectedContextPhase: (phase: number | null) => void;
  savedScrollTop: number | undefined;
  saveScrollPosition: (scrollTop: number) => void;
  initializeTabUI: () => void;
}

export function useTabUI(): UseTabUIReturn {
  const tabId = useTabIdOptional();

  const tabUIStates = useStore((s) => s.tabUIStates);

  const tabState = useMemo(() => {
    if (!tabId) return null;
    return tabUIStates.get(tabId) ?? null;
  }, [tabId, tabUIStates]);

  const {
    toggleAIGroupExpansionForTab,
    expandAIGroupForTab,
    toggleDisplayItemExpansionForTab,
    expandDisplayItemForTab,
    toggleSubagentTraceExpansionForTab,
    expandSubagentTraceForTab,
    setContextPanelVisibleForTab,
    setSelectedContextPhaseForTab,
    saveScrollPositionForTab,
    initTabUIState,
  } = useStore(
    useShallow((s) => ({
      toggleAIGroupExpansionForTab: s.toggleAIGroupExpansionForTab,
      expandAIGroupForTab: s.expandAIGroupForTab,
      toggleDisplayItemExpansionForTab: s.toggleDisplayItemExpansionForTab,
      expandDisplayItemForTab: s.expandDisplayItemForTab,
      toggleSubagentTraceExpansionForTab: s.toggleSubagentTraceExpansionForTab,
      expandSubagentTraceForTab: s.expandSubagentTraceForTab,
      setContextPanelVisibleForTab: s.setContextPanelVisibleForTab,
      setSelectedContextPhaseForTab: s.setSelectedContextPhaseForTab,
      saveScrollPositionForTab: s.saveScrollPositionForTab,
      initTabUIState: s.initTabUIState,
    }))
  );

  const isAIGroupExpanded = useCallback(
    (aiGroupId: string): boolean => {
      return tabState?.expandedAIGroupIds.has(aiGroupId) ?? false;
    },
    [tabState]
  );

  const toggleAIGroupExpansion = useCallback(
    (aiGroupId: string): void => {
      if (!tabId) return;
      toggleAIGroupExpansionForTab(tabId, aiGroupId);
    },
    [tabId, toggleAIGroupExpansionForTab]
  );

  const expandAIGroup = useCallback(
    (aiGroupId: string): void => {
      if (!tabId) return;
      expandAIGroupForTab(tabId, aiGroupId);
    },
    [tabId, expandAIGroupForTab]
  );

  const getExpandedDisplayItemIds = useCallback(
    (aiGroupId: string): Set<string> => {
      return tabState?.expandedDisplayItemIds.get(aiGroupId) ?? new Set<string>();
    },
    [tabState]
  );

  const toggleDisplayItemExpansion = useCallback(
    (aiGroupId: string, itemId: string): void => {
      if (!tabId) return;
      toggleDisplayItemExpansionForTab(tabId, aiGroupId, itemId);
    },
    [tabId, toggleDisplayItemExpansionForTab]
  );

  const expandDisplayItem = useCallback(
    (aiGroupId: string, itemId: string): void => {
      if (!tabId) return;
      expandDisplayItemForTab(tabId, aiGroupId, itemId);
    },
    [tabId, expandDisplayItemForTab]
  );

  const isSubagentTraceExpanded = useCallback(
    (subagentId: string): boolean => {
      return tabState?.expandedSubagentTraceIds.has(subagentId) ?? false;
    },
    [tabState]
  );

  const toggleSubagentTraceExpansion = useCallback(
    (subagentId: string): void => {
      if (!tabId) return;
      toggleSubagentTraceExpansionForTab(tabId, subagentId);
    },
    [tabId, toggleSubagentTraceExpansionForTab]
  );

  const expandSubagentTrace = useCallback(
    (subagentId: string): void => {
      if (!tabId) return;
      expandSubagentTraceForTab(tabId, subagentId);
    },
    [tabId, expandSubagentTraceForTab]
  );

  const isContextPanelVisible = tabState?.showContextPanel ?? false;

  const setContextPanelVisible = useCallback(
    (visible: boolean): void => {
      if (!tabId) return;
      setContextPanelVisibleForTab(tabId, visible);
    },
    [tabId, setContextPanelVisibleForTab]
  );

  const selectedContextPhase = tabState?.selectedContextPhase ?? null;

  const setSelectedContextPhase = useCallback(
    (phase: number | null): void => {
      if (!tabId) return;
      setSelectedContextPhaseForTab(tabId, phase);
    },
    [tabId, setSelectedContextPhaseForTab]
  );

  const savedScrollTop = tabState?.savedScrollTop;

  const saveScrollPosition = useCallback(
    (scrollTop: number): void => {
      if (!tabId) return;
      saveScrollPositionForTab(tabId, scrollTop);
    },
    [tabId, saveScrollPositionForTab]
  );

  const initializeTabUI = useCallback((): void => {
    if (!tabId) return;
    initTabUIState(tabId);
  }, [tabId, initTabUIState]);

  return {
    tabId,
    isAIGroupExpanded,
    toggleAIGroupExpansion,
    expandAIGroup,
    getExpandedDisplayItemIds,
    toggleDisplayItemExpansion,
    expandDisplayItem,
    isSubagentTraceExpanded,
    toggleSubagentTraceExpansion,
    expandSubagentTrace,
    isContextPanelVisible,
    setContextPanelVisible,
    selectedContextPhase,
    setSelectedContextPhase,
    savedScrollTop,
    saveScrollPosition,
    initializeTabUI,
  };
}
