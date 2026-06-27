import { type ToolUseResultData } from '../jsonl';

export type SemanticStepType =
  | 'thinking' // Extended thinking content
  | 'tool_call' // Tool invocation
  | 'tool_result' // Tool result received
  | 'subagent' // Subagent execution
  | 'output' // Main text output
  | 'interruption'; // User interruption

export interface SemanticStep {

  id: string;

  type: SemanticStepType;

  startTime: Date;

  endTime?: Date;

  durationMs: number;


  content: {
    thinkingText?: string; // For thinking
    toolName?: string; // For tool_call/result
    toolInput?: unknown; // For tool_call
    toolResultContent?: string; // For tool_result
    isError?: boolean; // For tool_result
    toolUseResult?: ToolUseResultData; // For tool_result - enriched data from message
    tokenCount?: number; // For tool_result - pre-computed token count
    subagentId?: string; // For subagent
    subagentDescription?: string;
    outputText?: string; // For output
    sourceModel?: string; // For tool_call - model from source assistant message
    interruptionText?: string; // For interruption - the interruption message text
  };


  tokens?: {
    input: number;
    output: number;
    cached?: number;
  };


  isParallel?: boolean;
  groupId?: string;


  context: 'main' | 'subagent';
  agentId?: string;


  sourceMessageId?: string;


  effectiveEndTime?: Date;


  effectiveDurationMs?: number;


  isGapFilled?: boolean;


  contextTokens?: number;


  accumulatedContext?: number;


  tokenBreakdown?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
}

export interface SemanticStepGroup {

  id: string;

  label: string;

  steps: SemanticStep[];

  isGrouped: boolean;

  sourceMessageId?: string;

  startTime: Date;

  endTime: Date;

  totalDuration: number;
}
