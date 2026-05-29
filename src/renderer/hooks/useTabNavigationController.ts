/**
 * Unified Tab Navigation Controller
 *
 * Single active-tab controller that replaces useNavigationCoordinator + useSearchContextNavigation.
 * Manages the complete lifecycle of navigation requests with proper sequencing:
 *
 * 1. Receive pending navigation request from tab state
 * 2. Ignore if tab is not active (prevents cross-tab races)
 * 3. Wait for content to load
 * 4. Expand target group and item
 * 5. Wait for DOM to stabilize
 * 6. Scroll to target
 * 7. Set highlight (red for error, yellow for search)
 * 8. Clear highlight after timeout
 * 9. Consume the navigation request (mark as processed)
 *
 * The nonce-based request model ensures:
 * - Repeated clicks create new navigations
 * - Tab switches don't re-trigger stale requests
 * - Auto-scroll is suppressed during navigation
 */

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

  // State
  const [phase, setPhase] = useState<NavigationPhase>('idle');
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [currentToolUseId, setCurrentToolUseId] = useState<string | null>(null);
  const [isSearchHighlight, setIsSearchHighlight] = useState(false);
  const [highlightColor, setHighlightColor] = useState<TriggerColor | undefined>(undefined);

  // Refs for tracking
  const activeRequestIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFailureAtRef = useRef<number>(0);

  // Clear highlight and reset state
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

  // Abort any in-progress navigation
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

  // Main navigation executor
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
          // Just consume the request and stay idle
          consumeTabNavigation(tabId, request.id);
          return;
        }

        if (abortController.signal.aborted) return;

        if (success) {
          // Schedule highlight end
          highlightTimerRef.current = setTimeout(() => {
            if (!abortController.signal.aborted) {
              // Clear search state if it was a search navigation
              if (request.kind === 'search') {
                setSearchQuery('');
              }
              handleHighlightEnd();
            }
          }, highlightDuration);

          setPhase('complete');
        } else {
          // Navigation failed - reset
          setPhase('idle');
          setHighlightedGroupId(null);
          setCurrentToolUseId(null);
          setIsSearchHighlight(false);
          setHighlightColor(undefined);
          activeRequestIdRef.current = null;
          lastFailureAtRef.current = Date.now();
        }

        // Consume the request regardless of success/failure to prevent re-processing
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

  // Effect: Detect and process new navigation requests
  useEffect(() => {
    // Ignore if not active tab (prevents cross-tab races)
    if (!isActiveTab) return;

    // No pending request
    if (!pendingNavigation) return;

    // Already processing this request
    if (activeRequestIdRef.current === pendingNavigation.id) return;

    // Recently failed - debounce
    if (Date.now() - lastFailureAtRef.current < 500) return;

    // Record this request
    activeRequestIdRef.current = pendingNavigation.id;

    // If content is loading, wait in pending state
    if (conversationLoading || !conversation) {
      queueMicrotask(() => setPhase('pending'));
      return;
    }

    // Execute navigation (deferred to avoid synchronous setState in effect)
    queueMicrotask(() => {
      void executeNavigation(pendingNavigation);
    });
  }, [isActiveTab, pendingNavigation, conversationLoading, conversation, executeNavigation]);

  // Effect: When content finishes loading and we're pending, start navigation
  useEffect(() => {
    if (phase !== 'pending') return;
    if (!isActiveTab) return;
    if (conversationLoading || !conversation) return;
    if (!pendingNavigation) return;

    queueMicrotask(() => {
      void executeNavigation(pendingNavigation);
    });
  }, [phase, isActiveTab, conversationLoading, conversation, pendingNavigation, executeNavigation]);

  // Effect: Reset when tab becomes inactive
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortNavigation();
    };
  }, [abortNavigation]);

  // Computed: should disable auto-scroll
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
