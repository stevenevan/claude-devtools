import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { GlobalSession } from '@shared/types';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:conversationFeed');

function sessionKey(session: GlobalSession): string {
  return `${session.projectId}\0${session.id}`;
}

function appendUnique(current: GlobalSession[], incoming: GlobalSession[]): GlobalSession[] {
  const seen = new Set(current.map(sessionKey));
  const uniqueIncoming = incoming.filter((session) => {
    const key = sessionKey(session);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...uniqueIncoming];
}

export interface ConversationFeedSlice {
  conversationFeedRows: GlobalSession[];
  conversationFeedCursor: string | null;
  conversationFeedHasMore: boolean;
  conversationFeedLoading: boolean;
  conversationFeedLoadingMore: boolean;
  conversationFeedLoaded: boolean;
  conversationFeedError: string | null;
  fetchConversationFeed: (force?: boolean) => Promise<void>;
  fetchMoreConversationFeed: () => Promise<void>;
  clearConversationFeed: () => void;
}

export const createConversationFeedSlice: StateCreator<AppState, [], [], ConversationFeedSlice> = (
  set,
  get
) => {
  let generation = 0;
  let initialRequest: Promise<void> | null = null;
  let appendRequest: Promise<void> | null = null;

  return {
    conversationFeedRows: [],
    conversationFeedCursor: null,
    conversationFeedHasMore: false,
    conversationFeedLoading: false,
    conversationFeedLoadingMore: false,
    conversationFeedLoaded: false,
    conversationFeedError: null,

    fetchConversationFeed: (force = false) => {
      const state = get();
      if (!force && state.conversationFeedLoaded) return Promise.resolve();
      if (!force && initialRequest) return initialRequest;

      const requestGeneration = ++generation;
      set({
        conversationFeedLoading: true,
        conversationFeedLoadingMore: false,
        conversationFeedError: null,
      });
      const request = api
        .getGlobalSessionsPaginated(null)
        .then((result) => {
          if (generation !== requestGeneration) return;
          set({
            conversationFeedRows: appendUnique([], result.sessions),
            conversationFeedCursor: result.nextCursor,
            conversationFeedHasMore: result.hasMore,
            conversationFeedLoading: false,
            conversationFeedLoaded: true,
          });
        })
        .catch((error: unknown) => {
          if (generation !== requestGeneration) return;
          const message = error instanceof Error ? error.message : String(error);
          logger.error('Failed to fetch conversation feed:', error);
          set({ conversationFeedLoading: false, conversationFeedError: message });
        })
        .finally(() => {
          if (initialRequest === request) initialRequest = null;
        });
      initialRequest = request;
      return request;
    },

    fetchMoreConversationFeed: () => {
      const state = get();
      if (!state.conversationFeedHasMore) return Promise.resolve();
      if (appendRequest) return appendRequest;

      const requestGeneration = generation;
      const cursor = state.conversationFeedCursor;
      set({ conversationFeedLoadingMore: true, conversationFeedError: null });
      const request = api
        .getGlobalSessionsPaginated(cursor)
        .then((result) => {
          if (generation !== requestGeneration) return;
          set((current) => ({
            conversationFeedRows: appendUnique(current.conversationFeedRows, result.sessions),
            conversationFeedCursor: result.nextCursor,
            conversationFeedHasMore: result.hasMore,
            conversationFeedLoadingMore: false,
          }));
        })
        .catch((error: unknown) => {
          if (generation !== requestGeneration) return;
          const message = error instanceof Error ? error.message : String(error);
          logger.error('Failed to fetch more conversation feed rows:', error);
          set({ conversationFeedLoadingMore: false, conversationFeedError: message });
        })
        .finally(() => {
          if (appendRequest === request) appendRequest = null;
        });
      appendRequest = request;
      return request;
    },

    clearConversationFeed: () => {
      generation += 1;
      set({
        conversationFeedRows: [],
        conversationFeedCursor: null,
        conversationFeedHasMore: false,
        conversationFeedLoading: false,
        conversationFeedLoadingMore: false,
        conversationFeedLoaded: false,
        conversationFeedError: null,
      });
    },
  };
};
