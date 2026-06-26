import type { SessionSlice, SessionSliceSet } from './types';
import type { SessionSortMode } from '@renderer/types/data';

export function createUiActions(
  set: SessionSliceSet
): Pick<
  SessionSlice,
  | 'toggleSidebarSessionSelection'
  | 'clearSidebarSelection'
  | 'toggleSidebarMultiSelect'
  | 'setSessionSortMode'
> {
  return {
    // Toggle one session's checkbox in sidebar multi-select
    toggleSidebarSessionSelection: (sessionId: string) => {
      set((prev) => {
        const selected = prev.sidebarSelectedSessionIds;
        if (selected.includes(sessionId)) {
          return { sidebarSelectedSessionIds: selected.filter((id) => id !== sessionId) };
        }
        return {
          sidebarSelectedSessionIds: [...selected, sessionId],
          sidebarMultiSelectActive: true,
        };
      });
    },

    // Clear all selections and exit multi-select mode
    clearSidebarSelection: () => {
      set({ sidebarSelectedSessionIds: [], sidebarMultiSelectActive: false });
    },

    // Enter/exit selection mode
    toggleSidebarMultiSelect: () => {
      set((prev) => {
        if (prev.sidebarMultiSelectActive) {
          return { sidebarMultiSelectActive: false, sidebarSelectedSessionIds: [] };
        }
        return { sidebarMultiSelectActive: true };
      });
    },

    // Set session sort mode
    setSessionSortMode: (mode: SessionSortMode) => {
      set({ sessionSortMode: mode });
    },
  };
}
