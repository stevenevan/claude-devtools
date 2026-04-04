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
  | 'settings'
  | 'notifications'
  | 'search';

export interface UISlice {
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  activeActivity: ActivityView;
  shortcutCheatSheetOpen: boolean;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleSidebar: () => void;
  setActiveActivity: (activity: ActivityView) => void;
  toggleShortcutCheatSheet: () => void;
}

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set) => ({
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  activeActivity: 'projects',
  shortcutCheatSheetOpen: false,

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
});
