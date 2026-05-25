import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';

import { SettingRow, SettingsSectionHeader } from '../../components';

import { CODE_BLOCK_THEME_OPTIONS } from './constants';

import type { SafeConfig } from '../../hooks/useSettingsConfig';
import type { AppConfig } from '@shared/types/notifications';

interface CodeBlocksSubsectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onDisplayToggle: (key: keyof AppConfig['display'], value: boolean) => void;
  readonly onCodeBlockThemeChange: (value: string) => void;
}

export const CodeBlocksSubsection = ({
  safeConfig,
  saving,
  onDisplayToggle,
  onCodeBlockThemeChange,
}: CodeBlocksSubsectionProps): React.JSX.Element => {
  return (
    <>
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
    </>
  );
};
