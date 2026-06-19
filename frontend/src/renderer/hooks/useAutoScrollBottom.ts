import { useCallback, useEffect, useRef } from 'react';

interface UseAutoScrollBottomOptions {
  threshold?: number;
  smoothDuration?: number;
  enabled?: boolean;
  autoBehavior?: ScrollBehavior;
  // Unlike enabled, disabled is for transient disabling during specific operations (e.g. navigation).
  disabled?: boolean;
  // When provided, hook uses this ref instead of creating its own (for sharing with other hooks).
  externalRef?: React.RefObject<HTMLDivElement | null>;
  // When this value changes, reset isAtBottom to true (for tab/session switches).
  resetKey?: string | null;
}

interface UseAutoScrollBottomReturn {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  // Returns a function to avoid accessing ref.current during render.
  getIsAtBottom: () => boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  checkIsAtBottom: () => boolean;
}

export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= threshold;
}

export function useAutoScrollBottom(
  dependencies: unknown[],
  options: UseAutoScrollBottomOptions = {}
): UseAutoScrollBottomReturn {
  const {
    threshold = 100,
    smoothDuration = 300,
    enabled = true,
    autoBehavior = 'smooth',
    disabled = false,
    externalRef,
    resetKey,
  } = options;

  const internalRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = externalRef ?? internalRef;

  const isAtBottomRef = useRef(true); // Start assuming at bottom
  const wasAtBottomBeforeUpdateRef = useRef(true);
  const isScrollingRef = useRef(false);
  // Track disabled state in ref for checking inside RAF callbacks
  const disabledRef = useRef(disabled);
  // Set true when resetKey changes; consumed by the content effect to force scroll on first load
  const prevResetKeyRef = useRef(resetKey);
  const needsInitialScrollRef = useRef(false);

  const checkIsAtBottom = useCallback((): boolean => {
    const container = scrollContainerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return isNearBottom(scrollTop, scrollHeight, clientHeight, threshold);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollContainerRef is a ref, stable across renders
  }, [threshold]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const container = scrollContainerRef.current;
      if (!container) return;

      // Prevent scroll event handler from updating isAtBottom during programmatic scroll
      isScrollingRef.current = true;

      const targetScrollTop = container.scrollHeight - container.clientHeight;

      if (behavior === 'smooth') {
        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth',
        });

        // Reset flag after animation completes
        setTimeout(() => {
          isScrollingRef.current = false;
          isAtBottomRef.current = true;
        }, smoothDuration);
      } else {
        container.scrollTop = targetScrollTop;
        isScrollingRef.current = false;
        isAtBottomRef.current = true;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollContainerRef is a ref, stable across renders
    [smoothDuration]
  );

  const handleScroll = useCallback(() => {
    // Ignore scroll events during programmatic scrolling
    if (isScrollingRef.current) return;

    isAtBottomRef.current = checkIsAtBottom();
  }, [checkIsAtBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollContainerRef is a ref, stable across renders
  }, [handleScroll]);

  // Snapshot isAtBottom before each render so content-change effect knows whether to scroll.
  useEffect(() => {
    wasAtBottomBeforeUpdateRef.current = isAtBottomRef.current;
  });

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  // Reset isAtBottom state when resetKey changes (e.g., tab/session switch).
  // Sets needsInitialScrollRef so the content effect scrolls to bottom on first load.
  useEffect(() => {
    if (resetKey !== prevResetKeyRef.current) {
      isAtBottomRef.current = true;
      wasAtBottomBeforeUpdateRef.current = true;
      prevResetKeyRef.current = resetKey;
      needsInitialScrollRef.current = true;
    }
  }, [resetKey]);

  // Scroll to bottom when content changes if user was near bottom or this is first load after a
  // tab/session switch. Double-RAF + cleanup prevents React StrictMode double-invoke.
  useEffect(() => {
    // Skip if disabled (e.g., during navigation) or not enabled
    if (!enabled || disabled) return;

    let id1 = 0;
    let id2 = 0;

    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        // Re-check disabled state — navigation may have started between effect and RAF
        if (disabledRef.current) return;

        const shouldScroll = needsInitialScrollRef.current || wasAtBottomBeforeUpdateRef.current;
        if (shouldScroll) {
          needsInitialScrollRef.current = false;
          scrollToBottom(autoBehavior);
        }
      });
    });

    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Dynamic dependencies array is intentional design
  }, [...dependencies, enabled, disabled, autoBehavior, scrollToBottom]);

  const getIsAtBottom = useCallback((): boolean => {
    return isAtBottomRef.current;
  }, []);

  return {
    scrollContainerRef,
    getIsAtBottom,
    scrollToBottom,
    checkIsAtBottom,
  };
}
