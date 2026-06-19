import { api } from '@renderer/api';
import { logger } from '@renderer/lib/logger';
import { contextStorage } from '@renderer/services/contextStorage';

import { getFullResetState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type { ContextSnapshot } from '@renderer/services/contextStorage';
import type { Project, RepositoryGroup } from '@renderer/types/data';
import type { Pane } from '@renderer/types/panes';
import type { ContextInfo } from '@shared/types/api';
import type { StateCreator } from 'zustand';

export interface ContextSlice {
  activeContextId: string;
  isContextSwitching: boolean;
  targetContextId: string | null;
  contextSnapshotsReady: boolean;
  availableContexts: ContextInfo[];

  switchContext: (targetContextId: string) => Promise<void>;
  initializeContextSystem: () => Promise<void>;
  fetchAvailableContexts: () => Promise<void>;
}

function getEmptyContextState(): Partial<AppState> {
  return {
    ...getFullResetState(),
    projects: [],
    repositoryGroups: [],
    sessions: [],
    notifications: [],
    unreadCount: 0,
    openTabs: [],
    activeTabId: null,
    selectedTabIds: [],
    activeProjectId: null,
    paneLayout: {
      panes: [
        {
          id: 'pane-default',
          tabs: [],
          activeTabId: null,
          selectedTabIds: [],
          widthFraction: 1,
        },
      ],
      focusedPaneId: 'pane-default',
    },
  };
}

function validateSnapshot(
  snapshot: ContextSnapshot,
  freshProjects: Project[],
  freshRepoGroups: RepositoryGroup[]
): Partial<AppState> {
  const validProjectIds = new Set(freshProjects.map((p) => p.id));
  const validWorktreeIds = new Set(freshRepoGroups.flatMap((rg) => rg.worktrees.map((w) => w.id)));

  const selectedProjectId =
    snapshot.selectedProjectId && validProjectIds.has(snapshot.selectedProjectId)
      ? snapshot.selectedProjectId
      : null;

  const selectedRepositoryId = snapshot.selectedRepositoryId; // repos may differ but allow graceful fallback
  const selectedWorktreeId =
    snapshot.selectedWorktreeId && validWorktreeIds.has(snapshot.selectedWorktreeId)
      ? snapshot.selectedWorktreeId
      : null;

  const validTabs = snapshot.openTabs.filter((tab) => {
    if (tab.type === 'session' && tab.projectId) {
      return validProjectIds.has(tab.projectId) || validWorktreeIds.has(tab.projectId);
    }
    return true;
  });

  let activeTabId = snapshot.activeTabId;
  if (activeTabId && !validTabs.find((t) => t.id === activeTabId)) {
    activeTabId = validTabs[0]?.id ?? null;
  }

  const validatedPanes = snapshot.paneLayout.panes
    .map((pane) => {
      const paneTabs = pane.tabs.filter((tab) => {
        if (tab.type === 'session' && tab.projectId) {
          return validProjectIds.has(tab.projectId) || validWorktreeIds.has(tab.projectId);
        }
        return true;
      });
      const paneActiveId = paneTabs.find((t) => t.id === pane.activeTabId)
        ? pane.activeTabId
        : (paneTabs[0]?.id ?? null);
      return {
        ...pane,
        tabs: paneTabs,
        activeTabId: paneActiveId,
        selectedTabIds: pane.selectedTabIds.filter((id) => paneTabs.some((t) => t.id === id)),
      };
    })
    .filter((pane) => pane.tabs.length > 0);

  // Ensure at least one pane exists
  const finalPanes: Pane[] =
    validatedPanes.length > 0
      ? validatedPanes
      : [
          {
            id: 'pane-default',
            tabs: [],
            activeTabId: null,
            selectedTabIds: [],
            widthFraction: 1,
          },
        ];

  return {
    projects: freshProjects,
    selectedProjectId,
    repositoryGroups: freshRepoGroups,
    selectedRepositoryId,
    selectedWorktreeId,
    viewMode: freshRepoGroups.length > 0 ? snapshot.viewMode : 'flat',
    sessions: snapshot.sessions,
    selectedSessionId: snapshot.selectedSessionId,
    sessionsCursor: snapshot.sessionsCursor,
    sessionsHasMore: snapshot.sessionsHasMore,
    sessionsTotalCount: snapshot.sessionsTotalCount,
    pinnedSessionIds: snapshot.pinnedSessionIds,
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    openTabs: validTabs,
    activeTabId,
    selectedTabIds: snapshot.selectedTabIds.filter((id) => validTabs.some((t) => t.id === id)),
    activeProjectId:
      snapshot.activeProjectId &&
      (validProjectIds.has(snapshot.activeProjectId) ||
        validWorktreeIds.has(snapshot.activeProjectId))
        ? snapshot.activeProjectId
        : selectedProjectId,
    paneLayout: {
      panes: finalPanes,
      focusedPaneId: finalPanes.find((p) => p.id === snapshot.paneLayout.focusedPaneId)
        ? snapshot.paneLayout.focusedPaneId
        : finalPanes[0].id,
    },
    sidebarCollapsed: snapshot.sidebarCollapsed,
  };
}

function captureSnapshot(state: AppState, contextId: string): ContextSnapshot {
  return {
    projects: state.projects,
    selectedProjectId: state.selectedProjectId,
    repositoryGroups: state.repositoryGroups,
    selectedRepositoryId: state.selectedRepositoryId,
    selectedWorktreeId: state.selectedWorktreeId,
    viewMode: state.viewMode,
    sessions: state.sessions,
    selectedSessionId: state.selectedSessionId,
    sessionsCursor: state.sessionsCursor,
    sessionsHasMore: state.sessionsHasMore,
    sessionsTotalCount: state.sessionsTotalCount,
    pinnedSessionIds: state.pinnedSessionIds,
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    openTabs: state.openTabs,
    activeTabId: state.activeTabId,
    selectedTabIds: state.selectedTabIds,
    activeProjectId: state.activeProjectId,
    paneLayout: state.paneLayout,
    sidebarCollapsed: state.sidebarCollapsed,
    _metadata: {
      contextId,
      capturedAt: Date.now(),
      version: 1,
    },
  };
}

export const createContextSlice: StateCreator<AppState, [], [], ContextSlice> = (set, get) => ({
  activeContextId: 'local',
  isContextSwitching: false,
  targetContextId: null,
  contextSnapshotsReady: false,
  availableContexts: [{ id: 'local', type: 'local' as const }],

  initializeContextSystem: async () => {
    try {
      const available = await contextStorage.isAvailable();
      if (available) {
        void contextStorage.cleanupExpired();
      }

      const activeContextId = await api.context.getActive();

      set({
        contextSnapshotsReady: true,
        activeContextId,
      });

      await get().fetchAvailableContexts();
    } catch (error) {
      logger.error('failed to initialize context system', { error: String(error) });
      set({ contextSnapshotsReady: true }); // Continue anyway
    }
  },

  fetchAvailableContexts: async () => {
    try {
      const result = await api.context.list();
      set({ availableContexts: result });
    } catch (error) {
      logger.error('failed to fetch available contexts', { error: String(error) });
      set({ availableContexts: [{ id: 'local', type: 'local' }] });
    }
  },

  switchContext: async (targetContextId: string) => {
    const state = get();

    if (targetContextId === state.activeContextId) {
      return;
    }

    // Re-entrancy guard: prevent concurrent switch races from overlapping events
    if (state.isContextSwitching) {
      return;
    }

    set({
      isContextSwitching: true,
      targetContextId,
    });

    try {
      // Step 1: Save current snapshot + load target snapshot + switch main process (parallel)
      const currentSnapshot = captureSnapshot(state, state.activeContextId);
      const [, targetSnapshot] = await Promise.all([
        contextStorage.saveSnapshot(state.activeContextId, currentSnapshot),
        contextStorage.loadSnapshot(targetContextId),
        api.context.switch(targetContextId),
      ]);

      // Step 2: Apply cached snapshot immediately for instant visual feedback.
      if (targetSnapshot) {
        set({
          projects: targetSnapshot.projects,
          repositoryGroups: targetSnapshot.repositoryGroups,
          selectedProjectId: targetSnapshot.selectedProjectId,
          selectedRepositoryId: targetSnapshot.selectedRepositoryId,
          selectedWorktreeId: targetSnapshot.selectedWorktreeId,
          viewMode: targetSnapshot.viewMode,
          sessions: targetSnapshot.sessions,
          selectedSessionId: targetSnapshot.selectedSessionId,
          sessionsCursor: targetSnapshot.sessionsCursor,
          sessionsHasMore: targetSnapshot.sessionsHasMore,
          sessionsTotalCount: targetSnapshot.sessionsTotalCount,
          pinnedSessionIds: targetSnapshot.pinnedSessionIds,
          notifications: targetSnapshot.notifications,
          unreadCount: targetSnapshot.unreadCount,
          openTabs: targetSnapshot.openTabs,
          activeTabId: targetSnapshot.activeTabId,
          selectedTabIds: targetSnapshot.selectedTabIds,
          activeProjectId: targetSnapshot.activeProjectId,
          paneLayout: targetSnapshot.paneLayout,
          sidebarCollapsed: targetSnapshot.sidebarCollapsed,
          activeContextId: targetContextId,
          isContextSwitching: false,
          targetContextId: null,
        });
      }

      // Step 3: Fetch fresh data in background (slow over SSH).
      // Wrapped in try/catch so fetch failures don't wipe valid snapshot data.
      // IPC handlers return [] on SSH scan failure — we must guard against that.
      try {
        const [freshProjects, freshRepoGroups] = await Promise.all([
          api.getProjects(),
          api.getRepositoryGroups(),
        ]);

        if (targetSnapshot) {
          // Guard: don't overwrite snapshot data if fetch returned empty
          // (likely transient SSH scan failure, not genuinely empty workspace)
          const snapshotHadData =
            targetSnapshot.projects.length > 0 || targetSnapshot.repositoryGroups.length > 0;
          const freshIsEmpty = freshProjects.length === 0 && freshRepoGroups.length === 0;

          if (snapshotHadData && freshIsEmpty) {
            logger.warn('background fetch returned empty but snapshot had data — keeping snapshot');
          } else {
            set(validateSnapshot(targetSnapshot, freshProjects, freshRepoGroups));
          }
        } else {
          // No cache (first visit) — apply empty state with fresh data
          set({
            ...getEmptyContextState(),
            projects: freshProjects,
            repositoryGroups: freshRepoGroups,
            activeContextId: targetContextId,
            isContextSwitching: false,
            targetContextId: null,
          });
        }
      } catch (fetchError) {
        logger.error('background data refresh failed', { error: String(fetchError) });
        // Keep snapshot data as fallback — don't wipe user's view
        if (!targetSnapshot) {
          // No snapshot and fetch failed — finalize switch with empty state
          set({
            ...getEmptyContextState(),
            activeContextId: targetContextId,
            isContextSwitching: false,
            targetContextId: null,
          });
        }
      }

      void get().fetchNotifications();
    } catch (error) {
      logger.error('failed to switch context', { error: String(error) });
      set({
        isContextSwitching: false,
        targetContextId: null,
      });
    }
  },
});
