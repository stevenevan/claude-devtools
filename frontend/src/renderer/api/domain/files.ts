import {
  DedupePlugin,
  DetectPluginDuplicates,
  EnumerateSettingsSources,
  ReadAgentConfigs,
  ReadClaudeMdFiles,
  ReadDirectoryClaudeMd,
  ReadGlobalAgents,
  ReadGlobalPlugins,
  ReadGlobalSettings,
  ReadGlobalSkills,
  ReadHooks,
  ReadMentionedFile,
  SetPluginEnabled,
  ToggleHook,
  UpdateGlobalSettings,
  ValidateMentions,
  ValidatePath,
} from '../../../../bindings/claude-devtools/internal/filesservice/filesservice';

import type { ClaudeMdFileInfo, ElectronAPI } from '@shared/types';
import type {
  AgentConfig,
  DuplicateGroup,
  GlobalAgent,
  GlobalPlugin,
  GlobalSettingsPatch,
  GlobalSkill,
  HookView,
  SourcesView,
} from '@shared/types/api';

type FilesSlice = Pick<
  ElectronAPI,
  | 'validatePath'
  | 'validateMentions'
  | 'readClaudeMdFiles'
  | 'readDirectoryClaudeMd'
  | 'readMentionedFile'
  | 'readAgentConfigs'
  | 'readGlobalAgents'
  | 'readGlobalSkills'
  | 'readGlobalPlugins'
  | 'readGlobalSettings'
  | 'updateGlobalSettings'
  | 'readHooks'
  | 'toggleHook'
  | 'setPluginEnabled'
  | 'dedupePlugin'
  | 'detectPluginDuplicates'
  | 'enumerateSettingsSources'
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

  readGlobalAgents: (): Promise<GlobalAgent[]> =>
    ReadGlobalAgents() as unknown as Promise<GlobalAgent[]>,

  readGlobalSkills: (): Promise<GlobalSkill[]> =>
    ReadGlobalSkills() as unknown as Promise<GlobalSkill[]>,

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
};
