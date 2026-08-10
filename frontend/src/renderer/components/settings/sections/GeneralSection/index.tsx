import { JSX } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { buttonVariants } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';
import { Switch } from '@renderer/components/ui/switch';

import { SettingRow, SettingsSectionHeader } from '../../components';
import { ClaudeRootSubsection } from './ClaudeRootSubsection';
import { ServerSubsection } from './ServerSubsection';

import { CODE_BLOCK_THEME_OPTIONS, THEME_OPTIONS } from './constants';

import type { SafeConfig } from '../../hooks/useSettingsConfig';
import type { AppConfig, UIMode } from '@shared/types/notifications';

interface GeneralSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
  readonly onThemeChange: (value: 'dark' | 'light' | 'system') => void;
  readonly onUIModeChange: (value: UIMode) => void;
  readonly onDisplayToggle: (key: keyof AppConfig['display'], value: boolean) => void;
  readonly onCodeBlockThemeChange: (value: string) => void;
}

export const GeneralSection = ({
  safeConfig,
  saving,
  onGeneralToggle,
  onThemeChange,
  onUIModeChange,
  onDisplayToggle,
  onCodeBlockThemeChange,
}: GeneralSectionProps): JSX.Element => {
  const isDesktop = isDesktopMode();

  return (
    <div>
      {isDesktop && (
        <>
          <SettingsSectionHeader title="Startup" />
          <SettingRow
            anchorId="settings-launch-at-login"
            label="Launch at login"
            description="Automatically start the app when you log in"
          >
            <Switch
              checked={safeConfig.general.launchAtLogin}
              onCheckedChange={(v) => onGeneralToggle('launchAtLogin', v)}
              disabled={saving}
            />
          </SettingRow>
        </>
      )}

      <SettingsSectionHeader title="Interface" />
      <SettingRow
        anchorId="settings-interface-mode"
        label="Interface mode"
        description="Simple keeps everyday tools prominent. Nerd keeps every workspace control visible."
      >
        <RadioGroup
          value={safeConfig.general.uiMode}
          onValueChange={(value) => {
            if (value === 'simple' || value === 'nerd') onUIModeChange(value);
          }}
          disabled={saving}
          aria-label="Interface mode"
          className="flex w-auto gap-1"
        >
          {(['simple', 'nerd'] as const).map((mode) => (
            <div key={mode} className="flex items-center gap-1">
              <RadioGroupItem
                id={`general-settings-interface-mode-${mode}`}
                value={mode}
                className="peer sr-only"
              />
              <Label
                htmlFor={`general-settings-interface-mode-${mode}`}
                className={cn(
                  buttonVariants({
                    variant: safeConfig.general.uiMode === mode ? 'secondary' : 'outline',
                    size: 'sm',
                  }),
                  'cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30'
                )}
              >
                {mode === 'simple' ? 'Simple' : 'Nerd'}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </SettingRow>

      <SettingsSectionHeader title="Appearance" />
      <SettingRow
        anchorId="settings-theme"
        label="Theme"
        description="Choose your preferred color theme"
      >
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
        anchorId="settings-expand-ai-responses"
        label="Expand AI responses by default"
        description="Automatically expand each response turn when opening a transcript or receiving a new message"
      >
        <Switch
          checked={safeConfig.general.autoExpandAIGroups ?? false}
          onCheckedChange={(v) => onGeneralToggle('autoExpandAIGroups', v)}
          disabled={saving}
        />
      </SettingRow>
      {isDesktop && !window.navigator.userAgent.includes('Macintosh') && (
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
      <SettingRow
        anchorId="settings-code-block-theme"
        label="Code block theme"
        description="Color scheme for code block backgrounds"
      >
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
        anchorId="settings-show-line-numbers"
        label="Show line numbers"
        description="Display line numbers in the gutter of code blocks"
      >
        <Switch
          checked={safeConfig.display.showLineNumbers}
          onCheckedChange={(v) => onDisplayToggle('showLineNumbers', v)}
          disabled={saving}
        />
      </SettingRow>
      <SettingRow
        anchorId="settings-word-wrap"
        label="Word wrap"
        description="Wrap long lines instead of horizontal scrolling"
      >
        <Switch
          checked={safeConfig.display.wordWrap}
          onCheckedChange={(v) => onDisplayToggle('wordWrap', v)}
          disabled={saving}
        />
      </SettingRow>

      {isDesktop && <ClaudeRootSubsection anchorId="settings-claude-root" />}

      <ServerSubsection saving={saving} isDesktop={isDesktop} />
    </div>
  );
};
