import { buildDetailPopover } from './detailPopoverActions';
import {
  getExpandedDisplayItemIdsFromState,
  setAIGroupExpansionState,
  toggleAIGroupExpansionState,
  toggleDisplayItemExpansionState,
  toggleStepExpansionState,
} from './expansionActions';
import {
  runExpandForCurrentSearchResult,
  runHideSearch,
  runNextSearchResult,
  runPreviousSearchResult,
  runSelectSearchMatch,
  runSetSearchIsRegex,
  runSetSearchQuery,
  runSyncSearchMatchesWithRendered,
} from './searchActions';

import type { AppState } from '../../types';
import type { ActiveDetailItem, ConversationSlice } from './types';
import type { StateCreator } from 'zustand';

export type { ActiveDetailItem, ConversationSlice } from './types';

export const createConversationSlice: StateCreator<AppState, [], [], ConversationSlice> = (
  set,
  get
) => ({
  aiGroupExpansionLevels: new Map(),
  expandedStepIds: new Set(),
  expandedDisplayItemIds: new Map(),
  expandedAIGroupIds: new Set(),

  activeDetailItem: null,

  searchQuery: '',
  searchVisible: false,
  searchResultCount: 0,
  currentSearchIndex: -1,
  searchMatches: [],
  searchResultsCapped: false,
  searchMatchItemIds: new Set(),
  searchIsRegex: false,

  searchExpandedAIGroupIds: new Set(),
  searchExpandedSubagentIds: new Set(),
  searchCurrentDisplayItemId: null,
  searchCurrentSubagentItemId: null,

  setAIGroupExpansion: (aiGroupId, level) => set(setAIGroupExpansionState(get(), aiGroupId, level)),
  toggleStepExpansion: (stepId) => set(toggleStepExpansionState(get(), stepId)),
  toggleDisplayItemExpansion: (aiGroupId, itemId) =>
    set(toggleDisplayItemExpansionState(get(), aiGroupId, itemId)),
  getExpandedDisplayItemIds: (aiGroupId) => getExpandedDisplayItemIdsFromState(get(), aiGroupId),
  toggleAIGroupExpansion: (aiGroupId) => set(toggleAIGroupExpansionState(get(), aiGroupId)),

  showDetailPopover: (aiGroupId, itemId, type) =>
    set({ activeDetailItem: buildDetailPopover(aiGroupId, itemId, type) }),
  hideDetailPopover: () => set({ activeDetailItem: null as ActiveDetailItem | null }),

  setSearchQuery: (query, conversationOverride) =>
    runSetSearchQuery(get, set, query, conversationOverride),
  setSearchIsRegex: (isRegex) => runSetSearchIsRegex(get, set, isRegex),
  syncSearchMatchesWithRendered: (renderedMatches) =>
    runSyncSearchMatchesWithRendered(get, set, renderedMatches),
  selectSearchMatch: (itemId, matchIndexInItem) =>
    runSelectSearchMatch(get, set, itemId, matchIndexInItem),
  showSearch: () => set({ searchVisible: true }),
  hideSearch: () => runHideSearch(set),
  nextSearchResult: () => runNextSearchResult(get, set),
  previousSearchResult: () => runPreviousSearchResult(get, set),
  expandForCurrentSearchResult: () => runExpandForCurrentSearchResult(get, set),
});
