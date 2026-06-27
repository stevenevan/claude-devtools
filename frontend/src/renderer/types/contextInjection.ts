

import type { ClaudeMdInjection } from './claudeMd';

// Constants

export const MAX_MENTIONED_FILE_TOKENS = 25000;

// Mentioned File Types

export interface MentionedFileInjection {

  id: string;

  category: 'mentioned-file';

  path: string;

  displayName: string;

  estimatedTokens: number;

  firstSeenTurnIndex: number;

  firstSeenInGroup: string;

  exists: boolean;
}

export interface MentionedFileInfo {

  path: string;

  exists: boolean;

  charCount: number;

  estimatedTokens: number;
}

// Tool Output Types

export interface ToolTokenBreakdown {

  toolName: string;

  tokenCount: number;

  isError: boolean;

  toolUseId?: string;
}

export interface ToolOutputInjection {

  id: string;

  category: 'tool-output';

  turnIndex: number;

  aiGroupId: string;

  estimatedTokens: number;

  toolCount: number;

  toolBreakdown: ToolTokenBreakdown[];
}

// Thinking/Text Output Types

export interface ThinkingTextBreakdown {

  type: 'thinking' | 'text';

  tokenCount: number;
}

export interface ThinkingTextInjection {

  id: string;

  category: 'thinking-text';

  turnIndex: number;

  aiGroupId: string;

  estimatedTokens: number;

  breakdown: ThinkingTextBreakdown[];
}

// User Message Types

export interface UserMessageInjection {

  id: string;

  category: 'user-message';

  turnIndex: number;

  aiGroupId: string;

  estimatedTokens: number;

  textPreview: string;
}

// Task Coordination Types

export interface TaskCoordinationBreakdown {

  type: 'teammate-message' | 'send-message' | 'task-tool';

  toolName?: string;

  tokenCount: number;

  label: string;
}

export interface TaskCoordinationInjection {

  id: string;

  category: 'task-coordination';

  turnIndex: number;

  aiGroupId: string;

  estimatedTokens: number;

  breakdown: TaskCoordinationBreakdown[];
}

// Union Types

export type ClaudeMdContextInjection = ClaudeMdInjection & { category: 'claude-md' };

export type ContextInjection =
  | ClaudeMdContextInjection
  | MentionedFileInjection
  | ToolOutputInjection
  | ThinkingTextInjection
  | TaskCoordinationInjection
  | UserMessageInjection;

// Statistics Types

export interface TokensByCategory {

  claudeMd: number;

  mentionedFiles: number;

  toolOutputs: number;

  thinkingText: number;

  taskCoordination: number;

  userMessages: number;
}

export interface NewCountsByCategory {

  claudeMd: number;

  mentionedFiles: number;

  toolOutputs: number;

  thinkingText: number;

  taskCoordination: number;

  userMessages: number;
}

export interface ContextStats {

  newInjections: ContextInjection[];

  accumulatedInjections: ContextInjection[];

  totalEstimatedTokens: number;

  tokensByCategory: TokensByCategory;

  newCounts: NewCountsByCategory;

  phaseNumber?: number;
}

// Context Phase Types

export interface CompactionTokenDelta {
  preCompactionTokens: number;
  postCompactionTokens: number;
  delta: number; // negative = context freed
}

export interface ContextPhase {
  phaseNumber: number; // 1-based
  firstAIGroupId: string;
  lastAIGroupId: string;
  compactGroupId: string | null; // null for phase 1
  startTokens?: number;
  endTokens?: number;
}

export interface ContextPhaseInfo {
  phases: ContextPhase[];
  compactionCount: number;
  aiGroupPhaseMap: Map<string, number>; // aiGroupId → phaseNumber
  compactionTokenDeltas: Map<string, CompactionTokenDelta>; // compactGroupId → delta
}
