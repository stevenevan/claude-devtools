/**
 * UI slice - manages command palette, sidebar, and activity bar state.
 */

import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Slice Interface
// =============================================================================

export interface UISlice {
  // State
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  activeActivity: ActivityView;

  // Actions
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleSidebar: () => void;
  setActiveActivity: (activity: ActivityView) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set) => ({
  // Initial state
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  activeActivity: 'projects',

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
});
