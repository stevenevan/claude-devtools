import type { TriggerColor } from '@shared/constants/triggerColors';

export type TriggerContentType = 'tool_result' | 'tool_use' | 'thinking' | 'text';

const KNOWN_TOOL_NAMES = [
  'Bash',
  'Task',
  'TodoWrite',
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'LSP',
  'Skill',
  'NotebookEdit',
  'AskUserQuestion',
  'KillShell',
  'TaskOutput',
] as const;

export type TriggerToolName = (typeof KNOWN_TOOL_NAMES)[number] | (string & Record<never, never>);

export type MatchFieldForToolResult = 'content';
export type MatchFieldForBash = 'command' | 'description';
export type MatchFieldForTask = 'description' | 'prompt' | 'subagent_type';
export type MatchFieldForRead = 'file_path';
export type MatchFieldForWrite = 'file_path' | 'content';
export type MatchFieldForEdit = 'file_path' | 'old_string' | 'new_string';
export type MatchFieldForGlob = 'pattern' | 'path';
export type MatchFieldForGrep = 'pattern' | 'path' | 'glob';
export type MatchFieldForWebFetch = 'url' | 'prompt';
export type MatchFieldForWebSearch = 'query';
export type MatchFieldForSkill = 'skill' | 'args';
export type MatchFieldForThinking = 'thinking';
export type MatchFieldForText = 'text';

export type TriggerMatchField =
  | MatchFieldForToolResult
  | MatchFieldForBash
  | MatchFieldForTask
  | MatchFieldForRead
  | MatchFieldForWrite
  | MatchFieldForEdit
  | MatchFieldForGlob
  | MatchFieldForGrep
  | MatchFieldForWebFetch
  | MatchFieldForWebSearch
  | MatchFieldForSkill
  | MatchFieldForThinking
  | MatchFieldForText;

export type TriggerMode = 'error_status' | 'content_match' | 'token_threshold';

export type TriggerTokenType = 'input' | 'output' | 'total';

export interface NotificationTrigger {

  id: string;

  name: string;

  enabled: boolean;

  contentType: TriggerContentType;

  toolName?: TriggerToolName;

  isBuiltin?: boolean;

  ignorePatterns?: string[];

  // === Discriminated Union Mode ===

  mode: TriggerMode;

  // === Mode: error_status ===

  requireError?: boolean;

  // === Mode: content_match ===

  matchField?: TriggerMatchField;

  matchPattern?: string;

  // === Mode: token_threshold ===

  tokenThreshold?: number;

  tokenType?: TriggerTokenType;

  // === Repository Scope ===

  repositoryIds?: string[];

  // === Display ===

  color?: TriggerColor;
}

export interface TriggerTestResult {
  totalCount: number;
  errors: {
    id: string;
    sessionId: string;
    projectId: string;
    message: string;
    timestamp: number;
    source: string;

    toolUseId?: string;

    subagentId?: string;

    lineNumber?: number;
    context: { projectName: string };
  }[];

  truncated?: boolean;
}
