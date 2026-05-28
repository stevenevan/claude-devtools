import { api } from '@renderer/api';

import { useStore } from '../useStore';

import type { ListenerContext } from './types';

export function attachFileChangeListeners(ctx: ListenerContext): void {
  // Listen for task-list file changes to refresh currently viewed session metadata
  if (api.onTodoChange) {
    const cleanup = api.onTodoChange((event) => {
      if (!event.sessionId || event.type === 'unlink') {
        return;
      }

      const state = useStore.getState();
      const isViewingSession =
        state.selectedSessionId === event.sessionId ||
        ctx.isSessionVisibleInAnyPane(event.sessionId);

      if (isViewingSession) {
        // Find the project ID from any pane's tab that shows this session
        const allTabs = state.getAllPaneTabs();
        const sessionTab = allTabs.find(
          (t) => t.type === 'session' && t.sessionId === event.sessionId
        );
        if (sessionTab?.projectId) {
          ctx.scheduleSessionRefresh(sessionTab.projectId, event.sessionId);
        }
      }

      // Refresh project sessions list if applicable
      const activeTab = state.getActiveTab();
      const activeProjectId =
        activeTab?.type === 'session' && typeof activeTab.projectId === 'string'
          ? activeTab.projectId
          : null;
      if (activeProjectId && activeProjectId === state.selectedProjectId) {
        ctx.scheduleProjectRefresh(activeProjectId);
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

  // Listen for file changes to auto-refresh current session and detect new sessions
  if (api.onFileChange) {
    const cleanup = api.onFileChange((event) => {
      // Skip unlink events
      if (event.type === 'unlink') {
        return;
      }

      const state = useStore.getState();
      const selectedProjectId = state.selectedProjectId;
      const selectedProjectBaseId = ctx.getBaseProjectId(selectedProjectId);
      const eventProjectBaseId = ctx.getBaseProjectId(event.projectId);
      const matchesSelectedProject =
        !!selectedProjectId &&
        (eventProjectBaseId == null || selectedProjectBaseId === eventProjectBaseId);
      const isTopLevelSessionEvent = !event.isSubagent;
      const isUnknownSessionInSidebar =
        event.sessionId == null ||
        !state.sessions.some((session) => session.id === event.sessionId);
      const shouldRefreshForPotentialNewSession =
        isTopLevelSessionEvent &&
        matchesSelectedProject &&
        isUnknownSessionInSidebar &&
        (event.type === 'add' || (state.connectionMode === 'local' && event.type === 'change'));

      // Refresh sidebar session list only when a truly new top-level session appears.
      // Local fs.watch can report "change" before/without "add" for newly created files.
      if (shouldRefreshForPotentialNewSession) {
        if (matchesSelectedProject && selectedProjectId) {
          ctx.scheduleProjectRefresh(selectedProjectId);
        }
      }

      // Optimistically mark known sidebar sessions as ongoing when their file changes.
      // The backend-computed isOngoing (from refreshSessionInPlace) will correct this
      // if needed; the staleness timer handles sessions that stop being active.
      if (
        isTopLevelSessionEvent &&
        matchesSelectedProject &&
        !isUnknownSessionInSidebar &&
        event.sessionId &&
        (event.type === 'change' || event.type === 'add')
      ) {
        ctx.markSessionOngoing(event.sessionId);
      }

      // Keep opened session view in sync on content changes.
      // Some local writers emit rename/add for in-place updates, so include "add".
      if ((event.type === 'change' || event.type === 'add') && selectedProjectId) {
        const activeSessionId = state.selectedSessionId;
        const eventSessionId = event.sessionId;
        const isViewingEventSession =
          !!eventSessionId &&
          (activeSessionId === eventSessionId || ctx.isSessionVisibleInAnyPane(eventSessionId));
        const shouldFallbackRefreshActiveSession =
          matchesSelectedProject && !eventSessionId && !!activeSessionId;
        const sessionIdToRefresh =
          (isViewingEventSession ? eventSessionId : null) ??
          (shouldFallbackRefreshActiveSession ? activeSessionId : null);

        if (sessionIdToRefresh) {
          const allTabs = state.getAllPaneTabs();
          const visibleSessionTab = allTabs.find(
            (tab) => tab.type === 'session' && tab.sessionId === sessionIdToRefresh
          );
          const refreshProjectId = visibleSessionTab?.projectId ?? selectedProjectId;

          // Use refreshSessionInPlace to avoid flickering and preserve UI state
          ctx.scheduleSessionRefresh(refreshProjectId, sessionIdToRefresh);
        }
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }

  // Listen for Ctrl+R / Cmd+R session refresh from main process (fixes #85)
  if (api.onSessionRefresh) {
    const cleanup = api.onSessionRefresh(() => {
      const state = useStore.getState();
      const activeTabId = state.activeTabId;
      const activeTab = activeTabId ? state.openTabs.find((t) => t.id === activeTabId) : null;
      if (activeTab?.type === 'session' && activeTab.projectId && activeTab.sessionId) {
        void Promise.all([
          state.refreshSessionInPlace(activeTab.projectId, activeTab.sessionId),
          state.fetchSessions(activeTab.projectId),
        ]).then(() => {
          window.dispatchEvent(new CustomEvent('session-refresh-scroll-bottom'));
        });
      }
    });
    if (typeof cleanup === 'function') {
      ctx.cleanupFns.push(cleanup);
    }
  }
}
