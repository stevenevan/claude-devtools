/**
 * UI slice - manages command palette, sidebar, and activity bar state.
 */

import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

/** Top-level navigation sections in the Activity Bar. */
export type ActivityView =
  | 'projects'
  | 'analytics'
  | 'agents'
  | 'skills'
  | 'plugins'
  | 'annotations'
  | 'todos'
  | 'settings'
  | 'notifications'
  | 'search';

export interface UISlice {
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  activeActivity: ActivityView;
  shortcutCheatSheetOpen: boolean;
  helpPanelOpen: boolean;
  contextHeatmapVisible: boolean;
  flameGraphVisible: boolean;
  teamTreeVisible: boolean;
  fileGraphVisible: boolean;
  /** Session IDs marked as duration outliers (wall > p95 × 1.5). Populated
   * by the DurationPanel effect; sidebar SessionItem reads it for a badge. */
  durationOutlierSessionIds: Set<string>;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleSidebar: () => void;
  setActiveActivity: (activity: ActivityView) => void;
  toggleShortcutCheatSheet: () => void;
  setHelpPanelOpen: (open: boolean) => void;
  toggleContextHeatmap: () => void;
  toggleFlameGraph: () => void;
  setFlameGraphVisible: (visible: boolean) => void;
  toggleTeamTree: () => void;
  toggleFileGraph: () => void;
  setDurationOutlierSessionIds: (ids: string[]) => void;
}

const CONTEXT_HEATMAP_STORAGE_KEY = 'cdt.ui.contextHeatmapVisible';

function loadContextHeatmapVisible(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CONTEXT_HEATMAP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistContextHeatmapVisible(visible: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONTEXT_HEATMAP_STORAGE_KEY, visible ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set) => ({
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  activeActivity: 'projects',
  shortcutCheatSheetOpen: false,
  helpPanelOpen: false,
  contextHeatmapVisible: loadContextHeatmapVisible(),
  flameGraphVisible: false,
  teamTreeVisible: false,
  fileGraphVisible: false,
  durationOutlierSessionIds: new Set<string>(),

  // Command palette actions
  openCommandPalette: () => {
    set({ commandPaletteOpen: true });
  },

  closeCommandPalette: () => {
    set({ commandPaletteOpen: false });
  },

  // Sidebar actions
  toggleSidebar: () => {
    set((state) => {
      const expanding = state.sidebarCollapsed;
      const hasSidebar = state.activeActivity === 'projects';
      if (expanding && !hasSidebar) {
        return { sidebarCollapsed: false, activeActivity: 'projects' };
      }
      return { sidebarCollapsed: !state.sidebarCollapsed };
    });
  },

  // Activity bar actions
  setActiveActivity: (activity) => {
    set({ activeActivity: activity });
  },

  toggleShortcutCheatSheet: () => {
    set((state) => ({ shortcutCheatSheetOpen: !state.shortcutCheatSheetOpen }));
  },

  setHelpPanelOpen: (open) => {
    set({ helpPanelOpen: open });
  },

  toggleContextHeatmap: () => {
    set((state) => {
      const next = !state.contextHeatmapVisible;
      persistContextHeatmapVisible(next);
      return { contextHeatmapVisible: next };
    });
  },

  toggleFlameGraph: () => {
    set((state) => ({ flameGraphVisible: !state.flameGraphVisible }));
  },

  setFlameGraphVisible: (visible) => {
    set({ flameGraphVisible: visible });
  },

  toggleTeamTree: () => {
    set((state) => ({ teamTreeVisible: !state.teamTreeVisible }));
  },

  toggleFileGraph: () => {
    set((state) => ({ fileGraphVisible: !state.fileGraphVisible }));
  },

  setDurationOutlierSessionIds: (ids) => {
    set({ durationOutlierSessionIds: new Set(ids) });
  },
});
