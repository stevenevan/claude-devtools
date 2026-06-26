import { createLogger } from '@shared/utils/logger';

import type { SessionSlice, SessionSliceGet, SessionSliceSet } from './types';

const logger = createLogger('Store:session');

export function createSelectionActions(
  set: SessionSliceSet,
  get: SessionSliceGet
): Pick<SessionSlice, 'selectSession' | 'clearSelection'> {
  return {
    // Select a session and fetch its detail
    selectSession: (id: string) => {
      set({
        selectedSessionId: id,
        sessionDetail: null,
        sessionContextStats: null,
        sessionDetailError: null,
      });

      // Fetch detail for this session, passing the active tabId for per-tab data
      const state = get();
      const projectId = state.selectedProjectId;
      if (projectId) {
        const activeTabId = state.activeTabId ?? undefined;
        void state.fetchSessionDetail(projectId, id, activeTabId);
      } else {
        logger.warn('Cannot fetch session detail: no project selected');
      }
    },

    // Clear all selections
    clearSelection: () => {
      set({
        selectedProjectId: null,
        selectedSessionId: null,
        sessions: [],
        sessionDetail: null,
        sessionContextStats: null,
      });
    },
  };
}
