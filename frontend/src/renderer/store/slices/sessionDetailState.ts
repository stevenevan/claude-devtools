/**
 * Shared per-tab session data shape used by sessionDetailSlice and its
 * sibling fetch/refresh action files.
 */
import type { ClaudeMdStats } from '@renderer/types/claudeMd';
import type { ContextPhaseInfo, ContextStats } from '@renderer/types/contextInjection';
import type { SessionDetail } from '@renderer/types/data';
import type { AIGroup, SessionConversation } from '@renderer/types/groups';

export interface TabSessionData {
  sessionDetail: SessionDetail | null;
  conversation: SessionConversation | null;
  conversationLoading: boolean;
  sessionDetailLoading: boolean;
  sessionDetailError: string | null;
  sessionClaudeMdStats: Map<string, ClaudeMdStats> | null;
  sessionContextStats: Map<string, ContextStats> | null;
  sessionPhaseInfo: ContextPhaseInfo | null;
  visibleAIGroupId: string | null;
  selectedAIGroup: AIGroup | null;
  /** Whether this tab is streaming real-time updates from an ongoing session. */
  isStreaming: boolean;
}

export function createEmptyTabSessionData(): TabSessionData {
  return {
    sessionDetail: null,
    conversation: null,
    conversationLoading: false,
    sessionDetailLoading: false,
    sessionDetailError: null,
    sessionClaudeMdStats: null,
    sessionContextStats: null,
    sessionPhaseInfo: null,
    visibleAIGroupId: null,
    selectedAIGroup: null,
    isStreaming: false,
  };
}
