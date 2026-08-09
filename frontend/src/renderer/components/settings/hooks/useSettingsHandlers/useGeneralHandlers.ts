import { useCallback } from 'react';

import type { SettingsHandlers, UseSettingsHandlersProps } from './types';
import type { AppConfig } from '@renderer/types/data';
import type { UIMode } from '@shared/types';

type GeneralHandlersProps = Pick<UseSettingsHandlersProps, 'updateConfig'>;

export function useGeneralHandlers({
  updateConfig,
}: GeneralHandlersProps): Pick<
  SettingsHandlers,
  'handleGeneralToggle' | 'handleThemeChange' | 'handleDefaultTabChange' | 'handleUIModeChange'
> {
  // ponytail: useCallback required — returned from hook; callers include in dep arrays
  const handleGeneralToggle = useCallback(
    (key: keyof AppConfig['general'], value: boolean) => {
      void updateConfig('general', { [key]: value });
    },
    [updateConfig]
  );

  // ponytail: useCallback required — returned from hook; callers include in dep arrays
  const handleThemeChange = useCallback(
    (value: 'dark' | 'light' | 'system') => {
      void updateConfig('general', { theme: value });
    },
    [updateConfig]
  );

  // ponytail: useCallback required — returned from hook; callers include in dep arrays
  const handleDefaultTabChange = useCallback(
    (value: 'dashboard' | 'last-session') => {
      void updateConfig('general', { defaultTab: value });
    },
    [updateConfig]
  );

  const handleUIModeChange = (value: UIMode): void => {
    void updateConfig('general', { uiMode: value });
  };

  return { handleGeneralToggle, handleThemeChange, handleDefaultTabChange, handleUIModeChange };
}
