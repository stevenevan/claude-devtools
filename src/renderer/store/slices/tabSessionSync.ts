/**
 * Session-sync helper extracted from tabSlice.setActiveTab.
 *
 * When the active tab is a session tab, the global sidebar state
 * (selected repo/worktree/session + active project) needs to match the
 * tab. This file owns that synchronization without dragging it into the
 * already-large tabSlice action.
 */
import type { AppState } from '../types';
import type { Tab } from '@renderer/types/tabs';

type Get = () => AppState;
type Set = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  replace?: false
) => void;

function applyCachedTabData(set: Set, cachedTabData: AppState['tabSessionData'][string]): void {
  set({
    sessionDetail: cachedTabData.sessionDetail,
    conversation: cachedTabData.conversation,
    conversationLoading: false,
    sessionDetailLoading: false,
    sessionDetailError: null,
    sessionClaudeMdStats: cachedTabData.sessionClaudeMdStats,
    sessionContextStats: cachedTabData.sessionContextStats,
    sessionPhaseInfo: cachedTabData.sessionPhaseInfo,
    visibleAIGroupId: cachedTabData.visibleAIGroupId,
    selectedAIGroup: cachedTabData.selectedAIGroup,
  });
}

export function syncSidebarForSessionTab(get: Get, set: Set, tab: Tab, tabId: string): void {
  if (tab.type !== 'session' || !tab.sessionId || !tab.projectId) return;

  const state = get();
  const sessionId = tab.sessionId;
  const projectId = tab.projectId;
  const sessionChanged = state.selectedSessionId !== sessionId;

  const cachedTabData = state.tabSessionData[tabId];
  const hasCachedData = cachedTabData?.conversation != null;

  let foundRepo: string | null = null;
  let foundWorktree: string | null = null;

  for (const repo of state.repositoryGroups) {
    for (const wt of repo.worktrees) {
      if (wt.id === projectId) {
        foundRepo = repo.id;
        foundWorktree = wt.id;
        break;
      }
    }
    if (foundRepo) break;
  }

  if (foundRepo && foundWorktree) {
    const worktreeChanged = state.selectedWorktreeId !== foundWorktree;
    set({
      selectedRepositoryId: foundRepo,
      selectedWorktreeId: foundWorktree,
      selectedSessionId: sessionId,
      activeProjectId: foundWorktree,
      selectedProjectId: foundWorktree,
    });
    if (worktreeChanged) {
      void get().fetchSessionsInitial(foundWorktree);
    }
    if (sessionChanged) {
      if (hasCachedData) {
        applyCachedTabData(set, cachedTabData);
      } else {
        void get().fetchSessionDetail(foundWorktree, sessionId, tabId);
      }
    }
    return;
  }

  const project = state.projects.find(
    (p) => p.id === projectId || p.sessions.includes(sessionId)
  );
  if (project) {
    const projectChanged = state.selectedProjectId !== project.id;
    set({
      activeProjectId: project.id,
      selectedProjectId: project.id,
      selectedSessionId: sessionId,
    });
    if (projectChanged) {
      void get().fetchSessionsInitial(project.id);
    }
    if (sessionChanged) {
      if (hasCachedData) {
        applyCachedTabData(set, cachedTabData);
      } else {
        void get().fetchSessionDetail(project.id, sessionId, tabId);
      }
    }
  }
}
