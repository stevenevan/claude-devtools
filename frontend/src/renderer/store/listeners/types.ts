export interface ListenerContext {
  cleanupFns: (() => void)[];
  pendingSessionRefreshTimers: Map<string, ReturnType<typeof setTimeout>>;
  pendingProjectRefreshTimers: Map<string, ReturnType<typeof setTimeout>>;
  sessionLastActivityAt: Map<string, number>;
  scheduleSessionRefresh: (projectId: string, sessionId: string) => void;
  scheduleProjectRefresh: (projectId: string) => void;
  markSessionOngoing: (sessionId: string) => void;
  isSessionVisibleInAnyPane: (sessionId: string) => boolean;
  getBaseProjectId: (projectId: string | null | undefined) => string | null;
}
