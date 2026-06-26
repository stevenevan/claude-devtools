import { useMemo } from 'react';

import { isDesktopMode } from '@renderer/api';

import { AppearanceSubsection } from './AppearanceSubsection';
import { ClaudeRootSubsection } from './ClaudeRootSubsection';
import { CodeBlocksSubsection } from './CodeBlocksSubsection';
import { ServerSubsection } from './ServerSubsection';
import { StartupSubsection } from './StartupSubsection';

import type { SafeConfig } from '../../hooks/useSettingsConfig';
import type { AppConfig } from '@shared/types/notifications';

interface GeneralSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
  readonly onThemeChange: (value: 'dark' | 'light' | 'system') => void;
  readonly onDisplayToggle: (key: keyof AppConfig['display'], value: boolean) => void;
  readonly onCodeBlockThemeChange: (value: string) => void;
}

export const GeneralSection = ({
  safeConfig,
  saving,
  onGeneralToggle,
  onThemeChange,
  onDisplayToggle,
  onCodeBlockThemeChange,
}: GeneralSectionProps): React.JSX.Element => {
  const isElectron = useMemo(() => isDesktopMode(), []);

  return (
    <div>
      {isElectron && (
        <StartupSubsection
          safeConfig={safeConfig}
          saving={saving}
          onGeneralToggle={onGeneralToggle}
        />
      )}

      <AppearanceSubsection
        safeConfig={safeConfig}
        saving={saving}
        isElectron={isElectron}
        onGeneralToggle={onGeneralToggle}
        onThemeChange={onThemeChange}
      />

      <CodeBlocksSubsection
        safeConfig={safeConfig}
        saving={saving}
        onDisplayToggle={onDisplayToggle}
        onCodeBlockThemeChange={onCodeBlockThemeChange}
      />

      {isElectron && <ClaudeRootSubsection />}

      <ServerSubsection saving={saving} isElectron={isElectron} />
    </div>
  );
};
