import { JSX } from 'react';
import { api, isDesktopMode } from '@renderer/api';
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
import { ClaudeRootSubsection } from './ClaudeRootSubsection';
import { ServerSubsection } from './ServerSubsection';

import { CODE_BLOCK_THEME_OPTIONS, THEME_OPTIONS } from './constants';

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
}: GeneralSectionProps): JSX.Element => {
  const isElectron = isDesktopMode();

  return (
    <div>
      {isElectron && (
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
      )}

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

      <SettingsSectionHeader title="Code Blocks" />
      <SettingRow label="Theme" description="Color scheme for code block backgrounds">
        <Select
          value={safeConfig.display.codeBlockTheme}
          onValueChange={(v) => {
            if (v) onCodeBlockThemeChange(v);
          }}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CODE_BLOCK_THEME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label="Show line numbers"
        description="Display line numbers in the gutter of code blocks"
      >
        <Switch
          checked={safeConfig.display.showLineNumbers}
          onCheckedChange={(v) => onDisplayToggle('showLineNumbers', v)}
          disabled={saving}
        />
      </SettingRow>
      <SettingRow label="Word wrap" description="Wrap long lines instead of horizontal scrolling">
        <Switch
          checked={safeConfig.display.wordWrap}
          onCheckedChange={(v) => onDisplayToggle('wordWrap', v)}
          disabled={saving}
        />
      </SettingRow>

      {isElectron && <ClaudeRootSubsection />}

      <ServerSubsection saving={saving} isElectron={isElectron} />
    </div>
  );
};
