import { Switch } from '@renderer/components/ui/switch';

import { SettingRow, SettingsSectionHeader } from '../../components';

import type { SafeConfig } from '../../hooks/useSettingsConfig';
import type { AppConfig } from '@shared/types/notifications';

interface StartupSubsectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
}

export const StartupSubsection = ({
  safeConfig,
  saving,
  onGeneralToggle,
}: StartupSubsectionProps): React.JSX.Element => {
  return (
    <>
      <SettingsSectionHeader title="Startup" />
      <SettingRow label="Launch at login" description="Automatically start the app when you log in">
        <Switch
          checked={safeConfig.general.launchAtLogin}
          onCheckedChange={(v) => onGeneralToggle('launchAtLogin', v)}
          disabled={saving}
        />
      </SettingRow>
    </>
  );
};
