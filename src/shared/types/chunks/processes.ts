import { type SessionMetrics } from '../domain';
import { type ParsedMessage } from '../messages';

/**
 * Resolved subagent information.
 */
export interface Process {
  /** Agent ID extracted from filename */
  id: string;
  /** Path to the subagent JSONL file */
  filePath: string;
  /** Parsed messages from the subagent session */
  messages: ParsedMessage[];
  /** When the subagent started */
  startTime: Date;
  /** When the subagent ended */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Aggregated metrics for the subagent */
  metrics: SessionMetrics;
  /** Task description from parent Task call */
  description?: string;
  /** Subagent type from Task call (e.g., "Explore", "Plan") */
  subagentType?: string;
  /** Whether executed in parallel with other subagents */
  isParallel: boolean;
  /** The tool_use ID of the Task call that spawned this */
  parentTaskId?: string;
  /** Whether this subagent is still in progress */
  isOngoing?: boolean;
  /**
   * Main session impact tokens - the tokens the Task tool_call and tool_result
   * consume in the main session's context window. This is different from the
   * subagent's internal token usage (metrics/messages).
   */
  mainSessionImpact?: {
    /** Task tool_use input tokens (prompt, config) */
    callTokens: number;
    /** Task tool_result output tokens (subagent's return value) */
    resultTokens: number;
    /** Total tokens affecting main session */
    totalTokens: number;
  };
  /** Team metadata - present when this subagent is a team member */
  team?: {
    teamName: string;
    memberName: string;
    memberColor: string;
  };
}
