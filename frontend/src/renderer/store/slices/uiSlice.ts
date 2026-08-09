import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

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
  | 'search'
  | 'maintenance'
  | 'history'
  | 'transcripts'
  | 'marketplace'
  | 'taskGraph';

export interface UISlice {
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  activeActivity: ActivityView;
  previousActivity: ActivityView;
  isActivityViewActive: boolean;
  shellSearchQuery: string;
  shortcutCheatSheetOpen: boolean;
  helpPanelOpen: boolean;
  contextHeatmapVisible: boolean;
  flameGraphVisible: boolean;
  teamTreeVisible: boolean;
  fileGraphVisible: boolean;

  durationOutlierSessionIds: Set<string>;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleSidebar: () => void;
  setActiveActivity: (activity: ActivityView) => void;
  setShellSearchQuery: (query: string) => void;
  restorePreviousActivity: () => void;
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

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set, get) => ({
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  activeActivity: 'projects',
  previousActivity: 'projects',
  isActivityViewActive: false,
  shellSearchQuery: '',
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
    const state = get();
    set({
      activeActivity: activity,
      previousActivity:
        activity === 'search'
          ? state.activeActivity === 'search'
            ? state.previousActivity
            : state.activeActivity
          : activity,
      isActivityViewActive: true,
      shellSearchQuery: activity === 'search' ? state.shellSearchQuery : '',
    });
  },

  setShellSearchQuery: (query) => {
    const state = get();
    if (!query.trim()) {
      set({
        shellSearchQuery: '',
        activeActivity: state.previousActivity,
        isActivityViewActive: true,
      });
      return;
    }

    set({
      shellSearchQuery: query,
      activeActivity: 'search',
      previousActivity: state.activeActivity === 'search' ? state.previousActivity : state.activeActivity,
      isActivityViewActive: true,
    });
  },

  restorePreviousActivity: () => {
    const { previousActivity } = get();
    set({ activeActivity: previousActivity, isActivityViewActive: true, shellSearchQuery: '' });
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
