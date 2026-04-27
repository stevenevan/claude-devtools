/**
 * Config slice - manages app configuration state and actions.
 */

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { AppConfig } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:config');

export interface BookmarkEntry {
  id: string;
  sessionId: string;
  projectId: string;
  groupId: string;
  note?: string;
  createdAt: number;
}

export interface ConfigSlice {
  appConfig: AppConfig | null;
  configLoading: boolean;
  configError: string | null;
  pendingSettingsSection: string | null;

  // Bookmark state
  bookmarks: BookmarkEntry[];
  bookmarksLoading: boolean;

  // Tag state
  sessionTags: Map<string, string[]>;

  fetchConfig: () => Promise<void>;
  updateConfig: (section: string, data: Record<string, unknown>) => Promise<void>;
  openSettingsTab: (section?: string) => void;
  clearPendingSettingsSection: () => void;

  // Dashboard layout (sprint 32)
  updateDashboardLayout: (
    patch: { widgetOrder?: string[]; hiddenWidgets?: string[] }
  ) => Promise<void>;

  // Bookmark actions
  fetchBookmarks: () => Promise<void>;
  toggleBookmark: (sessionId: string, projectId: string, groupId: string) => Promise<void>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
  isGroupBookmarked: (groupId: string) => boolean;

  // Tag actions
  fetchSessionTags: (sessionId: string) => Promise<void>;
  setSessionTags: (sessionId: string, tags: string[]) => Promise<void>;
  getSessionTags: (sessionId: string) => string[];
}

export const createConfigSlice: StateCreator<AppState, [], [], ConfigSlice> = (set, get) => ({
  appConfig: null,
  configLoading: false,
  configError: null,
  pendingSettingsSection: null,
  bookmarks: [],
  bookmarksLoading: false,
  sessionTags: new Map(),

  // Fetch app configuration from main process
  fetchConfig: async () => {
    set({ configLoading: true, configError: null });
    try {
      const config = await api.config.get();
      set({
        appConfig: config,
        configLoading: false,
      });
    } catch (error) {
      set({
        configError: error instanceof Error ? error.message : 'Failed to fetch config',
        configLoading: false,
      });
    }
  },

  // Update a section of the app configuration
  updateConfig: async (section: string, data: Record<string, unknown>) => {
    try {
      await api.config.update(section, data);
      // Refresh config after update
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to update config:', error);
      set({
        configError: error instanceof Error ? error.message : 'Failed to update config',
      });
    }
  },

  // Open or focus the settings tab (per-pane singleton)
  openSettingsTab: (section?: string) => {
    const state = get();

    if (section) {
      set({ pendingSettingsSection: section });
    }

    // Check if settings tab exists in focused pane
    const focusedPane = state.paneLayout.panes.find((p) => p.id === state.paneLayout.focusedPaneId);
    const settingsTab = focusedPane?.tabs.find((t) => t.type === 'settings');
    if (settingsTab) {
      state.setActiveTab(settingsTab.id);
      return;
    }

    // Create new settings tab via openTab (which adds to focused pane)
    state.openTab({
      type: 'settings',
      label: 'Settings',
    });
  },

  clearPendingSettingsSection: () => {
    set({ pendingSettingsSection: null });
  },

  updateDashboardLayout: async (patch) => {
    try {
      await api.config.update('dashboard', patch as Record<string, unknown>);
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to update dashboard layout:', error);
    }
  },

  // Bookmark actions
  fetchBookmarks: async () => {
    set({ bookmarksLoading: true });
    try {
      const bookmarks = await api.config.getBookmarks();
      set({ bookmarks, bookmarksLoading: false });
    } catch (error) {
      logger.error('Failed to fetch bookmarks:', error);
      set({ bookmarksLoading: false });
    }
  },

  toggleBookmark: async (sessionId: string, projectId: string, groupId: string) => {
    const existing = get().bookmarks.find(
      (b) => b.groupId === groupId && b.sessionId === sessionId
    );
    try {
      if (existing) {
        await api.config.removeBookmark(existing.id);
        set({ bookmarks: get().bookmarks.filter((b) => b.id !== existing.id) });
      } else {
        await api.config.addBookmark(sessionId, projectId, groupId);
        const bookmarks = await api.config.getBookmarks();
        set({ bookmarks });
      }
    } catch (error) {
      logger.error('Failed to toggle bookmark:', error);
    }
  },

  removeBookmark: async (bookmarkId: string) => {
    try {
      await api.config.removeBookmark(bookmarkId);
      set({ bookmarks: get().bookmarks.filter((b) => b.id !== bookmarkId) });
    } catch (error) {
      logger.error('Failed to remove bookmark:', error);
    }
  },

  isGroupBookmarked: (groupId: string) => {
    return get().bookmarks.some((b) => b.groupId === groupId);
  },

  // Tag actions
  fetchSessionTags: async (sessionId: string) => {
    try {
      const tags = await api.config.getSessionTags(sessionId);
      const newMap = new Map(get().sessionTags);
      newMap.set(sessionId, tags);
      set({ sessionTags: newMap });
    } catch (error) {
      logger.error('Failed to fetch session tags:', error);
    }
  },

  setSessionTags: async (sessionId: string, tags: string[]) => {
    try {
      await api.config.setSessionTags(sessionId, tags);
      const newMap = new Map(get().sessionTags);
      newMap.set(sessionId, tags);
      set({ sessionTags: newMap });
    } catch (error) {
      logger.error('Failed to set session tags:', error);
    }
  },

  getSessionTags: (sessionId: string) => {
    return get().sessionTags.get(sessionId) ?? [];
  },
});
