import type { AppState } from '../types';

export function getSessionResetState(): Partial<AppState> {
  return {
    selectedSessionId: null,
    sessionDetail: null,
    sessionContextStats: null,
    sessions: [],
    sessionsError: null,
    sessionsCursor: null,
    sessionsHasMore: false,
    sessionsTotalCount: 0,
    sessionsLoadingMore: false,
  };
}

export function getFullResetState(): Partial<AppState> {
  return {
    ...getSessionResetState(),
    selectedRepositoryId: null,
    selectedWorktreeId: null,
    selectedProjectId: null,
    activeProjectId: null,
    conversation: null,
    visibleAIGroupId: null,
    selectedAIGroup: null,
    sessionClaudeMdStats: null,
  };
}
