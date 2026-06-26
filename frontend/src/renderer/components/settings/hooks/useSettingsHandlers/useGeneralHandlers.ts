import { useCallback } from 'react';

import type { SettingsHandlers, UseSettingsHandlersProps } from './types';
import type { AppConfig } from '@renderer/types/data';

type GeneralHandlersProps = Pick<UseSettingsHandlersProps, 'updateConfig'>;

export function useGeneralHandlers({
  updateConfig,
}: GeneralHandlersProps): Pick<
  SettingsHandlers,
  'handleGeneralToggle' | 'handleThemeChange' | 'handleDefaultTabChange'
> {
  const handleGeneralToggle = useCallback(
    (key: keyof AppConfig['general'], value: boolean) => {
      void updateConfig('general', { [key]: value });
    },
    [updateConfig]
  );

  const handleThemeChange = useCallback(
    (value: 'dark' | 'light' | 'system') => {
      void updateConfig('general', { theme: value });
    },
    [updateConfig]
  );

  const handleDefaultTabChange = useCallback(
    (value: 'dashboard' | 'last-session') => {
      void updateConfig('general', { defaultTab: value });
    },
    [updateConfig]
  );

  return { handleGeneralToggle, handleThemeChange, handleDefaultTabChange };
}
