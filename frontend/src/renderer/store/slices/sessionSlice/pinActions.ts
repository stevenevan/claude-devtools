import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { SessionSlice, SessionSliceGet, SessionSliceSet } from './types';

const logger = createLogger('Store:session');

export function createPinActions(
  set: SessionSliceSet,
  get: SessionSliceGet
): Pick<SessionSlice, 'togglePinSession' | 'loadPinnedSessions' | 'pinMultipleSessions'> {
  return {
    togglePinSession: async (sessionId: string) => {
      const state = get();
      const projectId = state.selectedProjectId;
      if (!projectId) return;

      const isPinned = state.pinnedSessionIds.includes(sessionId);
      const previousPinnedIds = state.pinnedSessionIds;

      if (isPinned) {
        set({ pinnedSessionIds: previousPinnedIds.filter((id) => id !== sessionId) });
      } else {
        set({ pinnedSessionIds: [sessionId, ...previousPinnedIds] });
      }

      try {
        if (isPinned) {
          await api.config.unpinSession(projectId, sessionId);
        } else {
          await api.config.pinSession(projectId, sessionId);
        }
      } catch (error) {
        // Rollback on failure
        set({ pinnedSessionIds: previousPinnedIds });
        logger.error('togglePinSession error:', error);
      }
    },

    // Fetches missing pinned session data that may be beyond the paginated page
    loadPinnedSessions: async () => {
      const state = get();
      const projectId = state.selectedProjectId;
      if (!projectId) {
        set({ pinnedSessionIds: [] });
        return;
      }

      try {
        const config = await api.config.get();
        const pins = config.sessions?.pinnedSessions?.[projectId] ?? [];
        const pinnedIds = pins.map((p) => p.sessionId);
        set({ pinnedSessionIds: pinnedIds });

        const currentSessions = get().sessions;
        const loadedIds = new Set(currentSessions.map((s) => s.id));
        const missingIds = pinnedIds.filter((id) => !loadedIds.has(id));

        if (missingIds.length > 0) {
          const missingSessions = await api.getSessionsByIds(projectId, missingIds, {
            metadataLevel: 'light',
          });
          if (missingSessions.length > 0) {
            const latestSessions = get().sessions;
            const latestIds = new Set(latestSessions.map((s) => s.id));
            const toAppend = missingSessions.filter((s) => !latestIds.has(s.id));
            if (toAppend.length > 0) {
              set({ sessions: [...latestSessions, ...toAppend] });
            }
          }
        }
      } catch (error) {
        logger.error('loadPinnedSessions error:', error);
        set({ pinnedSessionIds: [] });
      }
    },

    pinMultipleSessions: async (sessionIds: string[]) => {
      const state = get();
      const projectId = state.selectedProjectId;
      if (!projectId || sessionIds.length === 0) return;

      const previousPinnedIds = state.pinnedSessionIds;
      const existingSet = new Set(previousPinnedIds);
      const newIds = sessionIds.filter((id) => !existingSet.has(id));

      // Optimistic update
      set({ pinnedSessionIds: [...newIds, ...previousPinnedIds] });

      try {
        await Promise.all(newIds.map((sessionId) => api.config.pinSession(projectId, sessionId)));
      } catch (error) {
        set({ pinnedSessionIds: previousPinnedIds });
        logger.error('pinMultipleSessions error:', error);
      }
    },
  };
}
