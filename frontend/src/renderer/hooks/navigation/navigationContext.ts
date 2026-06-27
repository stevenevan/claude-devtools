import { MutableRefObject, RefObject } from 'react';
import type { NavigationPhase } from './types';
import type { SessionConversation } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

export interface NavigationContext {
  conversation: SessionConversation | null;
  aiGroupRefs: MutableRefObject<Map<string, HTMLElement>>;
  chatItemRefs: MutableRefObject<Map<string, HTMLElement>>;
  toolItemRefs: MutableRefObject<Map<string, HTMLElement>>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
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
