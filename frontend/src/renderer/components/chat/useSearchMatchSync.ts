// Syncs rendered <mark data-search-item-id> nodes back into the store so searchMatches reflects what's actually painted.
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import type { SearchMatch } from '@renderer/store/types';
import type { SearchableConversation } from '@renderer/types/simpleChat';

const EMPTY_RENDER_RETRIES = 3;

export function useSearchMatchSync(args: {
  isThisTabActive: boolean;
  isSearchActive: boolean;
  conversation: SearchableConversation | null;
  shouldVirtualize: boolean;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  currentSearchIndex: number;
  searchMatches: SearchMatch[];
  syncSearchMatchesWithRendered: (matches: { itemId: string; matchIndexInItem: number }[]) => void;
}): void {
  const {
    isThisTabActive,
    isSearchActive,
    conversation,
    shouldVirtualize,
    scrollContainerRef,
    currentSearchIndex,
    searchMatches,
    syncSearchMatchesWithRendered,
  } = args;

  const emptyRenderedSyncCountRef = useRef(0);

  useEffect(() => {
    if (!isThisTabActive || !isSearchActive || !conversation || shouldVirtualize) {
      emptyRenderedSyncCountRef.current = 0;
      return;
    }

    let frameA = 0;
    let frameB = 0;
    let cancelled = false;

    const run = (): void => {
      const container = scrollContainerRef.current;
      if (!container || cancelled) return;

      const renderedMatches: { itemId: string; matchIndexInItem: number }[] = [];
      const marks = container.querySelectorAll<HTMLElement>(
        'mark[data-search-item-id][data-search-match-index]'
      );
      for (const mark of marks) {
        const itemId = mark.dataset.searchItemId;
        const matchIndexRaw = mark.dataset.searchMatchIndex;
        const matchIndex = matchIndexRaw !== undefined ? Number(matchIndexRaw) : Number.NaN;
        if (!itemId || !Number.isFinite(matchIndex)) continue;
        renderedMatches.push({ itemId, matchIndexInItem: matchIndex });
      }

      if (renderedMatches.length === 0 && searchMatches.length > 0) {
        emptyRenderedSyncCountRef.current += 1;
        if (emptyRenderedSyncCountRef.current < EMPTY_RENDER_RETRIES) {
          return;
        }
      } else {
        emptyRenderedSyncCountRef.current = 0;
      }

      syncSearchMatchesWithRendered(renderedMatches);
    };

    frameA = requestAnimationFrame(() => {
      frameB = requestAnimationFrame(run);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameA);
      cancelAnimationFrame(frameB);
    };
  }, [
    isThisTabActive,
    isSearchActive,
    shouldVirtualize,
    conversation,
    currentSearchIndex,
    searchMatches,
    syncSearchMatchesWithRendered,
    scrollContainerRef,
  ]);
}
