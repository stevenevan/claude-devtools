import type { NavigationPhase } from './types';
import type { SessionConversation } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

export interface NavigationContext {
  conversation: SessionConversation | null;
  aiGroupRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  chatItemRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  toolItemRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  stickyOffset: number;
  ensureGroupVisible?: (groupId: string) => Promise<void> | void;
  expandAIGroup: (groupId: string) => void;
  expandSubagentTrace: (subagentId: string) => void;
  setSearchQuery: (query: string) => void;
  selectSearchMatch: (itemId: string, matchIndexInItem: number) => boolean;
  setPhase: (phase: NavigationPhase) => void;
  setHighlightedGroupId: (id: string | null) => void;
  setCurrentToolUseId: (id: string | null) => void;
  setIsSearchHighlight: (b: boolean) => void;
  setHighlightColor: (c: TriggerColor | undefined) => void;
}
