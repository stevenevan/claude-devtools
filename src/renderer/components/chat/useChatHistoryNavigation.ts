/**
 * Navigation handlers extracted from ChatHistory.
 *
 * Owns the turn / user-group / tool jump-and-highlight behavior so
 * ChatHistory.tsx stays focused on layout and stateful coordination.
 */
import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { SessionConversation } from '@renderer/types/groups';

const HIGHLIGHT_DURATION_MS = 2000;
const TOOL_RESOLVE_TIMEOUT_MS = 500;
const TOOL_RESOLVE_POLL_MS = 50;

interface UseChatHistoryNavigationArgs {
  conversation: SessionConversation | null;
  ensureGroupVisible: (groupId: string) => Promise<void>;
  aiGroupRefs: MutableRefObject<Map<string, HTMLElement>>;
  chatItemRefs: MutableRefObject<Map<string, HTMLElement>>;
  toolItemRefs: MutableRefObject<Map<string, HTMLElement>>;
  navigationHighlightTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setHighlightedGroupId: (id: string | null) => void;
  setIsNavigationHighlight: Dispatch<SetStateAction<boolean>>;
  setContextNavToolUseId: Dispatch<SetStateAction<string | null>>;
}

export function useChatHistoryNavigation(args: UseChatHistoryNavigationArgs): {
  handleNavigateToTurn: (turnIndex: number) => void;
  handleNavigateToUserGroup: (turnIndex: number) => void;
  handleNavigateToTool: (turnIndex: number, toolUseId: string) => void;
} {
  const {
    conversation,
    ensureGroupVisible,
    aiGroupRefs,
    chatItemRefs,
    toolItemRefs,
    navigationHighlightTimerRef,
    setHighlightedGroupId,
    setIsNavigationHighlight,
    setContextNavToolUseId,
  } = args;

  const scheduleHighlightReset = useCallback(
    (extra?: () => void) => {
      if (navigationHighlightTimerRef.current) {
        clearTimeout(navigationHighlightTimerRef.current);
      }
      navigationHighlightTimerRef.current = setTimeout(() => {
        setHighlightedGroupId(null);
        setIsNavigationHighlight(false);
        extra?.();
        navigationHighlightTimerRef.current = null;
      }, HIGHLIGHT_DURATION_MS);
    },
    [navigationHighlightTimerRef, setHighlightedGroupId, setIsNavigationHighlight]
  );

  const handleNavigateToTurn = useCallback(
    (turnIndex: number) => {
      if (!conversation) return;
      const targetItem = conversation.items.find(
        (item) => item.type === 'ai' && item.group.turnIndex === turnIndex
      );
      if (targetItem?.type !== 'ai') return;

      const run = async (): Promise<void> => {
        const groupId = targetItem.group.id;
        await ensureGroupVisible(groupId);
        const element = aiGroupRefs.current.get(groupId);
        if (!element) return;

        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedGroupId(groupId);
        setIsNavigationHighlight(true);
        scheduleHighlightReset();
      };
      void run();
    },
    [
      conversation,
      ensureGroupVisible,
      setHighlightedGroupId,
      setIsNavigationHighlight,
      aiGroupRefs,
      scheduleHighlightReset,
    ]
  );

  const handleNavigateToUserGroup = useCallback(
    (turnIndex: number) => {
      if (!conversation) return;
      const aiItemIndex = conversation.items.findIndex(
        (item) => item.type === 'ai' && item.group.turnIndex === turnIndex
      );
      if (aiItemIndex < 0) return;

      const prevItem = aiItemIndex > 0 ? conversation.items[aiItemIndex - 1] : null;
      if (prevItem?.type !== 'user') return;

      const run = async (): Promise<void> => {
        const groupId = prevItem.group.id;
        await ensureGroupVisible(groupId);
        const element = chatItemRefs.current.get(groupId);
        if (!element) return;

        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedGroupId(groupId);
        setIsNavigationHighlight(true);
        scheduleHighlightReset();
      };
      void run();
    },
    [
      conversation,
      ensureGroupVisible,
      setHighlightedGroupId,
      setIsNavigationHighlight,
      chatItemRefs,
      scheduleHighlightReset,
    ]
  );

  const handleNavigateToTool = useCallback(
    (turnIndex: number, toolUseId: string) => {
      if (!conversation) return;
      const targetItem = conversation.items.find(
        (item) => item.type === 'ai' && item.group.turnIndex === turnIndex
      );
      if (targetItem?.type !== 'ai') return;

      const run = async (): Promise<void> => {
        const groupId = targetItem.group.id;
        await ensureGroupVisible(groupId);

        setHighlightedGroupId(groupId);
        setIsNavigationHighlight(true);
        setContextNavToolUseId(toolUseId);

        let toolElement: HTMLElement | undefined;
        const startTime = Date.now();
        while (Date.now() - startTime < TOOL_RESOLVE_TIMEOUT_MS) {
          toolElement = toolItemRefs.current.get(toolUseId);
          if (toolElement) break;
          await new Promise((resolve) => setTimeout(resolve, TOOL_RESOLVE_POLL_MS));
        }

        const scrollTarget = toolElement ?? aiGroupRefs.current.get(groupId);
        if (scrollTarget) {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        scheduleHighlightReset(() => setContextNavToolUseId(null));
      };
      void run();
    },
    [
      conversation,
      ensureGroupVisible,
      setHighlightedGroupId,
      setIsNavigationHighlight,
      setContextNavToolUseId,
      toolItemRefs,
      aiGroupRefs,
      scheduleHighlightReset,
    ]
  );

  return { handleNavigateToTurn, handleNavigateToUserGroup, handleNavigateToTool };
}
