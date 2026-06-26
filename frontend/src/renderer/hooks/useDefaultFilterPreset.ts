import { useEffect } from 'react';

import { useStore } from '@renderer/store';
import { parseFilterPayload } from '@renderer/utils/filterPresetSerialization';

let didAutoApply = false;

export function useDefaultFilterPreset(): void {
  useEffect(() => {
    if (didAutoApply) return;
    const state = useStore.getState();
    if (Object.keys(state.activeFilters).length > 0) {
      didAutoApply = true;
      return;
    }
    const presets = state.appConfig?.sessions?.filterPresets;
    const defaultId = state.appConfig?.sessions?.defaultFilterPresetId;
    if (!presets || !defaultId) return;
    const preset = presets.find((p) => p.id === defaultId);
    if (!preset) return;
    const filter = parseFilterPayload(preset.filter);
    if (filter === null) return;
    state.applyFilterPreset(filter);
    didAutoApply = true;
  }, []);
}
