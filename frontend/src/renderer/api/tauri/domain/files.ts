import type { ClaudeMdFileInfo, DesktopAPI } from '@shared/types';
import type {
  AgentConfig,
  ClaudeJSONBackup,
  ClaudeJSONCensus,
  DuplicateGroup,
  GlobalPlugin,
  HookView,
  MCPStatusView,
  PermissionRulesView,
  PurgeResult,
  SourcesView,
  StatusLineConfig,
  StatusLineScriptInfo,
  Suggestion,
} from '@shared/types/api';

import { call } from '../invoke';

// Flat FilesService methods (DesktopAPI top-level, W12). Mirrors the legacy filesApi
// (domain/files.ts) method-for-method, routed through the Tauri invoke bridge.
// Only the two backup-list methods revive dates, exactly like the legacy adapter.
type FilesSlice = Pick<
  DesktopAPI,
  | 'validatePath'
  | 'validateMentions'
  | 'readClaudeMdFiles'
  | 'readDirectoryClaudeMd'
  | 'readMentionedFile'
  | 'readAgentConfigs'
  | 'readGlobalPlugins'
  | 'readGlobalSettings'
  | 'updateGlobalSettings'
  | 'readStatusLine'
  | 'updateStatusLine'
  | 'statStatusLineScript'
  | 'revealStatusLineScript'
  | 'readHooks'
  | 'toggleHook'
  | 'setPluginEnabled'
  | 'dedupePlugin'
  | 'detectPluginDuplicates'
  | 'enumerateSettingsSources'
  | 'readClaudeJSON'
  | 'revealClaudeJSONValue'
  | 'readClaudeJSONMasked'
  | 'listClaudeJSONBackups'
  | 'readClaudeJSONBackup'
  | 'purgeClaudeJSONProjects'
  | 'listClaudeJSONAppBackups'
  | 'restoreClaudeJSONAppBackup'
  | 'getMCPStatus'
  | 'addMCPServer'
  | 'updateMCPServer'
  | 'removeMCPServer'
  | 'getPermissionRules'
  | 'addPermissionRule'
  | 'removePermissionRule'
  | 'movePermissionRule'
  | 'analyzePermissionSuggestions'
>;

export const filesCommands: FilesSlice = {
  validatePath: (relativePath, projectPath) =>
    call<{ exists: boolean; isDirectory?: boolean }>('validate_path', {
      relativePath,
      projectPath,
    }),

  validateMentions: (mentions, projectPath) =>
    call<Record<string, boolean>>('validate_mentions', { mentions, projectPath }),

  readClaudeMdFiles: (projectRoot) =>
    call<Record<string, ClaudeMdFileInfo>>('read_claude_md_files', { projectRoot }),

  readDirectoryClaudeMd: (dirPath) =>
    call<ClaudeMdFileInfo>('read_directory_claude_md', { dirPath }),

  readMentionedFile: (absolutePath, projectRoot, maxTokens) =>
    call<ClaudeMdFileInfo | null>('read_mentioned_file', {
      absolutePath,
      projectRoot,
      maxTokens: maxTokens ?? null,
    }),

  readAgentConfigs: (projectRoot) =>
    call<Record<string, AgentConfig>>('read_agent_configs', { projectRoot }),

  readGlobalPlugins: () => call<GlobalPlugin[]>('read_global_plugins'),

  readGlobalSettings: () => call<Record<string, unknown>>('read_global_settings'),

  updateGlobalSettings: (patch) => call<void>('update_global_settings', { patch }),

  readStatusLine: () => call<StatusLineConfig | null>('read_status_line'),
  updateStatusLine: (config) => call<void>('update_status_line', { config }),
  statStatusLineScript: (command) =>
    call<StatusLineScriptInfo>('stat_status_line_script', { command }),
  revealStatusLineScript: (command) => call<void>('reveal_status_line_script', { command }),

  readHooks: () => call<HookView>('read_hooks'),

  toggleHook: (event, matcherIndex, fingerprint, enable) =>
    call<void>('toggle_hook', { event, matcherIndex, fingerprint, enable }),

  setPluginEnabled: (key, enable) => call<void>('set_plugin_enabled', { key, enable }),

  dedupePlugin: (name, keepKey) => call<void>('dedupe_plugin', { name, keepKey }),

  detectPluginDuplicates: () => call<DuplicateGroup[]>('detect_plugin_duplicates'),

  enumerateSettingsSources: (projectRoot) =>
    call<SourcesView>('enumerate_settings_sources', { projectRoot }),

  readClaudeJSON: () => call<ClaudeJSONCensus>('read_claude_json'),

  revealClaudeJSONValue: (keyPath) => call<string>('reveal_claude_json_value', { keyPath }),

  readClaudeJSONMasked: () => call<string>('read_claude_json_masked'),

  listClaudeJSONBackups: () =>
    call<ClaudeJSONBackup[]>('list_claude_json_backups', undefined, { reviveDates: true }),

  readClaudeJSONBackup: (name) => call<string>('read_claude_json_backup', { name }),

  purgeClaudeJSONProjects: (keys) => call<PurgeResult>('purge_claude_json_projects', { keys }),

  listClaudeJSONAppBackups: () =>
    call<ClaudeJSONBackup[]>('list_claude_json_app_backups', undefined, { reviveDates: true }),

  restoreClaudeJSONAppBackup: (name) => call<void>('restore_claude_json_app_backup', { name }),

  getMCPStatus: () => call<MCPStatusView>('get_mcp_status'),

  addMCPServer: (name, config) => call<void>('add_mcp_server', { name, config }),

  updateMCPServer: (name, patch) => call<void>('update_mcp_server', { name, patch }),

  removeMCPServer: (name) => call<void>('remove_mcp_server', { name }),

  getPermissionRules: (projectRoot) =>
    call<PermissionRulesView>('get_permission_rules', { projectRoot }),

  addPermissionRule: (scope, list, rule) =>
    call<void>('add_permission_rule', { scope, list, rule }),

  removePermissionRule: (scope, list, rule) =>
    call<void>('remove_permission_rule', { scope, list, rule }),

  movePermissionRule: (from, to, fromList, toList, rule) =>
    call<void>('move_permission_rule', { from, to, fromList, toList, rule }),

  analyzePermissionSuggestions: (root) =>
    call<Suggestion[]>('analyze_permission_suggestions', { root }),
};
