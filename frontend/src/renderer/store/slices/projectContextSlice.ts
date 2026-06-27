
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
