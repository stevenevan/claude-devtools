import { useCallback } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

import type { SettingsHandlers, UseSettingsHandlersProps } from './types';
import type { AppConfig, NotificationTrigger } from '@renderer/types/data';

// Zustand's setState is a plain function; binding keeps oxlint happy.
const setStoreState = useStore.setState.bind(useStore);

type TriggerHandlersProps = Pick<
  UseSettingsHandlersProps,
  'setSaving' | 'setConfig' | 'setOptimisticConfig' | 'setError'
> & { configRef: React.RefObject<AppConfig | null> };

export function useTriggerHandlers({
  setSaving,
  setConfig,
  setOptimisticConfig,
  setError,
  configRef,
}: TriggerHandlersProps): Pick<
  SettingsHandlers,
  'handleAddTrigger' | 'handleUpdateTrigger' | 'handleRemoveTrigger'
> {
  const handleAddTrigger = useCallback(
    async (trigger: Omit<NotificationTrigger, 'isBuiltin'>) => {
      try {
        setSaving(true);
        const updatedConfig = await api.config.addTrigger(trigger);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add trigger');
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setConfig, setOptimisticConfig, setError]
  );

  const handleUpdateTrigger = useCallback(
    async (triggerId: string, updates: Partial<NotificationTrigger>) => {
      setOptimisticConfig((prev) => {
        if (!prev) return prev;
        const updatedTriggers =
          prev.notifications.triggers?.map((t) =>
            t.id === triggerId ? { ...t, ...updates } : t
          ) ?? [];
        return {
          ...prev,
          notifications: {
            ...prev.notifications,
            triggers: updatedTriggers,
          },
        };
      });

      try {
        setSaving(true);
        const updatedConfig = await api.config.updateTrigger(triggerId, updates);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        // Revert via ref to avoid stale closure
        setOptimisticConfig(configRef.current);
        setError(err instanceof Error ? err.message : 'Failed to update trigger');
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setConfig, setOptimisticConfig, setError, configRef]
  );

  const handleRemoveTrigger = useCallback(
    async (triggerId: string) => {
      try {
        setSaving(true);
        const updatedConfig = await api.config.removeTrigger(triggerId);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove trigger');
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setConfig, setOptimisticConfig, setError]
  );

  return { handleAddTrigger, handleUpdateTrigger, handleRemoveTrigger };
}
