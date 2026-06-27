import { useCallback, useEffect, useRef } from 'react';

import type { AIGroupDisplayItem } from '@renderer/types/groups';

interface UseAIGroupExpansionParams {
  aiGroupId: string;
  displayItems: AIGroupDisplayItem[];
  highlightToolUseId: string | undefined;
  containsHighlightedError: boolean;
  shouldExpandForSearch: boolean;
  searchCurrentDisplayItemId: string | null;
  searchExpandedSubagentIds: Set<string>;
  expandDisplayItem: (aiGroupId: string, itemId: string) => void;
}

export function useAIGroupExpansion({
  aiGroupId,
  displayItems,
  highlightToolUseId,
  containsHighlightedError,
  shouldExpandForSearch,
  searchCurrentDisplayItemId,
  searchExpandedSubagentIds,
  expandDisplayItem,
}: UseAIGroupExpansionParams): void {
  // Helper function to find the item ID containing the highlighted tool
  // ponytail: useCallback required — in useEffect dep array
  const findHighlightedItemId = useCallback(
    (toolUseId: string): string | null => {
      for (let i = 0; i < displayItems.length; i++) {
        const item = displayItems[i];
        if (item.type === 'tool' && item.tool.id === toolUseId) {
          return `tool-${item.tool.id}-${i}`;
        }
        // For subagents, expand the subagent item
        if (item.type === 'subagent' && item.subagent.messages) {
          for (const msg of item.subagent.messages) {
            if (
              msg.toolCalls?.some((tc) => tc.id === toolUseId) ||
              msg.toolResults?.some((tr) => tr.toolUseId === toolUseId)
            ) {
              return `subagent-${item.subagent.id}-${i}`;
            }
          }
        }
      }
      return null;
    },
    [displayItems]
  );

  // Track which highlightToolUseId we've already processed to prevent infinite loops
  const processedHighlightRef = useRef<string | null>(null);

  // Effect to auto-expand display item when highlightToolUseId is set
  // AI group expansion is now handled by the navigation coordinator
  // This only handles display item expansion which requires enhanced data
  useEffect(() => {
    if (!highlightToolUseId || !containsHighlightedError) {
      // Reset ref when highlight is cleared
      if (!highlightToolUseId) {
        processedHighlightRef.current = null;
      }
      return;
    }

    // Skip if we've already processed this exact highlight
    if (processedHighlightRef.current === highlightToolUseId) {
      return;
    }

    // Mark as processed BEFORE making any state changes
    processedHighlightRef.current = highlightToolUseId;

    // Find and expand the display item containing the highlighted tool
    // No delay needed - navigation coordinator ensures DOM is stable before highlight
    const itemId = findHighlightedItemId(highlightToolUseId);
    if (itemId) {
      expandDisplayItem(aiGroupId, itemId);
    }
  }, [
    highlightToolUseId,
    containsHighlightedError,
    aiGroupId,
    expandDisplayItem,
    findHighlightedItemId,
  ]);

  // Track which search we've already processed to prevent infinite loops
  const processedSearchRef = useRef<string | null>(null);

  // Effect to auto-expand display items when search navigates to this group
  // Note: AI group expansion is handled by derived isExpanded (shouldExpandForSearch)
  useEffect(() => {
    if (!shouldExpandForSearch) {
      processedSearchRef.current = null;
      return;
    }

    // Create a unique key for this search state
    const searchKey = `${searchCurrentDisplayItemId ?? ''}-${Array.from(searchExpandedSubagentIds).join(',')}`;
    if (processedSearchRef.current === searchKey) {
      return;
    }
    processedSearchRef.current = searchKey;

    // Expand the specific display item containing the search result (uses per-tab state)
    if (searchCurrentDisplayItemId) {
      expandDisplayItem(aiGroupId, searchCurrentDisplayItemId);
    }

    // If any subagents in this group need their trace expanded for search, expand them
    for (let i = 0; i < displayItems.length; i++) {
      const item = displayItems[i];
      if (item.type === 'subagent' && searchExpandedSubagentIds.has(item.subagent.id)) {
        const subagentItemId = `subagent-${item.subagent.id}-${i}`;
        expandDisplayItem(aiGroupId, subagentItemId);
      }
    }
  }, [
    shouldExpandForSearch,
    searchCurrentDisplayItemId,
    searchExpandedSubagentIds,
    displayItems,
    aiGroupId,
    expandDisplayItem,
  ]);
}
