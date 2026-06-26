import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { AppConfig } from '@renderer/types/data';
import type {
  CustomTheme,
  FilterPresetEntry,
  FilterPresetPayload,
} from '@shared/types/notifications';
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

  bookmarks: BookmarkEntry[];
  bookmarksLoading: boolean;

  sessionTags: Map<string, string[]>;

  fetchConfig: () => Promise<void>;
  updateConfig: (section: string, data: Record<string, unknown>) => Promise<void>;
  openSettingsTab: (section?: string) => void;
  clearPendingSettingsSection: () => void;

  updateDashboardLayout: (patch: {
    widgetOrder?: string[];
    hiddenWidgets?: string[];
  }) => Promise<void>;

  setShortcutOverride: (actionId: string, combo: string | null) => Promise<void>;
  resetAllShortcuts: () => Promise<void>;

  saveCustomTheme: (theme: CustomTheme) => Promise<void>;
  deleteCustomTheme: (themeId: string) => Promise<void>;
  setActiveTheme: (themeId: string | null) => Promise<void>;

  addFilterPreset: (name: string, filter: FilterPresetPayload) => Promise<FilterPresetEntry>;
  removeFilterPreset: (presetId: string) => Promise<void>;
  renameFilterPreset: (presetId: string, name: string) => Promise<void>;
  setDefaultFilterPreset: (presetId: string | null) => Promise<void>;

  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;

  fetchBookmarks: () => Promise<void>;
  toggleBookmark: (sessionId: string, projectId: string, groupId: string) => Promise<void>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
  isGroupBookmarked: (groupId: string) => boolean;

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

  updateConfig: async (section: string, data: Record<string, unknown>) => {
    try {
      await api.config.update(section, data);
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to update config:', error);
      set({
        configError: error instanceof Error ? error.message : 'Failed to update config',
      });
    }
  },

  openSettingsTab: (section?: string) => {
    const state = get();

    if (section) {
      set({ pendingSettingsSection: section });
    }

    const focusedPane = state.paneLayout.panes.find((p) => p.id === state.paneLayout.focusedPaneId);
    const settingsTab = focusedPane?.tabs.find((t) => t.type === 'settings');
    if (settingsTab) {
      state.setActiveTab(settingsTab.id);
      return;
    }

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

  setShortcutOverride: async (actionId, combo) => {
    try {
      const current = get().appConfig?.shortcuts?.overrides ?? {};
      const next: Record<string, string> = { ...current };
      if (!combo || combo.trim().length === 0) {
        delete next[actionId];
      } else {
        next[actionId] = combo.trim();
      }
      await api.config.update('shortcuts', { overrides: next });
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to update shortcut override:', error);
    }
  },

  resetAllShortcuts: async () => {
    try {
      await api.config.update('shortcuts', { overrides: {} });
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to reset shortcuts:', error);
    }
  },

  saveCustomTheme: async (theme) => {
    try {
      const current = get().appConfig?.themes?.custom ?? [];
      const idx = current.findIndex((t) => t.id === theme.id);
      const next = idx >= 0 ? current.map((t, i) => (i === idx ? theme : t)) : [...current, theme];
      await api.config.update('themes', { custom: next });
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to save custom theme:', error);
    }
  },

  deleteCustomTheme: async (themeId) => {
    try {
      const current = get().appConfig?.themes?.custom ?? [];
      const next = current.filter((t) => t.id !== themeId);
      const activeId = get().appConfig?.themes?.activeId;
      const patch: Record<string, unknown> = { custom: next };
      if (activeId === themeId) patch.activeId = null;
      await api.config.update('themes', patch);
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to delete custom theme:', error);
    }
  },

  setActiveTheme: async (themeId) => {
    try {
      await api.config.update('themes', { activeId: themeId });
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to set active theme:', error);
    }
  },

  addFilterPreset: async (name, filter) => {
    const entry = await api.config.addFilterPreset(name, filter);
    const config = await api.config.get();
    set({ appConfig: config });
    return entry;
  },

  removeFilterPreset: async (presetId) => {
    try {
      await api.config.removeFilterPreset(presetId);
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to remove filter preset:', error);
    }
  },

  renameFilterPreset: async (presetId, name) => {
    try {
      await api.config.renameFilterPreset(presetId, name);
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to rename filter preset:', error);
    }
  },

  setDefaultFilterPreset: async (presetId) => {
    try {
      await api.config.setDefaultFilterPreset(presetId);
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to set default filter preset:', error);
    }
  },

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

  setPluginEnabled: async (pluginId, enabled) => {
    try {
      const current = get().appConfig?.plugins?.enabled ?? [];
      const next = enabled
        ? Array.from(new Set([...current, pluginId]))
        : current.filter((id) => id !== pluginId);
      await api.config.update('plugins', { enabled: next });
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to update plugin enabled state:', error);
    }
  },
});
