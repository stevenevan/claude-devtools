import type { SessionFilterState, SessionSlice, SessionSliceSet } from './types';

export function createFilterActions(
  set: SessionSliceSet
): Pick<SessionSlice, 'setFilter' | 'clearFilters' | 'applyFilterPreset'> {
  return {
    setFilter: (patch: Partial<SessionFilterState>) => {
      set((state) => ({ activeFilters: { ...state.activeFilters, ...patch } }));
    },
    clearFilters: () => {
      set({ activeFilters: {} });
    },
    applyFilterPreset: (filter: SessionFilterState) => {
      set({ activeFilters: { ...filter } });
    },
  };
}
