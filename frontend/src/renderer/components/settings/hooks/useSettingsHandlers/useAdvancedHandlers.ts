import { useCallback } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

import type { SettingsHandlers, UseSettingsHandlersProps } from './types';
import type { AppConfig, NotificationTrigger } from '@renderer/types/data';

// Zustand's setState is a plain function; binding keeps oxlint happy.
const setStoreState = useStore.setState.bind(useStore);

type AdvancedHandlersProps = Pick<
  UseSettingsHandlersProps,
  'setSaving' | 'setConfig' | 'setOptimisticConfig' | 'setError'
> & { configRef: React.RefObject<AppConfig | null> };

export function useAdvancedHandlers({
  setSaving,
  setConfig,
  setOptimisticConfig,
  setError,
  configRef,
}: AdvancedHandlersProps): Pick<
  SettingsHandlers,
  'handleResetToDefaults' | 'handleExportConfig' | 'handleImportConfig' | 'handleOpenInEditor'
> {
  const handleResetToDefaults = useCallback(async () => {
    if (!confirm('Are you sure you want to reset all settings to defaults?')) {
      return;
    }
    try {
      setSaving(true);
      const defaultIgnoredRegex = ["The user doesn't want to proceed with this tool use\\."];
      const defaultTriggers: NotificationTrigger[] = [
        {
          id: 'builtin-tool-result-error',
          name: 'Tool Result Error',
          enabled: true,
          contentType: 'tool_result',
          mode: 'error_status',
          requireError: true,
          ignorePatterns: ["The user doesn't want to proceed with this tool use\\."],
          isBuiltin: true,
        },
        {
          id: 'builtin-bash-command',
          name: 'Bash Command Alert for .env files',
          enabled: true,
          contentType: 'tool_use',
          toolName: 'Bash',
          mode: 'content_match',
          matchField: 'command',
          matchPattern: '/.env',
          isBuiltin: true,
        },
      ];
      const defaultConfig: AppConfig = {
        notifications: {
          enabled: true,
          soundEnabled: true,
          ignoredRegex: defaultIgnoredRegex,
          ignoredRepositories: [],
          snoozedUntil: null,
          snoozeMinutes: 30,
          includeSubagentErrors: true,
          triggers: defaultTriggers,
        },
        general: {
          launchAtLogin: false,
          theme: 'dark',
          defaultTab: 'dashboard',
          claudeRootPath: null,
          autoExpandAIGroups: false,
          useNativeTitleBar: false,
        },
        display: {
          codeBlockTheme: 'default',
          showLineNumbers: true,
          wordWrap: false,
        },
        sessions: {
          pinnedSessions: {},
          hiddenSessions: {},
        },
      };

      await api.config.update('notifications', defaultConfig.notifications);
      await api.config.update('general', defaultConfig.general);
      const updatedConfig = await api.config.update('display', defaultConfig.display);
      setConfig(updatedConfig);
      setOptimisticConfig(updatedConfig);
      setStoreState({ appConfig: updatedConfig });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset settings');
    } finally {
      setSaving(false);
    }
  }, [setSaving, setConfig, setOptimisticConfig, setError]);

  const handleExportConfig = useCallback(() => {
    if (!configRef.current) return;
    const dataStr = JSON.stringify(configRef.current, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'claude-devtools-config.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [configRef]);

  const handleOpenInEditor = useCallback(async () => {
    try {
      await api.config.openInEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open config in editor');
    }
  }, [setError]);

  const handleImportConfig = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        setSaving(true);
        const text = await file.text();
        const importedConfig = JSON.parse(text) as AppConfig;

        if (importedConfig.notifications) {
          await api.config.update('notifications', importedConfig.notifications);
        }
        if (importedConfig.general) {
          await api.config.update('general', importedConfig.general);
        }
        if (importedConfig.display) {
          await api.config.update('display', importedConfig.display);
        }

        const updatedConfig = await api.config.get();
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import config');
      } finally {
        setSaving(false);
      }
    };
    input.click();
  }, [setSaving, setConfig, setOptimisticConfig, setError]);

  return { handleResetToDefaults, handleExportConfig, handleImportConfig, handleOpenInEditor };
}
