// MUST be called exactly once per app lifecycle. Calling twice leaks setInterval
// and duplicates timer Maps.

import { useStore } from '../useStore';

const SESSION_REFRESH_DEBOUNCE_MS = 150;
const PROJECT_REFRESH_DEBOUNCE_MS = 300;

// Track file activity per session for optimistic isOngoing detection.
// When a file change arrives for a known session, we mark it as ongoing immediately.
// After ONGOING_STALE_MS without activity, we clear the ongoing flag.
const ONGOING_STALE_MS = 60_000;
const ONGOING_CHECK_INTERVAL_MS = 15_000;

export interface RefreshHelpers {
  pendingSessionRefreshTimers: Map<string, ReturnType<typeof setTimeout>>;
  pendingProjectRefreshTimers: Map<string, ReturnType<typeof setTimeout>>;
  sessionLastActivityAt: Map<string, number>;
  ongoingCheckInterval: ReturnType<typeof setInterval>;
  scheduleSessionRefresh: (projectId: string, sessionId: string) => void;
  scheduleProjectRefresh: (projectId: string) => void;
  markSessionOngoing: (sessionId: string) => void;
  isSessionVisibleInAnyPane: (sessionId: string) => boolean;
  getBaseProjectId: (projectId: string | null | undefined) => string | null;
}

export function createRefreshHelpers(): RefreshHelpers {
  const pendingSessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingProjectRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const sessionLastActivityAt = new Map<string, number>();

  /** Mark a known sidebar session as ongoing and record activity time. */
  const markSessionOngoing = (sessionId: string): void => {
    sessionLastActivityAt.set(sessionId, Date.now());
    const state = useStore.getState();
    const session = state.sessions.find((s) => s.id === sessionId);
    if (session && !session.isOngoing) {
      useStore.setState({
        sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, isOngoing: true } : s)),
      });
    }
  };

  /** Clear isOngoing for sessions with no recent file activity. */
  const clearStaleOngoingSessions = (): void => {
    const now = Date.now();
    const staleSessionIds: string[] = [];
    for (const [sessionId, lastActivity] of sessionLastActivityAt) {
      if (now - lastActivity > ONGOING_STALE_MS) {
        staleSessionIds.push(sessionId);
        sessionLastActivityAt.delete(sessionId);
      }
    }
    if (staleSessionIds.length === 0) return;
    const staleSet = new Set(staleSessionIds);
    const state = useStore.getState();
    const needsUpdate = state.sessions.some((s) => staleSet.has(s.id) && s.isOngoing);
    if (needsUpdate) {
      useStore.setState({
        sessions: state.sessions.map((s) => (staleSet.has(s.id) ? { ...s, isOngoing: false } : s)),
      });
    }
  };

  const ongoingCheckInterval = setInterval(clearStaleOngoingSessions, ONGOING_CHECK_INTERVAL_MS);

  const getBaseProjectId = (projectId: string | null | undefined): string | null => {
    if (!projectId) return null;
    const separatorIndex = projectId.indexOf('::');
    return separatorIndex >= 0 ? projectId.slice(0, separatorIndex) : projectId;
  };

  const scheduleSessionRefresh = (projectId: string, sessionId: string): void => {
    const key = `${projectId}/${sessionId}`;
    // Throttle (not trailing debounce): keep at most one pending refresh per session.
    // Debounce can delay updates indefinitely while the file is continuously appended.
    if (pendingSessionRefreshTimers.has(key)) {
      return;
    }
    const timer = setTimeout(() => {
      pendingSessionRefreshTimers.delete(key);
      const state = useStore.getState();
      void state.refreshSessionInPlace(projectId, sessionId);
    }, SESSION_REFRESH_DEBOUNCE_MS);
    pendingSessionRefreshTimers.set(key, timer);
  };

  const scheduleProjectRefresh = (projectId: string): void => {
    const existingTimer = pendingProjectRefreshTimers.get(projectId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      pendingProjectRefreshTimers.delete(projectId);
      const state = useStore.getState();
      void state.refreshSessionsInPlace(projectId);
    }, PROJECT_REFRESH_DEBOUNCE_MS);
    pendingProjectRefreshTimers.set(projectId, timer);
  };

  /**
   * Check if a session is visible in any pane (not just the focused pane's active tab).
   * This ensures file change and task-list listeners refresh sessions shown in any split pane.
   */
  const isSessionVisibleInAnyPane = (sessionId: string): boolean => {
    const { paneLayout } = useStore.getState();
    return paneLayout.panes.some(
      (pane) =>
        pane.activeTabId != null &&
        pane.tabs.some(
          (tab) =>
            tab.id === pane.activeTabId && tab.type === 'session' && tab.sessionId === sessionId
        )
    );
  };

  return {
    pendingSessionRefreshTimers,
    pendingProjectRefreshTimers,
    sessionLastActivityAt,
    ongoingCheckInterval,
    scheduleSessionRefresh,
    scheduleProjectRefresh,
    markSessionOngoing,
    isSessionVisibleInAnyPane,
    getBaseProjectId,
  };
}
