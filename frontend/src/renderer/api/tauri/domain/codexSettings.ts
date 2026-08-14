import type {
  CodexSettingsApplyResult,
  CodexSettingsContext,
  CodexSettingsPatch,
  CodexSettingsPreviewResult,
  CodexSettingsView,
  DesktopAPI,
} from '@shared/types/api';

import { call } from '../invoke';

type CodexSettingsSlice = Pick<
  DesktopAPI,
  | 'getCodexSettings'
  | 'openCodexConfigFolder'
  | 'previewCodexSettingsPatch'
  | 'applyCodexSettingsPatch'
>;

export const codexSettingsCommands: CodexSettingsSlice = {
  getCodexSettings: (context: CodexSettingsContext) =>
    call<CodexSettingsView>('get_codex_settings', { context }),
  openCodexConfigFolder: () => call<void>('open_codex_config_folder'),
  previewCodexSettingsPatch: (context: CodexSettingsContext, patch: CodexSettingsPatch, expectedRevision: string) =>
    call<CodexSettingsPreviewResult>('preview_codex_settings_patch', {
      context,
      patch,
      expectedRevision,
    }),
  applyCodexSettingsPatch: (context: CodexSettingsContext, patch: CodexSettingsPatch, expectedRevision: string) =>
    call<CodexSettingsApplyResult>('apply_codex_settings_patch', {
      context,
      patch,
      expectedRevision,
    }),
};
