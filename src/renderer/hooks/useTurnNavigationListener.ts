import { useEffect, type MutableRefObject } from 'react';

import { useStore } from '@renderer/store';

import type { Virtualizer } from '@tanstack/react-virtual';

interface UseTurnNavigationListenerParams {
  isThisTabActive: boolean;
  conversation: { items: { type: string; group: { id: string } }[] } | null;
  effectiveTabId: string | null | undefined;
  shouldVirtualize: boolean;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  aiGroupRefs: MutableRefObject<Map<string, HTMLElement>>;
  navigationHighlightTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setHighlightedGroupId: (id: string | null) => void;
  setIsNavigationHighlight: (b: boolean) => void;
}

export function useTurnNavigationListener({
  isThisTabActive,
  conversation,
  effectiveTabId,
  shouldVirtualize,
  rowVirtualizer,
  aiGroupRefs,
  navigationHighlightTimerRef,
  setHighlightedGroupId,
  setIsNavigationHighlight,
}: UseTurnNavigationListenerParams): void {
  useEffect(() => {
    if (!isThisTabActive || !conversation) return;

    const aiGroupIndices = conversation.items
      .map((item, i) => (item.type === 'ai' ? i : -1))
      .filter((i) => i !== -1);

    if (aiGroupIndices.length === 0) return;

    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ direction: 'next' | 'prev' }>).detail;
      const currentFocused = useStore.getState().getFocusedTurnIndexForTab(effectiveTabId ?? '');

      let nextIdx: number;
      if (currentFocused < 0) {
        nextIdx = detail.direction === 'next' ? 0 : aiGroupIndices.length - 1;
      } else {
        const currentPos = aiGroupIndices.indexOf(currentFocused);
        if (currentPos < 0) {
          nextIdx = 0;
        } else {
          nextIdx =
            detail.direction === 'next'
              ? Math.min(currentPos + 1, aiGroupIndices.length - 1)
              : Math.max(currentPos - 1, 0);
        }
      }

      const targetItemIndex = aiGroupIndices[nextIdx];
      const targetItem = conversation.items[targetItemIndex];
      if (targetItem?.type !== 'ai') return;

      useStore.getState().setFocusedTurnIndexForTab(effectiveTabId ?? '', targetItemIndex);

      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(targetItemIndex, { align: 'center', behavior: 'smooth' });
      } else {
        const el = aiGroupRefs.current.get(targetItem.group.id);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      setHighlightedGroupId(targetItem.group.id);
      setIsNavigationHighlight(true);
      const timerRef = navigationHighlightTimerRef;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setHighlightedGroupId(null);
        setIsNavigationHighlight(false);
      }, 1500);
    };

    window.addEventListener('turn-navigate', handler);
    return () => window.removeEventListener('turn-navigate', handler);
  }, [
    isThisTabActive,
    conversation,
    effectiveTabId,
    shouldVirtualize,
    rowVirtualizer,
    aiGroupRefs,
    navigationHighlightTimerRef,
    setHighlightedGroupId,
    setIsNavigationHighlight,
  ]);
}
