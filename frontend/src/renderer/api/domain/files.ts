import {
  AddPermissionRule,
  AnalyzePermissionSuggestions,
  DedupePlugin,
  DetectPluginDuplicates,
  EnumerateSettingsSources,
  GetMCPStatus,
  GetPermissionRules,
  ListClaudeJSONAppBackups,
  ListClaudeJSONBackups,
  MovePermissionRule,
  PurgeClaudeJSONProjects,
  ReadAgentConfigs,
  ReadClaudeJSON,
  ReadClaudeJSONBackup,
  ReadClaudeJSONMasked,
  ReadClaudeMdFiles,
  ReadDirectoryClaudeMd,
  ReadGlobalPlugins,
  ReadGlobalSettings,
  ReadHooks,
  ReadMentionedFile,
  RemovePermissionRule,
  RestoreClaudeJSONAppBackup,
  RevealClaudeJSONValue,
  SetPluginEnabled,
  ToggleHook,
  UpdateGlobalSettings,
  ValidateMentions,
  ValidatePath,
} from '../../../../bindings/claude-devtools/internal/filesservice/filesservice';

import { reviveDates } from '../reviveDates';

import type { ClaudeMdFileInfo, WailsAPI } from '@shared/types';
import type {
  AgentConfig,
  ClaudeJSONBackup,
  ClaudeJSONCensus,
  DuplicateGroup,
  GlobalPlugin,
  GlobalSettingsPatch,
  HookView,
  MCPStatusView,
  PermissionRulesView,
  PermissionScope,
  PurgeResult,
  SourcesView,
  Suggestion,
} from '@shared/types/api';

type FilesSlice = Pick<
  WailsAPI,
  | 'validatePath'
  | 'validateMentions'
  | 'readClaudeMdFiles'
  | 'readDirectoryClaudeMd'
  | 'readMentionedFile'
  | 'readAgentConfigs'
  | 'readGlobalPlugins'
  | 'readGlobalSettings'
  | 'updateGlobalSettings'
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
  | 'getPermissionRules'
  | 'addPermissionRule'
  | 'removePermissionRule'
  | 'movePermissionRule'
  | 'analyzePermissionSuggestions'
>;

export const filesApi: FilesSlice = {
  validatePath: (
    relativePath: string,
    projectPath: string
  ): Promise<{ exists: boolean; isDirectory?: boolean }> =>
    ValidatePath(relativePath, projectPath) as unknown as Promise<{
      exists: boolean;
      isDirectory?: boolean;
    }>,

  validateMentions: (
    mentions: { type: 'path'; value: string }[],
    projectPath: string
  ): Promise<Record<string, boolean>> =>
    ValidateMentions(
      mentions as unknown as Parameters<typeof ValidateMentions>[0],
      projectPath
    ) as unknown as Promise<Record<string, boolean>>,

  readClaudeMdFiles: (projectRoot: string): Promise<Record<string, ClaudeMdFileInfo>> =>
    ReadClaudeMdFiles(projectRoot) as unknown as Promise<Record<string, ClaudeMdFileInfo>>,

  readDirectoryClaudeMd: (dirPath: string): Promise<ClaudeMdFileInfo> =>
    ReadDirectoryClaudeMd(dirPath) as unknown as Promise<ClaudeMdFileInfo>,

  readMentionedFile: (
    absolutePath: string,
    projectRoot: string,
    maxTokens?: number
  ): Promise<ClaudeMdFileInfo | null> =>
    ReadMentionedFile(absolutePath, projectRoot, maxTokens ?? null) as unknown as Promise<
      ClaudeMdFileInfo | null
    >,

  readAgentConfigs: (projectRoot: string): Promise<Record<string, AgentConfig>> =>
    ReadAgentConfigs(projectRoot) as unknown as Promise<Record<string, AgentConfig>>,

  readGlobalPlugins: (): Promise<GlobalPlugin[]> =>
    ReadGlobalPlugins() as unknown as Promise<GlobalPlugin[]>,

  readGlobalSettings: (): Promise<Record<string, unknown>> =>
    ReadGlobalSettings() as unknown as Promise<Record<string, unknown>>,

  updateGlobalSettings: (patch: GlobalSettingsPatch): Promise<void> =>
    UpdateGlobalSettings(
      patch as unknown as Parameters<typeof UpdateGlobalSettings>[0]
    ) as unknown as Promise<void>,

  readHooks: (): Promise<HookView> => ReadHooks() as unknown as Promise<HookView>,

  toggleHook: (
    event: string,
    matcherIndex: number,
    fingerprint: string,
    enable: boolean
  ): Promise<void> =>
    ToggleHook(event, matcherIndex, fingerprint, enable) as unknown as Promise<void>,

  setPluginEnabled: (key: string, enable: boolean): Promise<void> =>
    SetPluginEnabled(key, enable) as unknown as Promise<void>,

  dedupePlugin: (name: string, keepKey: string): Promise<void> =>
    DedupePlugin(name, keepKey) as unknown as Promise<void>,

  detectPluginDuplicates: (): Promise<DuplicateGroup[]> =>
    DetectPluginDuplicates() as unknown as Promise<DuplicateGroup[]>,

  enumerateSettingsSources: (projectRoot: string): Promise<SourcesView> =>
    EnumerateSettingsSources(projectRoot) as unknown as Promise<SourcesView>,

  readClaudeJSON: (): Promise<ClaudeJSONCensus> =>
    ReadClaudeJSON() as unknown as Promise<ClaudeJSONCensus>,

  revealClaudeJSONValue: (keyPath: string): Promise<string> => RevealClaudeJSONValue(keyPath),

  readClaudeJSONMasked: (): Promise<string> => ReadClaudeJSONMasked(),

  listClaudeJSONBackups: async (): Promise<ClaudeJSONBackup[]> => {
    const raw = await ListClaudeJSONBackups();
    return reviveDates(raw as unknown as ClaudeJSONBackup[]);
  },

  readClaudeJSONBackup: (name: string): Promise<string> => ReadClaudeJSONBackup(name),

  purgeClaudeJSONProjects: (keys: string[]): Promise<PurgeResult> =>
    PurgeClaudeJSONProjects(keys) as unknown as Promise<PurgeResult>,

  listClaudeJSONAppBackups: async (): Promise<ClaudeJSONBackup[]> => {
    const raw = await ListClaudeJSONAppBackups();
    return reviveDates(raw as unknown as ClaudeJSONBackup[]);
  },

  restoreClaudeJSONAppBackup: (name: string): Promise<void> =>
    RestoreClaudeJSONAppBackup(name) as unknown as Promise<void>,

  getMCPStatus: (): Promise<MCPStatusView> =>
    GetMCPStatus() as unknown as Promise<MCPStatusView>,

  getPermissionRules: (projectRoot: string): Promise<PermissionRulesView> =>
    GetPermissionRules(projectRoot) as unknown as Promise<PermissionRulesView>,

  addPermissionRule: (scope: PermissionScope, list: string, rule: string): Promise<void> =>
    AddPermissionRule(
      scope as unknown as Parameters<typeof AddPermissionRule>[0],
      list,
      rule
    ) as unknown as Promise<void>,

  removePermissionRule: (scope: PermissionScope, list: string, rule: string): Promise<void> =>
    RemovePermissionRule(
      scope as unknown as Parameters<typeof RemovePermissionRule>[0],
      list,
      rule
    ) as unknown as Promise<void>,

  movePermissionRule: (
    from: PermissionScope,
    to: PermissionScope,
    fromList: string,
    toList: string,
    rule: string
  ): Promise<void> =>
    MovePermissionRule(
      from as unknown as Parameters<typeof MovePermissionRule>[0],
      to as unknown as Parameters<typeof MovePermissionRule>[1],
      fromList,
      toList,
      rule
    ) as unknown as Promise<void>,

  analyzePermissionSuggestions: (root: string): Promise<Suggestion[]> =>
    AnalyzePermissionSuggestions(root) as unknown as Promise<Suggestion[]>,
};
