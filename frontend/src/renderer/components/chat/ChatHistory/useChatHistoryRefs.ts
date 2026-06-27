import { MutableRefObject, useCallback } from 'react';
interface ChatHistoryRefs {
  registerAIGroupRefCombined: (groupId: string) => (el: HTMLElement | null) => void;
  registerChatItemRef: (groupId: string) => (el: HTMLElement | null) => void;
  registerToolRef: (toolId: string, el: HTMLElement | null) => void;
}

export const useChatHistoryRefs = (
  registerAIGroupRef: (groupId: string) => ((el: HTMLElement | null) => void) | void,
  aiGroupRefs: MutableRefObject<Map<string, HTMLElement>>,
  chatItemRefs: MutableRefObject<Map<string, HTMLElement>>,
  toolItemRefs: MutableRefObject<Map<string, HTMLElement>>
): ChatHistoryRefs => {
  // ponytail: useCallback required — stable ref passed to ChatHistoryVirtualizer registerAIGroupRef prop
  const registerAIGroupRefCombined = useCallback(
    (groupId: string) => {
      const visibilityRef = registerAIGroupRef(groupId);
      return (el: HTMLElement | null) => {
        if (typeof visibilityRef === 'function') visibilityRef(el);
        if (el) aiGroupRefs.current.set(groupId, el);
        else aiGroupRefs.current.delete(groupId);
      };
    },
    [registerAIGroupRef, aiGroupRefs]
  );

  // ponytail: useCallback required — stable ref passed to ChatHistoryVirtualizer registerChatItemRef prop
  const registerChatItemRef = useCallback(
    (groupId: string) => {
      return (el: HTMLElement | null) => {
        if (el) chatItemRefs.current.set(groupId, el);
        else chatItemRefs.current.delete(groupId);
      };
    },
    [chatItemRefs]
  );

  // ponytail: useCallback required — stable ref passed to ChatHistoryVirtualizer registerToolRef prop
  const registerToolRef = useCallback(
    (toolId: string, el: HTMLElement | null) => {
      if (el) toolItemRefs.current.set(toolId, el);
      else toolItemRefs.current.delete(toolId);
    },
    [toolItemRefs]
  );

  return { registerAIGroupRefCombined, registerChatItemRef, registerToolRef };
};
