
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
  const targetChanged =
    state.selectedProjectId !== projectId || state.selectedSessionId !== sessionId;

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
      activeProjectId: projectId,
      selectedProjectId: projectId,
    });
    if (worktreeChanged) {
      void get().fetchSessionsInitial(projectId);
    }
  } else {
    const project = state.projects.find((candidate) => candidate.id === projectId);
    const projectChanged = state.selectedProjectId !== projectId;
    set({
      activeProjectId: projectId,
      selectedProjectId: projectId,
      selectedSessionId: sessionId,
    });
    if (project && projectChanged) {
      void get().fetchSessionsInitial(projectId);
    }
  }

  if (hasCachedData) {
    if (targetChanged) {
      applyCachedTabData(set, cachedTabData);
    }
  } else if (!cachedTabData?.sessionDetailLoading) {
    void get().fetchSessionDetail(projectId, sessionId, tabId);
  }
}
