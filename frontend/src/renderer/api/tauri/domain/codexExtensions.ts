import type {
  CodexInspectionContext,
  CodexMcpStatusView,
  CodexPluginList,
  DesktopAPI,
} from '@shared/types/api';

import { call } from '../invoke';

type CodexExtensionsSlice = Pick<
  DesktopAPI,
  'getCodexPlugins' | 'getCodexMcpStatus' | 'openCodexPluginsFolder'
>;

export const codexExtensionsCommands: CodexExtensionsSlice = {
  getCodexPlugins: (context: CodexInspectionContext) =>
    call<CodexPluginList>('get_codex_plugins', { context }),
  getCodexMcpStatus: (context: CodexInspectionContext) =>
    call<CodexMcpStatusView>('get_codex_mcp_status', { context }),
  openCodexPluginsFolder: () => call<void>('open_codex_plugins_folder'),
};
