import { useCallback } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

import type { RepositoryDropdownItem } from '../useSettingsConfig';
import type { SettingsHandlers, UseSettingsHandlersProps } from './types';
import type { AppConfig } from '@renderer/types/data';

// Get the setState function from the store to update appConfig globally.
const setStoreState = useStore.setState.bind(useStore);

type NotificationHandlersProps = Pick<
  UseSettingsHandlersProps,
  'updateConfig' | 'setSaving' | 'setConfig' | 'setOptimisticConfig' | 'setError'
>;

export function useNotificationHandlers({
  updateConfig,
  setSaving,
  setConfig,
  setOptimisticConfig,
  setError,
}: NotificationHandlersProps): Pick<
  SettingsHandlers,
  | 'handleNotificationToggle'
  | 'handleSnooze'
  | 'handleClearSnooze'
  | 'handleAddIgnoredRepository'
  | 'handleRemoveIgnoredRepository'
> {
  const handleNotificationToggle = useCallback(
    (key: keyof AppConfig['notifications'], value: boolean) => {
      void updateConfig('notifications', { [key]: value });
    },
    [updateConfig]
  );

  const handleSnooze = useCallback(
    async (minutes: number) => {
      try {
        setSaving(true);
        const updatedConfig = await api.config.snooze(minutes);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to snooze notifications');
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setConfig, setOptimisticConfig, setError]
  );

  const handleClearSnooze = useCallback(async () => {
    try {
      setSaving(true);
      const updatedConfig = await api.config.clearSnooze();
      setConfig(updatedConfig);
      setOptimisticConfig(updatedConfig);
      setStoreState({ appConfig: updatedConfig });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear snooze');
    } finally {
      setSaving(false);
    }
  }, [setSaving, setConfig, setOptimisticConfig, setError]);

  const handleAddIgnoredRepository = useCallback(
    async (item: RepositoryDropdownItem) => {
      try {
        setSaving(true);
        const updatedConfig = await api.config.addIgnoreRepository(item.id);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add repository');
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setConfig, setOptimisticConfig, setError]
  );

  const handleRemoveIgnoredRepository = useCallback(
    async (repositoryId: string) => {
      try {
        setSaving(true);
        const updatedConfig = await api.config.removeIgnoreRepository(repositoryId);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove repository');
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setConfig, setOptimisticConfig, setError]
  );

  return {
    handleNotificationToggle,
    handleSnooze,
    handleClearSnooze,
    handleAddIgnoredRepository,
    handleRemoveIgnoredRepository,
  };
}
