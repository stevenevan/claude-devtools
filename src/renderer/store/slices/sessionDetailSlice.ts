/**
 * Session detail slice - manages session detail, conversation, and stats.
 *
 * The heavy fetch / refresh bodies live in sibling files so this slice
 * stays focused on state shape + tiny method wrappers.
 */
import { fetchSessionDetailAction } from './sessionDetailFetch';
import { refreshSessionInPlaceAction } from './sessionDetailRefresh';

import type { AppState } from '../types';
import type { TabSessionData } from './sessionDetailState';
import type { ClaudeMdStats } from '@renderer/types/claudeMd';
import type { ContextPhaseInfo, ContextStats } from '@renderer/types/contextInjection';
import type { SessionDetail } from '@renderer/types/data';
import type { AIGroup, SessionConversation } from '@renderer/types/groups';
import type { AgentConfig } from '@shared/types/api';
import type { StateCreator } from 'zustand';

export type { TabSessionData } from './sessionDetailState';
export { createEmptyTabSessionData } from './sessionDetailState';

export interface SessionDetailSlice {
  sessionDetail: SessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError: string | null;

  conversation: SessionConversation | null;
  conversationLoading: boolean;

  sessionClaudeMdStats: Map<string, ClaudeMdStats> | null;
  sessionContextStats: Map<string, ContextStats> | null;
  sessionPhaseInfo: ContextPhaseInfo | null;

  agentConfigs: Record<string, AgentConfig>;

  visibleAIGroupId: string | null;
  selectedAIGroup: AIGroup | null;

  tabSessionData: Record<string, TabSessionData>;

  fetchSessionDetail: (projectId: string, sessionId: string, tabId?: string) => Promise<void>;
  refreshSessionInPlace: (projectId: string, sessionId: string) => Promise<void>;
  setVisibleAIGroup: (aiGroupId: string | null) => void;
  setTabVisibleAIGroup: (tabId: string, aiGroupId: string | null) => void;
  cleanupTabSessionData: (tabId: string) => void;
}

export const createSessionDetailSlice: StateCreator<AppState, [], [], SessionDetailSlice> = (
  set,
  get
) => ({
  sessionDetail: null,
  sessionDetailLoading: false,
  sessionDetailError: null,

  conversation: null,
  conversationLoading: false,

  sessionClaudeMdStats: null,
  sessionContextStats: null,
  sessionPhaseInfo: null,

  agentConfigs: {},

  visibleAIGroupId: null,
  selectedAIGroup: null,

  tabSessionData: {},

  fetchSessionDetail: (projectId, sessionId, tabId) =>
    fetchSessionDetailAction(get, set, projectId, sessionId, tabId),

  refreshSessionInPlace: (projectId, sessionId) =>
    refreshSessionInPlaceAction(get, set, projectId, sessionId),

  setVisibleAIGroup: (aiGroupId: string | null) => {
    const state = get();
    if (aiGroupId === state.visibleAIGroupId) return;

    let selectedAIGroup: AIGroup | null = null;
    if (aiGroupId && state.conversation) {
      for (const item of state.conversation.items) {
        if (item.type === 'ai' && item.group.id === aiGroupId) {
          selectedAIGroup = item.group;
          break;
        }
      }
    }

    set({ visibleAIGroupId: aiGroupId, selectedAIGroup });
  },

  setTabVisibleAIGroup: (tabId: string, aiGroupId: string | null) => {
    const state = get();
    const tabData = state.tabSessionData[tabId];
    if (!tabData) return;
    if (aiGroupId === tabData.visibleAIGroupId) return;

    let selectedAIGroup: AIGroup | null = null;
    if (aiGroupId && tabData.conversation) {
      for (const item of tabData.conversation.items) {
        if (item.type === 'ai' && item.group.id === aiGroupId) {
          selectedAIGroup = item.group;
          break;
        }
      }
    }

    set({
      tabSessionData: {
        ...state.tabSessionData,
        [tabId]: {
          ...tabData,
          visibleAIGroupId: aiGroupId,
          selectedAIGroup,
        },
      },
    });
  },

  cleanupTabSessionData: (tabId: string) => {
    const prev = get().tabSessionData;
    if (!(tabId in prev)) return;
    const next = { ...prev };
    delete next[tabId];
    set({ tabSessionData: next });
  },
});
