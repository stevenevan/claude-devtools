import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import { getSessionResetState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type { RepositoryGroup } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:repository');

export interface RepositorySlice {
  repositoryGroups: RepositoryGroup[];
  selectedRepositoryId: string | null;
  selectedWorktreeId: string | null;
  repositoryGroupsLoading: boolean;
  repositoryGroupsError: string | null;
  viewMode: 'flat' | 'grouped';

  fetchRepositoryGroups: () => Promise<void>;
  selectRepository: (repositoryId: string) => void;
  selectWorktree: (worktreeId: string) => void;
  setViewMode: (mode: 'flat' | 'grouped') => void;
}

export const createRepositorySlice: StateCreator<AppState, [], [], RepositorySlice> = (
  set,
  get
) => ({
  repositoryGroups: [],
  selectedRepositoryId: null,
  selectedWorktreeId: null,
  repositoryGroupsLoading: false,
  repositoryGroupsError: null,
  viewMode: 'flat', // Default to flat view (grouped requires git identity resolution)

  fetchRepositoryGroups: async () => {
    set({ repositoryGroupsLoading: true, repositoryGroupsError: null });
    try {
      const groups = await api.getRepositoryGroups();
      set({
        repositoryGroups: groups,
        repositoryGroupsLoading: false,
        // Fall back to flat view when grouped has no data
        ...(groups.length === 0 && get().viewMode === 'grouped'
          ? { viewMode: 'flat' as const }
          : {}),
      });
    } catch (error) {
      set({
        repositoryGroupsError:
          error instanceof Error ? error.message : 'Failed to fetch repository groups',
        repositoryGroupsLoading: false,
        viewMode: 'flat',
      });
    }
  },

  selectRepository: (repositoryId: string) => {
    const { repositoryGroups } = get();
    const repo = repositoryGroups.find((r) => r.id === repositoryId);

    if (!repo) {
      logger.warn('Repository not found:', repositoryId);
      return;
    }

    // Prefer the "Default" worktree (isMainWorktree); otherwise first worktree (sorted by recency)
    const defaultWorktree = repo.worktrees.find((w) => w.isMainWorktree);
    const worktreeToSelect = defaultWorktree ?? repo.worktrees[0];

    if (worktreeToSelect) {
      set({
        selectedRepositoryId: repositoryId,
        selectedWorktreeId: worktreeToSelect.id,
        selectedProjectId: worktreeToSelect.id,
        activeProjectId: worktreeToSelect.id,
        sidebarCollapsed: false,
        ...getSessionResetState(),
      });
      void get().fetchSessionsInitial(worktreeToSelect.id);
    } else {
      set({
        selectedRepositoryId: repositoryId,
        selectedWorktreeId: null,
        ...getSessionResetState(),
      });
    }
  },

  selectWorktree: (worktreeId: string) => {
    set({
      selectedWorktreeId: worktreeId,
      selectedProjectId: worktreeId,
      activeProjectId: worktreeId,
      ...getSessionResetState(),
    });

    void get().fetchSessionsInitial(worktreeId);
  },

  setViewMode: (mode: 'flat' | 'grouped') => {
    set({
      viewMode: mode,
      selectedRepositoryId: null,
      selectedWorktreeId: null,
      selectedProjectId: null,
      ...getSessionResetState(),
    });

    if (mode === 'grouped') {
      void get().fetchRepositoryGroups();
    } else {
      void get().fetchProjects();
    }
  },
});
