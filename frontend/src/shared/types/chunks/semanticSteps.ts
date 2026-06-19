import { type ToolUseResultData } from '../jsonl';

/**
 * Semantic step types for breakdown within responses.
 */
export type SemanticStepType =
  | 'thinking' // Extended thinking content
  | 'tool_call' // Tool invocation
  | 'tool_result' // Tool result received
  | 'subagent' // Subagent execution
  | 'output' // Main text output
  | 'interruption'; // User interruption

/**
 * A semantic step represents a logical unit of work within a response.
 *
 * Note: Task tool_use blocks are filtered during extraction when corresponding
 * subagents exist. Since Task calls spawn async subagents, the tool_call and
 * subagent represent the same execution. Filtering prevents duplicate entries
 * Orphaned Task calls (without matching subagents) are
 * retained as fallback to ensure visibility of all work.
 */
export interface SemanticStep {
  /** Unique step identifier */
  id: string;
  /** Step type */
  type: SemanticStepType;
  /** When the step started */
  startTime: Date;
  /** When the step ended */
  endTime?: Date;
  /** Duration in milliseconds */
  durationMs: number;

  /** Content varies by type */
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

  /** Token attribution */
  tokens?: {
    input: number;
    output: number;
    cached?: number;
  };

  /** Parallel execution */
  isParallel?: boolean;
  groupId?: string;

  /** Context (main agent vs subagent) */
  context: 'main' | 'subagent';
  agentId?: string;

  /** Source message UUID (for grouping steps by assistant message) */
  sourceMessageId?: string;

  /** Effective end time after gap filling (extends to next step or chunk end) */
  effectiveEndTime?: Date;

  /** Effective duration including waiting time until next step */
  effectiveDurationMs?: number;

  /** Whether timing was gap-filled vs having original endTime */
  isGapFilled?: boolean;

  /** Context tokens for this step (cache_read + cache_creation + input) */
  contextTokens?: number;

  /** Cumulative context up to this step (session-wide accumulation) */
  accumulatedContext?: number;

  /** Token breakdown for step-level estimation */
  tokenBreakdown?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
}

/**
 * Semantic step group for collapsible visualization.
 * Groups multiple micro-steps by their source assistant message.
 */
export interface SemanticStepGroup {
  /** Unique group ID */
  id: string;
  /** Display label (e.g., "Assistant Response", "Tool: Read") */
  label: string;
  /** Steps in this group */
  steps: SemanticStep[];
  /** true if multiple steps grouped, false if standalone */
  isGrouped: boolean;
  /** Assistant message UUID if grouped */
  sourceMessageId?: string;
  /** Earliest step start */
  startTime: Date;
  /** Latest step end */
  endTime: Date;
  /** Sum of all step durations */
  totalDuration: number;
}
