import { JSX } from 'react';
import { isDesktopMode } from '@renderer/api';
import { buttonVariants } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Label } from '@renderer/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group';
import { Switch } from '@renderer/components/ui/switch';

import { SettingRow, SettingsSectionHeader } from './components';
import { ClaudeRootSubsection } from './sections/GeneralSection/ClaudeRootSubsection';
import { THEME_OPTIONS } from './sections/GeneralSection/constants';

import type { SafeConfig } from './hooks/useSettingsConfig';
import type { AppConfig, UIMode } from '@shared/types/notifications';

interface SimpleSettingsProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
  readonly onThemeChange: (value: 'dark' | 'light' | 'system') => void;
  readonly onDefaultTabChange: (value: 'dashboard' | 'last-session') => void;
  readonly onUIModeChange: (value: UIMode) => void;
  readonly onNotificationToggle: (
    key: 'enabled' | 'soundEnabled' | 'includeSubagentErrors',
    value: boolean
  ) => void;
}

export const SimpleSettings = ({
  safeConfig,
  saving,
  error,
  onGeneralToggle,
  onThemeChange,
  onDefaultTabChange,
  onUIModeChange,
  onNotificationToggle,
}: SimpleSettingsProps): JSX.Element => {
  const isDesktop = isDesktopMode();

  return (
    <div className="space-y-1">
      <div aria-live="polite" className="mb-5 min-h-5 text-xs">
        {saving ? (
          <span className="text-muted-foreground">Saving changes…</span>
        ) : error ? (
          <span className="text-destructive">Could not save changes: {error}</span>
        ) : (
          <span className="text-muted-foreground">Changes save automatically.</span>
        )}
      </div>

      <SettingsSectionHeader title="How this looks" />
      <SettingRow
        label="Interface mode"
        description="Simple keeps everyday tools prominent. Nerd shows every technical control."
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
                id={`simple-settings-interface-mode-${mode}`}
                value={mode}
                className="peer sr-only"
              />
              <Label
                htmlFor={`simple-settings-interface-mode-${mode}`}
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
      <SettingRow label="Theme" description="Choose how the app looks.">
        <Select
          value={safeConfig.general.theme}
          onValueChange={(value) => {
            if (value) onThemeChange(value as 'dark' | 'light' | 'system');
          }}
          disabled={saving}
        >
          <SelectTrigger aria-label="Theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingsSectionHeader title="Alerts" />
      <SettingRow label="Notifications" description="Show notifications when Claude needs your attention.">
        <Switch
          checked={safeConfig.notifications.enabled}
          onCheckedChange={(checked) => onNotificationToggle('enabled', checked)}
          aria-label="Enable notifications"
          disabled={saving}
        />
      </SettingRow>
      <SettingRow label="Notification sound" description="Play a sound when a notification appears.">
        <Switch
          checked={safeConfig.notifications.soundEnabled}
          onCheckedChange={(checked) => onNotificationToggle('soundEnabled', checked)}
          aria-label="Enable notification sound"
          disabled={saving || !safeConfig.notifications.enabled}
        />
      </SettingRow>

      <SettingsSectionHeader title="Starting up" />
      <SettingRow label="Start page" description="Choose where the app opens.">
        <Select
          value={safeConfig.general.defaultTab}
          onValueChange={(value) => {
            if (value === 'dashboard' || value === 'last-session') {
              onDefaultTabChange(value);
            }
          }}
          disabled={saving}
        >
          <SelectTrigger aria-label="Start page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dashboard">Home</SelectItem>
            <SelectItem value="last-session">Last conversation</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {isDesktop && (
        <SettingRow label="Launch at login" description="Open the app when you log in.">
          <Switch
            checked={safeConfig.general.launchAtLogin}
            onCheckedChange={(checked) => onGeneralToggle('launchAtLogin', checked)}
            aria-label="Launch at login"
            disabled={saving}
          />
        </SettingRow>
      )}

      {isDesktop && <ClaudeRootSubsection simple />}
    </div>
  );
};
