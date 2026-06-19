import { findLastOutput } from '@renderer/utils/lastOutputDetector';

import type { SearchMatch } from '../../types';
import type { SessionConversation } from '@renderer/types/groups';
import type { ContentSearchMatch } from '@shared/types';

/** Maximum number of search matches to track. Beyond this, results are capped. */
export const MAX_SEARCH_MATCHES = 500;

/** Sessions with more items than this threshold route search to Rust backend. */
export const RUST_SEARCH_THRESHOLD = 200;

let counter = 0;
export const bumpSearchId = (): number => ++counter;
export const currentSearchId = (): number => counter;

export const isSearchDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem('search-debug') === '1' ||
      (window as { __searchDebug?: boolean }).__searchDebug === true
    );
  } catch {
    return false;
  }
};

/** Map Rust ContentSearchMatch to the store's SearchMatch type. */
export function mapRustMatchesToStoreMatches(rustMatches: ContentSearchMatch[]): SearchMatch[] {
  const matchCountByChunk = new Map<string, number>();
  return rustMatches.map((rm, globalIndex) => {
    const count = matchCountByChunk.get(rm.chunkId) ?? 0;
    matchCountByChunk.set(rm.chunkId, count + 1);
    return {
      itemId: rm.chunkId,
      itemType: rm.chunkType === 'user' ? ('user' as const) : ('ai' as const),
      matchIndexInItem: count,
      globalIndex,
      displayItemId: rm.source === 'aiText' ? 'lastOutput' : undefined,
    };
  });
}

/**
 * Perform JS-side search (for small sessions or Rust fallback).
 * Supports both plain text and regex modes.
 */
export function performJsSearch(
  query: string,
  conversation: SessionConversation,
  isRegex: boolean,
  set: (partial: {
    searchQuery: string;
    searchResultCount: number;
    currentSearchIndex: number;
    searchMatches: SearchMatch[];
    searchResultsCapped: boolean;
    searchMatchItemIds: Set<string>;
  }) => void
): void {
  const matches: SearchMatch[] = [];
  let globalIndex = 0;
  let capped = false;

  let findMatches: (text: string) => number;
  if (isRegex) {
    try {
      const re = new RegExp(query, 'gi');
      findMatches = (text: string) => {
        re.lastIndex = 0;
        let count = 0;
        while (re.exec(text) !== null) {
          count++;
          if (count > MAX_SEARCH_MATCHES) break;
        }
        return count;
      };
    } catch {
      set({
        searchQuery: query,
        searchResultCount: 0,
        currentSearchIndex: -1,
        searchMatches: [],
        searchResultsCapped: false,
        searchMatchItemIds: new Set(),
      });
      return;
    }
  } else {
    const lowerQuery = query.toLowerCase();
    findMatches = (text: string) => {
      const lowerText = text.toLowerCase();
      let count = 0;
      let pos = 0;
      while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
        count++;
        pos += lowerQuery.length;
        if (count > MAX_SEARCH_MATCHES) break;
      }
      return count;
    };
  }

  const addMatches = (
    text: string,
    itemId: string,
    itemType: 'user' | 'ai',
    displayItemId?: string
  ): void => {
    if (capped) return;
    const count = findMatches(text);
    for (let i = 0; i < count; i++) {
      if (matches.length >= MAX_SEARCH_MATCHES) {
        capped = true;
        return;
      }
      matches.push({
        itemId,
        itemType,
        matchIndexInItem: i,
        globalIndex,
        displayItemId,
      });
      globalIndex++;
    }
  };

  for (const item of conversation.items) {
    if (capped) break;
    if (item.type === 'user') {
      const text = item.group.content.rawText ?? item.group.content.text ?? '';
      addMatches(text, item.group.id, 'user');
    } else if (item.type === 'ai') {
      const aiGroup = item.group;
      const itemId = aiGroup.id;
      const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing ?? false);

      if (lastOutput?.type === 'text' && lastOutput.text) {
        addMatches(lastOutput.text, itemId, 'ai', 'lastOutput');
      }
    }
  }

  if (isSearchDebugEnabled()) {
    console.info('[search] js', { query, isRegex, matches: matches.length });
  }

  const matchItemIds = new Set<string>();
  for (const match of matches) {
    matchItemIds.add(match.itemId);
  }

  set({
    searchQuery: query,
    searchResultCount: matches.length,
    currentSearchIndex: matches.length > 0 ? 0 : -1,
    searchMatches: matches,
    searchResultsCapped: capped,
    searchMatchItemIds: matchItemIds,
  });
}
