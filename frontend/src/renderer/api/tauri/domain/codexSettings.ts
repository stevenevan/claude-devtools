import type { CodexSettingsContext, CodexSettingsView, DesktopAPI } from '@shared/types/api';

import { call } from '../invoke';

type CodexSettingsSlice = Pick<DesktopAPI, 'getCodexSettings' | 'openCodexConfigFolder'>;

export const codexSettingsCommands: CodexSettingsSlice = {
  getCodexSettings: (context: CodexSettingsContext) =>
    call<CodexSettingsView>('get_codex_settings', { context }),
  openCodexConfigFolder: () => call<void>('open_codex_config_folder'),
};
