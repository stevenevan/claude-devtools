import type { ModelInfo } from '@shared/utils/modelParser';

import type { ClaudeMdStats } from '../claudeMd';
import type { CompactionTokenDelta } from '../contextInjection';
import type {
  ParsedMessage,
  Process,
  SemanticStep,
  SessionMetrics,
  ToolUseResultData,
} from '../data';

export type AIGroupExpansionLevel = 'collapsed' | 'items' | 'full';

export interface AIGroupSummary {

  thinkingPreview?: string;

  toolCallCount: number;

  outputMessageCount: number;

  subagentCount: number;

  totalDurationMs: number;

  totalTokens: number;

  outputTokens: number;

  cachedTokens: number;
}

export interface LinkedToolItem {

  id: string;

  name: string;

  input: Record<string, unknown>;

  callTokens?: number;

  result?: {
    content: string | unknown[];
    isError: boolean;
    toolUseResult?: ToolUseResultData;

    tokenCount?: number;
  };

  inputPreview: string;

  outputPreview?: string;

  startTime: Date;

  endTime?: Date;

  durationMs?: number;

  isOrphaned: boolean;

  sourceModel?: string;

  skillInstructions?: string;

  skillInstructionsTokenCount?: number;
}

export interface SlashItem {

  id: string;

  name: string;

  message?: string;

  args?: string;

  commandMessageUuid: string;

  instructions?: string;

  instructionsTokenCount?: number;

  timestamp: Date;
}

export interface TeammateMessage {
  id: string;
  teammateId: string;
  color: string;
  summary: string;
  content: string;
  timestamp: Date;
  tokenCount?: number;

  replyToSummary?: string;

  replyToToolId?: string;
}

export type AIGroupDisplayItem =
  | { type: 'thinking'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'tool'; tool: LinkedToolItem }
  | { type: 'subagent'; subagent: Process }
  | { type: 'output'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'slash'; slash: SlashItem }
  | { type: 'teammate_message'; teammateMessage: TeammateMessage }
  | { type: 'subagent_input'; content: string; timestamp: Date; tokenCount?: number }
  | {
      type: 'compact_boundary';
      content: string;
      timestamp: Date;
      tokenDelta?: CompactionTokenDelta;
      phaseNumber: number;
    };

export interface AIGroupLastOutput {

  type: 'text' | 'tool_result' | 'interruption' | 'ongoing' | 'plan_exit';

  text?: string;

  toolName?: string;

  toolResult?: string;

  isError?: boolean;

  interruptionMessage?: string;

  planContent?: string;

  planPreamble?: string;

  timestamp: Date;
}

export interface EnhancedAIGroup extends AIGroup {

  lastOutput: AIGroupLastOutput | null;

  displayItems: AIGroupDisplayItem[];

  linkedTools: Map<string, LinkedToolItem>;

  itemsSummary: string;

  mainModel: ModelInfo | null;

  subagentModels: ModelInfo[];

  claudeMdStats: ClaudeMdStats | null;
}

export type AIGroupStatus = 'complete' | 'interrupted' | 'error' | 'in_progress';

export interface AIGroupTokens {
  input: number;
  output: number;
  cached: number;
  thinking?: number;
}

export interface AIGroup {

  id: string;

  turnIndex: number;

  startTime: Date;

  endTime: Date;

  durationMs: number;

  steps: SemanticStep[];

  tokens: AIGroupTokens;

  summary: AIGroupSummary;

  status: AIGroupStatus;

  processes: Process[];

  chunkId: string;

  metrics: SessionMetrics;

  responses: ParsedMessage[];

  isOngoing?: boolean;

  progressCount?: number;

  progressTexts?: string[];
}
