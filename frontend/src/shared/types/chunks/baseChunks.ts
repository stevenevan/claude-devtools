import { type SessionMetrics } from '../domain';
import {
  type ParsedMessage,
  type SystemEventData,
  type ToolCall,
  type ToolResult,
} from '../messages';

import { type Process } from './processes';

/**
 * Base chunk properties shared by all chunk types.
 */
interface BaseChunk {
  /** Unique chunk identifier */
  id: string;
  /** When the chunk started */
  startTime: Date;
  /** When the chunk ended */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Aggregated metrics for the chunk */
  metrics: SessionMetrics;
}

/**
 * User chunk - represents a single user input message.
 * This is separate from AI responses to support independent visualization.
 */
export interface UserChunk extends BaseChunk {
  /** Discriminator for chunk type */
  chunkType: 'user';
  /** The user message */
  userMessage: ParsedMessage;
}

/**
 * AI chunk - represents all assistant responses to a user message.
 * Contains responses, tool executions, and subagent spawns.
 *
 * NOTE: AI chunks are independent - they no longer reference a parent user chunk.
 */
export interface AIChunk extends BaseChunk {
  /** Discriminator for chunk type */
  chunkType: 'ai';
  /** All assistant responses and internal messages */
  responses: ParsedMessage[];
  /** Processes spawned during this chunk */
  processes: Process[];
  /** Sidechain messages within this chunk */
  sidechainMessages: ParsedMessage[];
  /** Tool executions in this chunk */
  toolExecutions: ToolExecution[];
}

/**
 * System chunk - represents command output rendered like AI.
 */
export interface SystemChunk extends BaseChunk {
  chunkType: 'system';
  message: ParsedMessage;
  commandOutput: string; // Extracted from <local-command-stdout>
}

/**
 * Compact boundary chunk - marks where conversation was compacted.
 */
export interface CompactChunk extends BaseChunk {
  chunkType: 'compact';
  message: ParsedMessage;
}

/**
 * Event chunk - represents a system event (api_error, bridge_status, memory_saved).
 */
export interface EventChunk extends BaseChunk {
  chunkType: 'event';
  message: ParsedMessage;
  eventData: SystemEventData;
}

/**
 * A chunk can be user input, AI response, system output, compact boundary, or event.
 * This discriminated union enables separate visualization and processing.
 */
export type Chunk = UserChunk | AIChunk | SystemChunk | CompactChunk | EventChunk;

/**
 * Tool execution with timing information.
 */
export interface ToolExecution {
  /** The tool call */
  toolCall: ToolCall;
  /** The tool result if received */
  result?: ToolResult;
  /** When the tool was called */
  startTime: Date;
  /** When the result was received */
  endTime?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
}

