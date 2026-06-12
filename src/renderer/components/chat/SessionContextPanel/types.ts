import type { ClaudeMdSource } from '@renderer/types/claudeMd';
import type { ContextInjection, ContextPhaseInfo } from '@renderer/types/contextInjection';

export interface SessionContextPanelProps {
  injections: ContextInjection[];
  onClose?: () => void;
  projectRoot?: string;
  onNavigateToTurn?: (turnIndex: number) => void;
  onNavigateToTool?: (turnIndex: number, toolUseId: string) => void;
  onNavigateToUserGroup?: (turnIndex: number) => void;
  totalSessionTokens?: number;
  phaseInfo?: ContextPhaseInfo;
  selectedPhase: number | null;
  onPhaseChange: (phase: number | null) => void;
}

export const SECTION_CLAUDE_MD = 'claude-md' as const;
export const SECTION_MENTIONED_FILES = 'mentioned-files' as const;
export const SECTION_TOOL_OUTPUTS = 'tool-outputs' as const;
export const SECTION_THINKING_TEXT = 'thinking-text' as const;
export const SECTION_TASK_COORDINATION = 'task-coordination' as const;
export const SECTION_USER_MESSAGES = 'user-messages' as const;

export type SectionType =
  | typeof SECTION_CLAUDE_MD
  | typeof SECTION_MENTIONED_FILES
  | typeof SECTION_TOOL_OUTPUTS
  | typeof SECTION_THINKING_TEXT
  | typeof SECTION_TASK_COORDINATION
  | typeof SECTION_USER_MESSAGES;

export type ContextViewMode = 'category' | 'ranked';

export type ClaudeMdGroupCategory = 'global' | 'project' | 'directory';

interface ClaudeMdGroupConfig {
  label: string;
  sources: ClaudeMdSource[];
}

export const CLAUDE_MD_GROUP_CONFIG: Record<ClaudeMdGroupCategory, ClaudeMdGroupConfig> = {
  global: {
    label: 'Global',
    sources: ['enterprise', 'user-memory', 'user-rules', 'auto-memory'],
  },
  project: {
    label: 'Project',
    sources: ['project-memory', 'project-rules', 'project-local'],
  },
  directory: {
    label: 'Directory',
    sources: ['directory'],
  },
};

export const CLAUDE_MD_GROUP_ORDER: ClaudeMdGroupCategory[] = ['global', 'project', 'directory'];
