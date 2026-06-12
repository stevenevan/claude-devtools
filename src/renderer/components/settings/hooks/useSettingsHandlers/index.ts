/**
 * useSettingsHandlers - Hook for all settings action handlers.
 * Groups handlers by section for better organization.
 */

import { useRef } from 'react';

import { useAdvancedHandlers } from './useAdvancedHandlers';
import { useDisplayHandlers } from './useDisplayHandlers';
import { useGeneralHandlers } from './useGeneralHandlers';
import { useNotificationHandlers } from './useNotificationHandlers';
import { useTriggerHandlers } from './useTriggerHandlers';

import type { SettingsHandlers, UseSettingsHandlersProps } from './types';

export function useSettingsHandlers({
  config,
  setSaving,
  setError,
  setConfig,
  setOptimisticConfig,
  updateConfig,
}: UseSettingsHandlersProps): SettingsHandlers {
  // Use ref for config to avoid recreating callbacks when config changes
  const configRef = useRef(config);
  configRef.current = config;

  const general = useGeneralHandlers({ updateConfig });
  const notification = useNotificationHandlers({
    updateConfig,
    setSaving,
    setConfig,
    setOptimisticConfig,
    setError,
  });
  const trigger = useTriggerHandlers({
    setSaving,
    setConfig,
    setOptimisticConfig,
    setError,
    configRef,
  });
  const display = useDisplayHandlers({ updateConfig });
  const advanced = useAdvancedHandlers({
    setSaving,
    setConfig,
    setOptimisticConfig,
    setError,
    configRef,
  });

  return { ...general, ...notification, ...trigger, ...display, ...advanced };
}
