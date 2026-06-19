import { type SessionMetrics } from '../domain';
import { type ParsedMessage, type ToolCall } from '../messages';

import { type ToolExecution } from './baseChunks';
import { type Process } from './processes';

/**
 * Task execution links a Task tool call to its subagent execution.
 * This provides a complete view of async subagent work initiated by Task tool.
 */
export interface TaskExecution {
  /** The Task tool_use block that initiated the subagent */
  taskCall: ToolCall;
  /** When the Task tool was called */
  taskCallTimestamp: Date;
  /** The linked subagent execution */
  subagent: Process;
  /** The isMeta:true tool_result message for this Task */
  toolResult: ParsedMessage;
  /** When the tool result was received */
  resultTimestamp: Date;
  /** Duration from task call to result */
  durationMs: number;
}

/**
 * ConversationGroup represents a natural grouping in the conversation flow:
 * - One real user message (isMeta: false, string content)
 * - All AI responses until the next user message (assistant messages + internal messages)
 * - Subagents spawned during this group
 * - Tool executions (excluding Task tools with subagents to avoid duplication)
 * - Task executions (Task tools with their subagent results)
 *
 * This is a simplified alternative to Chunks that focuses on natural conversation boundaries.
 */
export interface ConversationGroup {
  /** Unique group identifier */
  id: string;
  /** Group type - currently only one type but extensible */
  type: 'user-ai-exchange';
  /** The real user message that starts this group (isMeta: false) */
  userMessage: ParsedMessage;
  /** All AI responses: assistant messages and internal messages (tool results, etc.) */
  aiResponses: ParsedMessage[];
  /** Processes spawned during this group */
  processes: Process[];
  /** Tool executions (excluding Task tools that have matching processes) */
  toolExecutions: ToolExecution[];
  /** Task tool calls with their subagent executions */
  taskExecutions: TaskExecution[];
  /** When the group started (user message timestamp) */
  startTime: Date;
  /** When the group ended (last AI response timestamp) */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Aggregated metrics for the group */
  metrics: SessionMetrics;
}
