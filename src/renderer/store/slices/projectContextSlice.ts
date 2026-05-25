/**
 * Project context slice — owns the `activeProjectId` and the two
 * actions that flip the user between project-list and a single project.
 *
 * Lives alongside tabSlice but isolated so tab logic stays focused on
 * tabs / panes.
 */
import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

export interface ProjectContextSlice {
  activeProjectId: string | null;
  setActiveProject: (projectId: string) => void;
  clearActiveProject: () => void;
}

export const createProjectContextSlice: StateCreator<AppState, [], [], ProjectContextSlice> = (
  set,
  get
) => ({
  activeProjectId: null,

  setActiveProject: (projectId: string) => {
    set({ activeProjectId: projectId });
    get().selectProject(projectId);
  },

  clearActiveProject: () => {
    set({
      activeProjectId: null,
      selectedProjectId: null,
      selectedRepositoryId: null,
      selectedWorktreeId: null,
    });
  },
});
