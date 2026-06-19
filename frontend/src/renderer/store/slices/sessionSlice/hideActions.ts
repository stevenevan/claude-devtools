import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { SessionSlice, SessionSliceGet, SessionSliceSet } from './types';

const logger = createLogger('Store:session');

export function createHideActions(
  set: SessionSliceSet,
  get: SessionSliceGet
): Pick<
  SessionSlice,
  | 'toggleHideSession'
  | 'hideMultipleSessions'
  | 'unhideMultipleSessions'
  | 'loadHiddenSessions'
  | 'toggleShowHiddenSessions'
> {
  return {
    toggleHideSession: async (sessionId: string) => {
      const state = get();
      const projectId = state.selectedProjectId;
      if (!projectId) return;

      const isHidden = state.hiddenSessionIds.includes(sessionId);
      const previousHiddenIds = state.hiddenSessionIds;

      if (isHidden) {
        set({ hiddenSessionIds: previousHiddenIds.filter((id) => id !== sessionId) });
      } else {
        set({ hiddenSessionIds: [sessionId, ...previousHiddenIds] });
      }

      try {
        if (isHidden) {
          await api.config.unhideSession(projectId, sessionId);
        } else {
          await api.config.hideSession(projectId, sessionId);
        }
      } catch (error) {
        // Rollback on failure
        set({ hiddenSessionIds: previousHiddenIds });
        logger.error('toggleHideSession error:', error);
      }
    },

    hideMultipleSessions: async (sessionIds: string[]) => {
      const state = get();
      const projectId = state.selectedProjectId;
      if (!projectId || sessionIds.length === 0) return;

      const previousHiddenIds = state.hiddenSessionIds;
      const existingSet = new Set(previousHiddenIds);
      const newIds = sessionIds.filter((id) => !existingSet.has(id));

      set({ hiddenSessionIds: [...newIds, ...previousHiddenIds] });

      try {
        await api.config.hideSessions(projectId, sessionIds);
      } catch (error) {
        set({ hiddenSessionIds: previousHiddenIds });
        logger.error('hideMultipleSessions error:', error);
      }
    },

    unhideMultipleSessions: async (sessionIds: string[]) => {
      const state = get();
      const projectId = state.selectedProjectId;
      if (!projectId || sessionIds.length === 0) return;

      const previousHiddenIds = state.hiddenSessionIds;
      const toRemove = new Set(sessionIds);

      set({ hiddenSessionIds: previousHiddenIds.filter((id) => !toRemove.has(id)) });

      try {
        await api.config.unhideSessions(projectId, sessionIds);
      } catch (error) {
        set({ hiddenSessionIds: previousHiddenIds });
        logger.error('unhideMultipleSessions error:', error);
      }
    },

    loadHiddenSessions: async () => {
      const state = get();
      const projectId = state.selectedProjectId;
      if (!projectId) {
        set({ hiddenSessionIds: [] });
        return;
      }

      try {
        const config = await api.config.get();
        const hidden = config.sessions?.hiddenSessions?.[projectId] ?? [];
        const hiddenIds = hidden.map((h) => h.sessionId);
        set({ hiddenSessionIds: hiddenIds });
      } catch (error) {
        logger.error('loadHiddenSessions error:', error);
        set({ hiddenSessionIds: [] });
      }
    },

    toggleShowHiddenSessions: () => {
      set((prev) => ({ showHiddenSessions: !prev.showHiddenSessions }));
    },
  };
}
