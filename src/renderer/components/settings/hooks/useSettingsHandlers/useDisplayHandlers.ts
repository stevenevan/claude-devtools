import { useCallback } from 'react';

import type { SettingsHandlers, UseSettingsHandlersProps } from './types';
import type { AppConfig } from '@renderer/types/data';

type DisplayHandlersProps = Pick<UseSettingsHandlersProps, 'updateConfig'>;

export function useDisplayHandlers({
  updateConfig,
}: DisplayHandlersProps): Pick<
  SettingsHandlers,
  'handleDisplayToggle' | 'handleCodeBlockThemeChange'
> {
  const handleDisplayToggle = useCallback(
    (key: keyof AppConfig['display'], value: boolean) => {
      void updateConfig('display', { [key]: value });
    },
    [updateConfig]
  );

  const handleCodeBlockThemeChange = useCallback(
    (value: string) => {
      void updateConfig('display', { codeBlockTheme: value });
    },
    [updateConfig]
  );

  return { handleDisplayToggle, handleCodeBlockThemeChange };
}
