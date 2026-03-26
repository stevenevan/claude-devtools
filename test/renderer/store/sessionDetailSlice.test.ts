/**
 * Tests for the sessionDetailSlice - session detail, conversation, per-tab data.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createTestStore } from './storeTestUtils';

import type { AIGroup, SessionConversation } from '../../../src/renderer/types/groups';
import type { TestStore } from './storeTestUtils';

let store: TestStore;

beforeEach(() => {
  store = createTestStore();
});

function makeAIGroup(id: string): AIGroup {
  return {
    id,
    responses: [],
    displayItems: [],
    metrics: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalCost: 0 },
    isLast: false,
  } as unknown as AIGroup;
}

function makeConversation(aiGroupIds: string[]): SessionConversation {
  return {
    items: aiGroupIds.map((id) => ({
      type: 'ai' as const,
      group: makeAIGroup(id),
    })),
    stats: {
      userMessageCount: 0,
      aiGroupCount: aiGroupIds.length,
      systemMessageCount: 0,
      totalToolCalls: 0,
    },
  };
}

describe('sessionDetailSlice', () => {
  describe('initial state', () => {
    it('starts with null detail and conversation', () => {
      const state = store.getState();
      expect(state.sessionDetail).toBeNull();
      expect(state.sessionDetailLoading).toBe(false);
      expect(state.sessionDetailError).toBeNull();
      expect(state.conversation).toBeNull();
      expect(state.conversationLoading).toBe(false);
      expect(state.sessionClaudeMdStats).toBeNull();
      expect(state.sessionContextStats).toBeNull();
      expect(state.sessionPhaseInfo).toBeNull();
      expect(state.agentConfigs).toEqual({});
      expect(state.visibleAIGroupId).toBeNull();
      expect(state.selectedAIGroup).toBeNull();
      expect(state.tabSessionData).toEqual({});
    });
  });

  describe('setVisibleAIGroup', () => {
    it('sets visibleAIGroupId and selectedAIGroup when conversation exists', () => {
      const conversation = makeConversation(['ai-1', 'ai-2', 'ai-3']);
      store.setState({ conversation });

      store.getState().setVisibleAIGroup('ai-2');

      const state = store.getState();
      expect(state.visibleAIGroupId).toBe('ai-2');
      expect(state.selectedAIGroup).not.toBeNull();
      expect(state.selectedAIGroup?.id).toBe('ai-2');
    });

    it('sets selectedAIGroup to null when id not found in conversation', () => {
      const conversation = makeConversation(['ai-1']);
      store.setState({ conversation });

      store.getState().setVisibleAIGroup('ai-nonexistent');

      const state = store.getState();
      expect(state.visibleAIGroupId).toBe('ai-nonexistent');
      expect(state.selectedAIGroup).toBeNull();
    });

    it('sets both to null when aiGroupId is null', () => {
      const conversation = makeConversation(['ai-1']);
      store.setState({
        conversation,
        visibleAIGroupId: 'ai-1',
        selectedAIGroup: makeAIGroup('ai-1'),
      });

      store.getState().setVisibleAIGroup(null);

      expect(store.getState().visibleAIGroupId).toBeNull();
      expect(store.getState().selectedAIGroup).toBeNull();
    });

    it('no-ops when setting the same id', () => {
      const conversation = makeConversation(['ai-1']);
      store.setState({
        conversation,
        visibleAIGroupId: 'ai-1',
        selectedAIGroup: makeAIGroup('ai-1'),
      });

      const before = store.getState().selectedAIGroup;
      store.getState().setVisibleAIGroup('ai-1');
      // Should be reference-equal (no state update)
      expect(store.getState().selectedAIGroup).toBe(before);
    });
  });

  describe('setTabVisibleAIGroup', () => {
    it('sets visibleAIGroupId for a specific tab', () => {
      const conversation = makeConversation(['ai-1', 'ai-2']);

      store.setState({
        tabSessionData: {
          'tab-1': {
            sessionDetail: null,
            conversation,
            conversationLoading: false,
            sessionDetailLoading: false,
            sessionDetailError: null,
            sessionClaudeMdStats: null,
            sessionContextStats: null,
            sessionPhaseInfo: null,
            visibleAIGroupId: null,
            selectedAIGroup: null,
            isStreaming: false,
          },
        },
      });

      store.getState().setTabVisibleAIGroup('tab-1', 'ai-2');

      const tabData = store.getState().tabSessionData['tab-1'];
      expect(tabData.visibleAIGroupId).toBe('ai-2');
      expect(tabData.selectedAIGroup?.id).toBe('ai-2');
    });

    it('no-ops for non-existent tab', () => {
      const before = store.getState().tabSessionData;
      store.getState().setTabVisibleAIGroup('non-existent', 'ai-1');
      expect(store.getState().tabSessionData).toBe(before);
    });

    it('no-ops when setting same id on tab', () => {
      const conversation = makeConversation(['ai-1']);
      const group = makeAIGroup('ai-1');

      store.setState({
        tabSessionData: {
          'tab-1': {
            sessionDetail: null,
            conversation,
            conversationLoading: false,
            sessionDetailLoading: false,
            sessionDetailError: null,
            sessionClaudeMdStats: null,
            sessionContextStats: null,
            sessionPhaseInfo: null,
            visibleAIGroupId: 'ai-1',
            selectedAIGroup: group,
            isStreaming: false,
          },
        },
      });

      const before = store.getState().tabSessionData;
      store.getState().setTabVisibleAIGroup('tab-1', 'ai-1');
      expect(store.getState().tabSessionData).toBe(before);
    });
  });

  describe('cleanupTabSessionData', () => {
    it('removes per-tab session data', () => {
      store.setState({
        tabSessionData: {
          'tab-1': {
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
          },
          'tab-2': {
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
          },
        },
      });

      store.getState().cleanupTabSessionData('tab-1');

      const data = store.getState().tabSessionData;
      expect(data['tab-1']).toBeUndefined();
      expect(data['tab-2']).toBeDefined();
    });

    it('no-ops for non-existent tab', () => {
      store.setState({ tabSessionData: {} });
      const before = store.getState().tabSessionData;
      store.getState().cleanupTabSessionData('non-existent');
      expect(store.getState().tabSessionData).toBe(before);
    });
  });
});
