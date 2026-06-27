// Nonce-based navigation: repeated clicks create new requests, tab switches don't re-trigger stale
// ones, and auto-scroll is suppressed during the full expand→scroll→highlight lifecycle.

import { useCallback, useEffect, useRef, useState } from 'react';

import { executeErrorNavigation } from './navigation/executeErrorNavigation';
import { executeSearchNavigation } from './navigation/executeSearchNavigation';

import type { NavigationContext } from './navigation/navigationContext';
import type {
  NavigationPhase,
  UseTabNavigationControllerOptions,
  UseTabNavigationControllerReturn,
} from './navigation/types';
import type { TabNavigationRequest } from '@renderer/types/tabs';
import type { TriggerColor } from '@shared/constants/triggerColors';

export function useTabNavigationController(
  options: UseTabNavigationControllerOptions
): UseTabNavigationControllerReturn {
  const {
    isActiveTab,
    pendingNavigation,
    conversation,
    conversationLoading,
    consumeTabNavigation,
    tabId,
    aiGroupRefs,
    chatItemRefs,
    toolItemRefs,
    expandAIGroup,
    scrollContainerRef,
    stickyOffset = 0,
    ensureGroupVisible,
    expandSubagentTrace,
    setSearchQuery,
    selectSearchMatch,
    highlightDuration = 3000,
  } = options;

  const [phase, setPhase] = useState<NavigationPhase>('idle');
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [currentToolUseId, setCurrentToolUseId] = useState<string | null>(null);
  const [isSearchHighlight, setIsSearchHighlight] = useState(false);
  const [highlightColor, setHighlightColor] = useState<TriggerColor | undefined>(undefined);

  const activeRequestIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFailureAtRef = useRef<number>(0);

  // ponytail: useCallback required — in executeNavigation dep array
  const handleHighlightEnd = useCallback(() => {
    setHighlightedGroupId(null);
    setCurrentToolUseId(null);
    setIsSearchHighlight(false);
    setHighlightColor(undefined);
    setPhase('idle');
    activeRequestIdRef.current = null;

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  // ponytail: useCallback required — in useEffect dep arrays and executeNavigation dep array
  const abortNavigation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  // ponytail: useCallback required — in useEffect dep arrays
  const executeNavigation = useCallback(
    async (request: TabNavigationRequest): Promise<void> => {
      abortNavigation();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const ctx: NavigationContext = {
        conversation,
        aiGroupRefs,
        chatItemRefs,
        toolItemRefs,
        scrollContainerRef,
        stickyOffset,
        ensureGroupVisible,
        expandAIGroup,
        expandSubagentTrace,
        setSearchQuery,
        selectSearchMatch,
        setPhase,
        setHighlightedGroupId,
        setCurrentToolUseId,
        setIsSearchHighlight,
        setHighlightColor,
      };

      try {
        let success = false;

        if (request.kind === 'error') {
          success = await executeErrorNavigation(request, ctx, abortController.signal);
        } else if (request.kind === 'search') {
          success = await executeSearchNavigation(request, ctx, abortController.signal);
        } else if (request.kind === 'autoBottom') {
          // autoBottom is handled by useAutoScrollBottom naturally
          consumeTabNavigation(tabId, request.id);
          return;
        }

        if (abortController.signal.aborted) return;

        if (success) {
          highlightTimerRef.current = setTimeout(() => {
            if (!abortController.signal.aborted) {
              if (request.kind === 'search') {
                setSearchQuery('');
              }
              handleHighlightEnd();
            }
          }, highlightDuration);

          setPhase('complete');
        } else {
          setPhase('idle');
          setHighlightedGroupId(null);
          setCurrentToolUseId(null);
          setIsSearchHighlight(false);
          setHighlightColor(undefined);
          activeRequestIdRef.current = null;
          lastFailureAtRef.current = Date.now();
        }

        consumeTabNavigation(tabId, request.id);
      } catch {
        if (!abortController.signal.aborted) {
          setPhase('idle');
          activeRequestIdRef.current = null;
          lastFailureAtRef.current = Date.now();
          consumeTabNavigation(tabId, request.id);
        }
      }
    },
    [
      abortNavigation,
      consumeTabNavigation,
      tabId,
      highlightDuration,
      handleHighlightEnd,
      setSearchQuery,
      conversation,
      expandAIGroup,
      expandSubagentTrace,
      aiGroupRefs,
      chatItemRefs,
      toolItemRefs,
      scrollContainerRef,
      stickyOffset,
      ensureGroupVisible,
      selectSearchMatch,
    ]
  );

  useEffect(() => {
    if (!isActiveTab) return;
    if (!pendingNavigation) return;
    if (activeRequestIdRef.current === pendingNavigation.id) return;
    if (Date.now() - lastFailureAtRef.current < 500) return;

    activeRequestIdRef.current = pendingNavigation.id;

    if (conversationLoading || !conversation) {
      queueMicrotask(() => setPhase('pending'));
      return;
    }

    // Deferred to avoid synchronous setState in effect
    queueMicrotask(() => {
      void executeNavigation(pendingNavigation);
    });
  }, [isActiveTab, pendingNavigation, conversationLoading, conversation, executeNavigation]);

  useEffect(() => {
    if (phase !== 'pending') return;
    if (!isActiveTab) return;
    if (conversationLoading || !conversation) return;
    if (!pendingNavigation) return;

    queueMicrotask(() => {
      void executeNavigation(pendingNavigation);
    });
  }, [phase, isActiveTab, conversationLoading, conversation, pendingNavigation, executeNavigation]);

  useEffect(() => {
    if (!isActiveTab && phase !== 'idle') {
      abortNavigation();
      queueMicrotask(() => {
        setPhase('idle');
        setHighlightedGroupId(null);
        setCurrentToolUseId(null);
        setIsSearchHighlight(false);
        setHighlightColor(undefined);
      });
      activeRequestIdRef.current = null;
    }
  }, [isActiveTab, phase, abortNavigation]);

  useEffect(() => {
    return () => {
      abortNavigation();
    };
  }, [abortNavigation]);

  const shouldDisableAutoScroll =
    phase === 'pending' ||
    phase === 'expanding' ||
    phase === 'scrolling' ||
    phase === 'highlighting' ||
    phase === 'complete' ||
    // Also disable while any pendingNavigation exists (even before processing starts)
    (isActiveTab && pendingNavigation !== undefined);

  return {
    phase,
    highlightedGroupId,
    highlightToolUseId: currentToolUseId,
    isSearchHighlight,
    highlightColor,
    shouldDisableAutoScroll,
    setHighlightedGroupId,
    handleHighlightEnd,
  };
}
