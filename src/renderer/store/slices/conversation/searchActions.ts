import { api } from '@renderer/api';
import { logger } from '@renderer/lib/logger';

import {
  MAX_SEARCH_MATCHES,
  RUST_SEARCH_THRESHOLD,
  bumpSearchId,
  currentSearchId,
  isSearchDebugEnabled,
  mapRustMatchesToStoreMatches,
  performJsSearch,
} from './searchInternals';

import type { AppState, SearchMatch } from '../../types';
import type { SessionConversation } from '@renderer/types/groups';

type Get = () => AppState;
type Set = (
  partial:
    | Partial<AppState>
    | ((state: AppState) => Partial<AppState>)
) => void;

export function runSetSearchQuery(
  get: Get,
  set: Set,
  query: string,
  conversationOverride?: SessionConversation | null
): void {
  const conversation = conversationOverride ?? get().conversation;

  if (!query.trim() || !conversation) {
    if (isSearchDebugEnabled()) {
      console.info('[search] clear', { query });
    }
    set({
      searchQuery: query,
      searchResultCount: 0,
      currentSearchIndex: -1,
      searchMatches: [],
      searchResultsCapped: false,
      searchMatchItemIds: new Set(),
      searchCurrentDisplayItemId: null,
      searchCurrentSubagentItemId: null,
    });
    return;
  }

  const { searchIsRegex } = get();

  const shouldUseRust = conversation.items.length > RUST_SEARCH_THRESHOLD;

  if (shouldUseRust) {
    const state = get();
    const projectId = state.selectedProjectId;
    const sessionId = state.selectedSessionId;

    if (!projectId || !sessionId) {
      performJsSearch(query, conversation, searchIsRegex, set);
      return;
    }

    set({ searchQuery: query });

    const requestId = bumpSearchId();

    api
      .searchSessionContent(
        projectId,
        sessionId,
        query,
        searchIsRegex,
        false,
        undefined,
        MAX_SEARCH_MATCHES
      )
      .then((result) => {
        if (requestId !== currentSearchId()) return;

        const matches = mapRustMatchesToStoreMatches(result.matches);
        const matchItemIds = new Set<string>();
        for (const match of matches) {
          matchItemIds.add(match.itemId);
        }

        if (isSearchDebugEnabled()) {
          console.info('[search] rust', {
            query,
            total: result.totalMatches,
            returned: matches.length,
            hasMore: result.hasMore,
            chunksSearched: result.chunksSearched,
          });
        }

        set({
          searchResultCount: matches.length,
          currentSearchIndex: matches.length > 0 ? 0 : -1,
          searchMatches: matches,
          searchResultsCapped: result.hasMore,
          searchMatchItemIds: matchItemIds,
        });
      })
      .catch((err) => {
        if (requestId !== currentSearchId()) return;
        logger.error('Rust search failed, falling back to JS', { error: String(err) });
        performJsSearch(query, conversation, searchIsRegex, set);
      });
    return;
  }

  performJsSearch(query, conversation, searchIsRegex, set);
}

export function runSetSearchIsRegex(get: Get, set: Set, isRegex: boolean): void {
  set({ searchIsRegex: isRegex });
  const state = get();
  if (state.searchQuery.trim()) {
    state.setSearchQuery(state.searchQuery);
  }
}

export function runSyncSearchMatchesWithRendered(
  get: Get,
  set: Set,
  renderedMatches: { itemId: string; matchIndexInItem: number }[]
): void {
  const state = get();
  if (!state.searchQuery.trim()) return;

  const dedupedRendered: { itemId: string; matchIndexInItem: number }[] = [];
  const seen = new Set<string>();
  for (const rendered of renderedMatches) {
    const key = `${rendered.itemId}:${rendered.matchIndexInItem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedRendered.push(rendered);
  }

  const oldMatches = state.searchMatches;
  const sameLength = oldMatches.length === dedupedRendered.length;
  const sameContent =
    sameLength &&
    oldMatches.every(
      (match, index) =>
        match.itemId === dedupedRendered[index]?.itemId &&
        match.matchIndexInItem === dedupedRendered[index]?.matchIndexInItem
    );
  if (sameContent) return;

  const oldMatchMap = new Map<string, SearchMatch>();
  for (const match of oldMatches) {
    oldMatchMap.set(`${match.itemId}:${match.matchIndexInItem}`, match);
  }

  const nextMatches: SearchMatch[] = dedupedRendered.map((rendered, index) => {
    const key = `${rendered.itemId}:${rendered.matchIndexInItem}`;
    const previous = oldMatchMap.get(key);
    const inferredItemType = rendered.itemId.startsWith('user-') ? 'user' : 'ai';
    return {
      itemId: rendered.itemId,
      itemType: previous?.itemType ?? inferredItemType,
      matchIndexInItem: rendered.matchIndexInItem,
      globalIndex: index,
      displayItemId: previous?.displayItemId,
    };
  });

  const oldCurrentMatch =
    state.currentSearchIndex >= 0 ? oldMatches[state.currentSearchIndex] : undefined;
  let newCurrentIndex = -1;
  if (oldCurrentMatch) {
    newCurrentIndex = nextMatches.findIndex(
      (match) =>
        match.itemId === oldCurrentMatch.itemId &&
        match.matchIndexInItem === oldCurrentMatch.matchIndexInItem
    );
  }

  if (newCurrentIndex < 0) {
    if (nextMatches.length === 0) {
      newCurrentIndex = -1;
    } else if (state.currentSearchIndex < 0) {
      newCurrentIndex = 0;
    } else {
      newCurrentIndex = Math.min(state.currentSearchIndex, nextMatches.length - 1);
    }
  }

  if (isSearchDebugEnabled()) {
    console.info('[search] sync-rendered', {
      parsedCount: oldMatches.length,
      renderedCount: nextMatches.length,
      currentBefore: state.currentSearchIndex,
      currentAfter: newCurrentIndex,
    });
  }

  set({
    searchMatches: nextMatches,
    searchResultCount: nextMatches.length,
    currentSearchIndex: newCurrentIndex,
  });
}

export function runSelectSearchMatch(
  get: Get,
  set: Set,
  itemId: string,
  matchIndexInItem: number
): boolean {
  const state = get();
  const targetIndex = state.searchMatches.findIndex(
    (match) => match.itemId === itemId && match.matchIndexInItem === matchIndexInItem
  );

  if (targetIndex < 0) {
    return false;
  }

  set({ currentSearchIndex: targetIndex });
  get().expandForCurrentSearchResult();
  return true;
}

export function runHideSearch(set: Set): void {
  bumpSearchId();
  set({
    searchVisible: false,
    searchQuery: '',
    searchResultCount: 0,
    currentSearchIndex: -1,
    searchMatches: [],
    searchResultsCapped: false,
    searchMatchItemIds: new Set(),
    searchExpandedAIGroupIds: new Set(),
    searchExpandedSubagentIds: new Set(),
    searchCurrentDisplayItemId: null,
    searchCurrentSubagentItemId: null,
  });
}

export function runNextSearchResult(get: Get, set: Set): void {
  const state = get();
  if (state.searchResultCount > 0) {
    const nextIndex = (state.currentSearchIndex + 1) % state.searchResultCount;
    set({ currentSearchIndex: nextIndex });
    get().expandForCurrentSearchResult();
    if (isSearchDebugEnabled()) {
      const match = get().searchMatches[nextIndex];
      console.info('[search] next', {
        index: nextIndex,
        itemId: match?.itemId,
        matchIndexInItem: match?.matchIndexInItem,
      });
    }
  }
}

export function runPreviousSearchResult(get: Get, set: Set): void {
  const state = get();
  if (state.searchResultCount > 0) {
    const prevIndex = state.currentSearchIndex - 1;
    const newIndex = prevIndex < 0 ? state.searchResultCount - 1 : prevIndex;
    set({ currentSearchIndex: newIndex });
    get().expandForCurrentSearchResult();
    if (isSearchDebugEnabled()) {
      const match = get().searchMatches[newIndex];
      console.info('[search] prev', {
        index: newIndex,
        itemId: match?.itemId,
        matchIndexInItem: match?.matchIndexInItem,
      });
    }
  }
}

export function runExpandForCurrentSearchResult(get: Get, set: Set): void {
  const state = get();
  const { currentSearchIndex, searchMatches } = state;

  if (currentSearchIndex < 0 || searchMatches.length === 0) return;

  const currentMatch = searchMatches[currentSearchIndex];
  if (!currentMatch) return;

  if (currentMatch.itemType === 'ai') {
    set({
      searchCurrentDisplayItemId: currentMatch.displayItemId ?? null,
      searchCurrentSubagentItemId: null,
    });
  } else {
    set({
      searchCurrentDisplayItemId: null,
      searchCurrentSubagentItemId: null,
    });
  }
}
