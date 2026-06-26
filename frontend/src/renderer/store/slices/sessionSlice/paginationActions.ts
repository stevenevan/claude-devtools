import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { SessionSlice, SessionSliceGet, SessionSliceSet } from './types';

const logger = createLogger('Store:session');

// Tracks latest in-place refresh generation per project to guarantee last-write-wins under rapid file change events.
const projectRefreshGeneration = new Map<string, number>();

export function createPaginationActions(
  set: SessionSliceSet,
  get: SessionSliceGet
): Pick<
  SessionSlice,
  | 'fetchSessions'
  | 'fetchSessionsInitial'
  | 'fetchSessionsMore'
  | 'resetSessionsPagination'
  | 'refreshSessionsInPlace'
> {
  return {
    fetchSessions: async (projectId: string) => {
      set({ sessionsLoading: true, sessionsError: null });
      try {
        const sessions = await api.getSessions(projectId);
        const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
        set({ sessions: sorted, sessionsLoading: false });
      } catch (error) {
        set({
          sessionsError: error instanceof Error ? error.message : 'Failed to fetch sessions',
          sessionsLoading: false,
        });
      }
    },

    fetchSessionsInitial: async (projectId: string) => {
      set({
        sessionsLoading: true,
        sessionsError: null,
        sessions: [],
        sessionsCursor: null,
        sessionsHasMore: false,
        sessionsTotalCount: 0,
      });
      try {
        const result = await api.getSessionsPaginated(projectId, null, 20, {
          includeTotalCount: false,
          prefilterAll: false,
          metadataLevel: 'light',
        });
        set({
          sessions: result.sessions,
          sessionsCursor: result.nextCursor,
          sessionsHasMore: result.hasMore,
          sessionsTotalCount: result.totalCount,
          sessionsLoading: false,
        });

        const cacheProjectId = get().selectedProjectId;
        if (cacheProjectId) {
          get()._sessionCache.set(cacheProjectId, {
            sessions: result.sessions,
            cursor: result.nextCursor,
            hasMore: result.hasMore,
            totalCount: result.totalCount,
            timestamp: Date.now(),
          });
        }

        void get().loadPinnedSessions();
        void get().loadHiddenSessions();
      } catch (error) {
        set({
          sessionsError: error instanceof Error ? error.message : 'Failed to fetch sessions',
          sessionsLoading: false,
        });
      }
    },

    fetchSessionsMore: async () => {
      const state = get();
      const { selectedProjectId, sessionsCursor, sessionsHasMore, sessionsLoadingMore } = state;

      if (!selectedProjectId || !sessionsHasMore || sessionsLoadingMore || !sessionsCursor) {
        return;
      }

      set({ sessionsLoadingMore: true });
      try {
        const result = await api.getSessionsPaginated(selectedProjectId, sessionsCursor, 20, {
          includeTotalCount: false,
          prefilterAll: false,
          metadataLevel: 'light',
        });
        const existingIds = new Set(get().sessions.map((s) => s.id));
        const newSessions = result.sessions.filter((s) => !existingIds.has(s.id));
        set((prevState) => {
          // Deduplicate: pinned sessions fetched earlier may appear in paginated results.
          const nextSessions = [...prevState.sessions, ...newSessions];
          const inferredTotalLowerBound = nextSessions.length + (result.hasMore ? 1 : 0);
          const stableTotalCount = Math.max(
            prevState.sessionsTotalCount,
            result.totalCount,
            inferredTotalLowerBound
          );
          return {
            sessions: nextSessions,
            sessionsCursor: result.nextCursor,
            sessionsHasMore: result.hasMore,
            sessionsTotalCount: stableTotalCount,
            sessionsLoadingMore: false,
          };
        });
      } catch (error) {
        set({
          sessionsError: error instanceof Error ? error.message : 'Failed to fetch more sessions',
          sessionsLoadingMore: false,
        });
      }
    },

    resetSessionsPagination: () => {
      set({
        sessions: [],
        sessionsCursor: null,
        sessionsHasMore: false,
        sessionsTotalCount: 0,
        sessionsLoadingMore: false,
        sessionsError: null,
      });
    },

    refreshSessionsInPlace: async (projectId: string) => {
      const currentState = get();

      if (currentState.selectedProjectId !== projectId) {
        return;
      }

      const generation = (projectRefreshGeneration.get(projectId) ?? 0) + 1;
      projectRefreshGeneration.set(projectId, generation);

      try {
        const result = await api.getSessionsPaginated(projectId, null, 20, {
          includeTotalCount: false,
          prefilterAll: false,
          metadataLevel: 'light',
        });

        // Drop stale responses from older in-flight refreshes
        if (projectRefreshGeneration.get(projectId) !== generation) {
          return;
        }

        set({
          sessions: result.sessions,
          sessionsCursor: result.nextCursor,
          sessionsHasMore: result.hasMore,
          sessionsTotalCount: result.totalCount,
        });

        get()._sessionCache.set(projectId, {
          sessions: result.sessions,
          cursor: result.nextCursor,
          hasMore: result.hasMore,
          totalCount: result.totalCount,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error('refreshSessionsInPlace error:', error);
      }
    },
  };
}
