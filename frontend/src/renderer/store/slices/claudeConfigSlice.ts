

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { GlobalPlugin, GlobalSettingsPatch, GlobalSkill } from '@shared/types/api';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:ClaudeConfig');

export interface ClaudeConfigSlice {
  globalSkills: GlobalSkill[];
  globalSkillsLoading: boolean;
  globalSkillsError: string | null;
  fetchGlobalSkills: () => Promise<void>;

  globalPlugins: GlobalPlugin[];
  globalPluginsLoading: boolean;
  globalPluginsError: string | null;
  fetchGlobalPlugins: () => Promise<void>;

  globalSettings: Record<string, unknown> | null;
  globalSettingsLoading: boolean;
  globalSettingsError: string | null;
  fetchGlobalSettings: () => Promise<void>;
  saveGlobalSettings: (patch: GlobalSettingsPatch) => Promise<void>;
}

export const createClaudeConfigSlice: StateCreator<AppState, [], [], ClaudeConfigSlice> = (
  set,
  get
) => ({
  // Skills
  globalSkills: [],
  globalSkillsLoading: false,
  globalSkillsError: null,
  fetchGlobalSkills: async () => {
    if (get().globalSkillsLoading) return;
    set({ globalSkillsLoading: true, globalSkillsError: null });
    try {
      const skills = await api.readGlobalSkills();
      set({ globalSkills: skills, globalSkillsLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch global skills:', message);
      set({ globalSkillsError: message, globalSkillsLoading: false });
    }
  },

  // Plugins
  globalPlugins: [],
  globalPluginsLoading: false,
  globalPluginsError: null,
  fetchGlobalPlugins: async () => {
    if (get().globalPluginsLoading) return;
    set({ globalPluginsLoading: true, globalPluginsError: null });
    try {
      const plugins = await api.readGlobalPlugins();
      set({ globalPlugins: plugins, globalPluginsLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch global plugins:', message);
      set({ globalPluginsError: message, globalPluginsLoading: false });
    }
  },

  // Settings
  globalSettings: null,
  globalSettingsLoading: false,
  globalSettingsError: null,
  fetchGlobalSettings: async () => {
    if (get().globalSettingsLoading) return;
    set({ globalSettingsLoading: true, globalSettingsError: null });
    try {
      const settings = await api.readGlobalSettings();
      set({ globalSettings: settings, globalSettingsLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch global settings:', message);
      set({ globalSettingsError: message, globalSettingsLoading: false });
    }
  },
  saveGlobalSettings: async (patch: GlobalSettingsPatch) => {
    try {
      await api.updateGlobalSettings(patch);
      await get().fetchGlobalSettings();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to save global settings:', message);
      throw error;
    }
  },
});
