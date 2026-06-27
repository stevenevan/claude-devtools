import { JSX } from 'react';
import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';

import { SettingRow, SettingsSectionHeader } from '../../components';

import { THEME_OPTIONS } from './constants';

import type { SafeConfig } from '../../hooks/useSettingsConfig';
import type { AppConfig } from '@shared/types/notifications';

interface AppearanceSubsectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly isElectron: boolean;
  readonly onGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
  readonly onThemeChange: (value: 'dark' | 'light' | 'system') => void;
}

export const AppearanceSubsection = ({
  safeConfig,
  saving,
  isElectron,
  onGeneralToggle,
  onThemeChange,
}: AppearanceSubsectionProps): JSX.Element => {
  return (
    <>
      <SettingsSectionHeader title="Appearance" />
      <SettingRow label="Theme" description="Choose your preferred color theme">
        <Select
          value={safeConfig.general.theme}
          onValueChange={(v) => {
            if (v) onThemeChange(v);
          }}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label="Expand AI responses by default"
        description="Automatically expand each response turn when opening a transcript or receiving a new message"
      >
        <Switch
          checked={safeConfig.general.autoExpandAIGroups ?? false}
          onCheckedChange={(v) => onGeneralToggle('autoExpandAIGroups', v)}
          disabled={saving}
        />
      </SettingRow>
      {isElectron && !window.navigator.userAgent.includes('Macintosh') && (
        <SettingRow
          label="Use native title bar"
          description="Use the default system window frame instead of the custom title bar"
        >
          <Switch
            checked={safeConfig.general.useNativeTitleBar}
            onCheckedChange={async (v) => {
              const shouldRelaunch = await confirm({
                title: 'Restart required',
                message: 'The app needs to restart to apply the title bar change. Restart now?',
                confirmLabel: 'Restart',
              });
              if (shouldRelaunch) {
                onGeneralToggle('useNativeTitleBar', v);
                setTimeout(() => {
                  void api.windowControls?.relaunch();
                }, 200);
              }
            }}
            disabled={saving}
          />
        </SettingRow>
      )}
    </>
  );
};
