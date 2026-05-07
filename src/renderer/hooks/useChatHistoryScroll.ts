import { useCallback, useEffect, useRef, useState } from 'react';

import { isNearBottom, useAutoScrollBottom } from '@renderer/hooks/useAutoScrollBottom';
import { useStore } from '@renderer/store';

import type { ChatItem } from '@renderer/types/groups';

const SCROLL_THRESHOLD = 300;

interface UseChatHistoryScrollOptions {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  conversation: { items: ChatItem[] } | null;
  conversationLoading: boolean;
  isThisTabActive: boolean;
  effectiveTabId: string | null | undefined;
  savedScrollTop: number | undefined;
  saveScrollPosition: (top: number) => void;
  shouldDisableAutoScroll: boolean;
  currentSearchIndex: number;
  searchMatches: { itemId: string; matchIndexInItem: number }[];
  ensureGroupVisible: (groupId: string) => Promise<void>;
  aiGroupRefs: React.RefObject<Map<string, HTMLElement>>;
  chatItemRefs: React.RefObject<Map<string, HTMLElement>>;
}

interface UseChatHistoryScrollReturn {
  showScrollButton: boolean;
  checkScrollButton: () => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  setShowScrollButton: (visible: boolean) => void;
}

export function useChatHistoryScroll(
  options: UseChatHistoryScrollOptions
): UseChatHistoryScrollReturn {
  const {
    scrollContainerRef,
    conversation,
    conversationLoading,
    isThisTabActive,
    effectiveTabId,
    savedScrollTop,
    saveScrollPosition,
    shouldDisableAutoScroll,
    currentSearchIndex,
    searchMatches,
    ensureGroupVisible,
    aiGroupRefs,
    chatItemRefs,
  } = options;

  const [showScrollButton, setShowScrollButton] = useState(false);
  const prevShouldDisableRef = useRef(shouldDisableAutoScroll);
  const wasActiveRef = useRef(isThisTabActive);

  const checkScrollButton = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setShowScrollButton(!isNearBottom(scrollTop, scrollHeight, clientHeight, SCROLL_THRESHOLD));
  }, [scrollContainerRef]);

  const { scrollToBottom } = useAutoScrollBottom([conversation], {
    threshold: SCROLL_THRESHOLD,
    smoothDuration: 300,
    autoBehavior: 'auto',
    disabled: shouldDisableAutoScroll,
    externalRef: scrollContainerRef,
    resetKey: effectiveTabId,
  });

  useEffect(() => {
    checkScrollButton();
  }, [conversation, checkScrollButton]);

  useEffect(() => {
    const handler = (): void => {
      scrollToBottom('smooth');
    };
    window.addEventListener('session-refresh-scroll-bottom', handler);
    return () => window.removeEventListener('session-refresh-scroll-bottom', handler);
  }, [scrollToBottom]);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isThisTabActive;

    if (wasActive && !isThisTabActive && scrollContainerRef.current) {
      saveScrollPosition(scrollContainerRef.current.scrollTop);
    }
  }, [isThisTabActive, saveScrollPosition, scrollContainerRef]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    return () => {
      if (scrollContainer) {
        saveScrollPosition(scrollContainer.scrollTop);
      }
    };
  }, [saveScrollPosition, scrollContainerRef]);

  useEffect(() => {
    const wasDisabled = prevShouldDisableRef.current;
    prevShouldDisableRef.current = shouldDisableAutoScroll;

    if (wasDisabled && !shouldDisableAutoScroll && scrollContainerRef.current) {
      saveScrollPosition(scrollContainerRef.current.scrollTop);
      return;
    }

    if (
      isThisTabActive &&
      savedScrollTop !== undefined &&
      scrollContainerRef.current &&
      !conversationLoading &&
      !shouldDisableAutoScroll
    ) {
      let frameA = 0;
      let frameB = 0;
      frameA = requestAnimationFrame(() => {
        frameB = requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = savedScrollTop;
          }
        });
      });
      return () => {
        cancelAnimationFrame(frameA);
        cancelAnimationFrame(frameB);
      };
    }
  }, [
    isThisTabActive,
    savedScrollTop,
    conversationLoading,
    shouldDisableAutoScroll,
    saveScrollPosition,
    scrollContainerRef,
  ]);

  useEffect(() => {
    const currentMatch = currentSearchIndex >= 0 ? searchMatches[currentSearchIndex] : null;
    if (!currentMatch) return;

    let frameId = 0;
    let attempt = 0;
    let cancelled = false;

    const promoteAndScroll = (el: HTMLElement): void => {
      const container = scrollContainerRef.current;
      if (container) {
        container
          .querySelectorAll<HTMLElement>('mark[data-search-result="current"]')
          .forEach((prev) => {
            /* eslint-disable no-param-reassign -- Directly mutating DOM element style/attributes is necessary for search result highlighting */
            prev.setAttribute('data-search-result', 'match');
            prev.style.backgroundColor = 'rgb(133 77 14 / 0.5)';
            prev.style.color = 'rgb(254 240 138)';
            prev.style.boxShadow = '';
            /* eslint-enable no-param-reassign -- Re-enable after DOM mutations */
          });
      }
      /* eslint-disable no-param-reassign -- Directly mutating DOM element style/attributes is necessary for current search result highlighting */
      el.setAttribute('data-search-result', 'current');
      el.style.backgroundColor = 'rgb(202 138 4 / 0.7)';
      el.style.color = 'rgb(254 249 195)';
      el.style.boxShadow = '0 0 0 1px rgb(234 179 8)';
      /* eslint-enable no-param-reassign -- Re-enable after DOM mutations */
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const fallbackDOMSearch = (): boolean => {
      const groupEl =
        chatItemRefs.current?.get(currentMatch.itemId) ??
        aiGroupRefs.current?.get(currentMatch.itemId);
      if (!groupEl) return false;

      const query = useStore.getState().searchQuery;
      if (!query) return false;
      const lowerQuery = query.toLowerCase();
      let count = 0;

      const searchRoots = groupEl.querySelectorAll<HTMLElement>('[data-search-content]');
      const roots = searchRoots.length > 0 ? Array.from(searchRoots) : [groupEl];

      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? '';
          const lowerText = text.toLowerCase();
          let pos = 0;
          while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
            if (count === currentMatch.matchIndexInItem) {
              const parent = node.parentElement;
              if (parent) {
                parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return true;
              }
            }
            count++;
            pos += lowerQuery.length;
          }
        }
      }
      return false;
    };

    const tryScrollToResult = (): void => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const el = container.querySelector<HTMLElement>(
        `mark[data-search-item-id="${CSS.escape(currentMatch.itemId)}"][data-search-match-index="${currentMatch.matchIndexInItem}"]`
      );
      if (el) {
        promoteAndScroll(el);
        return;
      }

      if (attempt >= 3) {
        const orderedMarks = Array.from(
          container.querySelectorAll<HTMLElement>(
            'mark[data-search-item-id][data-search-match-index]'
          )
        );
        const byGlobal = orderedMarks[currentSearchIndex];
        if (byGlobal) {
          promoteAndScroll(byGlobal);
          return;
        }
      }

      if (attempt >= 6) {
        if (fallbackDOMSearch()) return;
      }

      if (attempt < 60) {
        attempt++;
        frameId = requestAnimationFrame(tryScrollToResult);
      }
    };

    const run = async (): Promise<void> => {
      await ensureGroupVisible(currentMatch.itemId);
      if (cancelled) return;
      frameId = requestAnimationFrame(tryScrollToResult);
    };

    void run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [
    currentSearchIndex,
    searchMatches,
    ensureGroupVisible,
    aiGroupRefs,
    chatItemRefs,
    scrollContainerRef,
  ]);

  return {
    showScrollButton,
    checkScrollButton,
    scrollToBottom,
    setShowScrollButton,
  };
}
