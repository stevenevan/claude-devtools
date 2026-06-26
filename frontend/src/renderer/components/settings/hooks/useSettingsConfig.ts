import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import type { AppConfig } from '@renderer/types/data';

// Zustand's setState is a plain function; binding keeps oxlint happy.
const setStoreState = useStore.setState.bind(useStore);

export interface RepositoryDropdownItem {
  id: string;
  name: string;
  path: string;
  worktreeCount: number;
  totalSessions: number;
}

export interface SafeConfig {
  general: {
    launchAtLogin: boolean;
    theme: 'dark' | 'light' | 'system';
    defaultTab: 'dashboard' | 'last-session';
    claudeRootPath: string | null;
    autoExpandAIGroups: boolean;
    useNativeTitleBar: boolean;
  };
  notifications: {
    enabled: boolean;
    soundEnabled: boolean;
    ignoredRegex: string[];
    ignoredRepositories: string[];
    snoozedUntil: number | null;
    snoozeMinutes: number;
    includeSubagentErrors: boolean;
    triggers: AppConfig['notifications']['triggers'];
  };
  display: {
    codeBlockTheme: string;
    showLineNumbers: boolean;
    wordWrap: boolean;
  };
}

interface UseSettingsConfigReturn {
  config: AppConfig | null;
  safeConfig: SafeConfig;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  setSaving: (saving: boolean) => void;
  setConfig: (config: AppConfig | null) => void;
  setOptimisticConfig: React.Dispatch<React.SetStateAction<AppConfig | null>>;
  updateConfig: (
    section: keyof AppConfig,
    data: Partial<AppConfig[keyof AppConfig]>
  ) => Promise<void>;
  ignoredRepositoryItems: RepositoryDropdownItem[];
  excludedRepositoryIds: string[];
  isSnoozed: boolean;
}

export function useSettingsConfig(): UseSettingsConfigReturn {
  const { repositoryGroups, fetchRepositoryGroups } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
    }))
  );

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [optimisticConfig, setOptimisticConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    const loadConfig = async (): Promise<void> => {
      try {
        setLoading(true);
        setError(null);
        const loadedConfig = await api.config.get();
        setConfig(loadedConfig);
        setOptimisticConfig(loadedConfig);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };

    void loadConfig();
  }, []);

  useEffect(() => {
    if (repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    }
  }, [repositoryGroups.length, fetchRepositoryGroups]);

  const updateConfig = useCallback(
    async (section: keyof AppConfig, data: Partial<AppConfig[keyof AppConfig]>) => {
      // Optimistic update - immediately reflect the change in UI
      setOptimisticConfig((prev) => {
        if (!prev) return prev;
        const current = prev[section];
        const merged =
          current !== null && typeof current === 'object' && !Array.isArray(current)
            ? { ...(current as object), ...(data as object) }
            : data;
        return {
          ...prev,
          [section]: merged,
        };
      });

      try {
        setSaving(true);
        const updatedConfig = await api.config.update(section, data as object);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        // Update global store so other components (like useTheme) see the change
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        // Revert optimistic update on error
        setOptimisticConfig(config);
        setError(err instanceof Error ? err.message : 'Failed to save settings');
      } finally {
        setSaving(false);
      }
    },
    [config]
  );

  const displayConfig = optimisticConfig ?? config;
  const safeConfig = useMemo(
    (): SafeConfig => ({
      general: {
        launchAtLogin: displayConfig?.general?.launchAtLogin ?? false,
        theme: displayConfig?.general?.theme ?? 'dark',
        defaultTab: displayConfig?.general?.defaultTab ?? 'dashboard',
        claudeRootPath: displayConfig?.general?.claudeRootPath ?? null,
        autoExpandAIGroups: displayConfig?.general?.autoExpandAIGroups ?? false,
        useNativeTitleBar: displayConfig?.general?.useNativeTitleBar ?? false,
      },
      notifications: {
        enabled: displayConfig?.notifications?.enabled ?? true,
        soundEnabled: displayConfig?.notifications?.soundEnabled ?? true,
        ignoredRegex: displayConfig?.notifications?.ignoredRegex ?? [],
        ignoredRepositories: displayConfig?.notifications?.ignoredRepositories ?? [],
        snoozedUntil: displayConfig?.notifications?.snoozedUntil ?? null,
        snoozeMinutes: displayConfig?.notifications?.snoozeMinutes ?? 30,
        includeSubagentErrors: displayConfig?.notifications?.includeSubagentErrors ?? true,
        triggers: displayConfig?.notifications?.triggers ?? [],
      },
      display: {
        codeBlockTheme: displayConfig?.display?.codeBlockTheme ?? 'default',
        showLineNumbers: displayConfig?.display?.showLineNumbers ?? true,
        wordWrap: displayConfig?.display?.wordWrap ?? false,
      },
    }),
    [displayConfig]
  );

  const ignoredRepositoryItems = useMemo((): RepositoryDropdownItem[] => {
    const items: RepositoryDropdownItem[] = [];
    const ignoredRepositories = safeConfig.notifications.ignoredRepositories;

    for (const repositoryId of ignoredRepositories) {
      const group = repositoryGroups.find((g) => g.id === repositoryId);
      if (group) {
        items.push({
          id: group.id,
          name: group.name,
          path: group.worktrees[0]?.path ?? '',
          worktreeCount: group.worktrees.length,
          totalSessions: group.totalSessions,
        });
      } else {
        items.push({
          id: repositoryId,
          name: repositoryId,
          path: '',
          worktreeCount: 0,
          totalSessions: 0,
        });
      }
    }

    return items;
  }, [safeConfig.notifications.ignoredRepositories, repositoryGroups]);

  const excludedRepositoryIds = safeConfig.notifications.ignoredRepositories;
  const isSnoozed =
    safeConfig.notifications.snoozedUntil !== null &&
    safeConfig.notifications.snoozedUntil > Date.now();

  return {
    config,
    safeConfig,
    loading,
    saving,
    error,
    setError,
    setSaving,
    setConfig,
    setOptimisticConfig,
    updateConfig,
    ignoredRepositoryItems,
    excludedRepositoryIds,
    isSnoozed,
  };
}
