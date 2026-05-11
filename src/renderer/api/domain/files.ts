import { invoke } from '@tauri-apps/api/core';

import type { ClaudeMdFileInfo, ElectronAPI } from '@shared/types';
import type { AgentConfig, GlobalAgent, GlobalPlugin, GlobalSkill } from '@shared/types/api';

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
>;

export const filesApi: FilesSlice = {
  validatePath: (
    relativePath: string,
    projectPath: string
  ): Promise<{ exists: boolean; isDirectory?: boolean }> =>
    invoke<{ exists: boolean; isDirectory?: boolean }>('validate_path', {
      relativePath,
      projectPath,
    }),

  validateMentions: (
    mentions: { type: 'path'; value: string }[],
    projectPath: string
  ): Promise<Record<string, boolean>> =>
    invoke<Record<string, boolean>>('validate_mentions', { mentions, projectPath }),

  readClaudeMdFiles: (projectRoot: string): Promise<Record<string, ClaudeMdFileInfo>> =>
    invoke<Record<string, ClaudeMdFileInfo>>('read_claude_md_files', { projectRoot }),

  readDirectoryClaudeMd: (dirPath: string): Promise<ClaudeMdFileInfo> =>
    invoke<ClaudeMdFileInfo>('read_directory_claude_md', { dirPath }),

  readMentionedFile: (
    absolutePath: string,
    projectRoot: string,
    maxTokens?: number
  ): Promise<ClaudeMdFileInfo | null> =>
    invoke<ClaudeMdFileInfo | null>('read_mentioned_file', {
      absolutePath,
      projectRoot,
      maxTokens,
    }),

  readAgentConfigs: (projectRoot: string): Promise<Record<string, AgentConfig>> =>
    invoke<Record<string, AgentConfig>>('read_agent_configs', { projectRoot }),

  readGlobalAgents: (): Promise<GlobalAgent[]> => invoke<GlobalAgent[]>('read_global_agents'),

  readGlobalSkills: (): Promise<GlobalSkill[]> => invoke<GlobalSkill[]>('read_global_skills'),

  readGlobalPlugins: (): Promise<GlobalPlugin[]> => invoke<GlobalPlugin[]>('read_global_plugins'),

  readGlobalSettings: (): Promise<Record<string, unknown>> =>
    invoke<Record<string, unknown>>('read_global_settings'),
};
