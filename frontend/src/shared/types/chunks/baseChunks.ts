import { type SessionMetrics } from '../domain';
import {
  type ParsedMessage,
  type SystemEventData,
  type ToolCall,
  type ToolResult,
} from '../messages';

import { type Process } from './processes';

interface BaseChunk {

  id: string;

  startTime: Date;

  endTime: Date;

  durationMs: number;

  metrics: SessionMetrics;
}

export interface UserChunk extends BaseChunk {

  chunkType: 'user';

  userMessage: ParsedMessage;
}

export interface AIChunk extends BaseChunk {

  chunkType: 'ai';

  responses: ParsedMessage[];

  processes: Process[];

  sidechainMessages: ParsedMessage[];

  toolExecutions: ToolExecution[];
}

export interface SystemChunk extends BaseChunk {
  chunkType: 'system';
  message: ParsedMessage;
  commandOutput: string; // Extracted from <local-command-stdout>
}

export interface CompactChunk extends BaseChunk {
  chunkType: 'compact';
  message: ParsedMessage;
}

export interface EventChunk extends BaseChunk {
  chunkType: 'event';
  message: ParsedMessage;
  eventData: SystemEventData;
}

export type Chunk = UserChunk | AIChunk | SystemChunk | CompactChunk | EventChunk;

export interface ToolExecution {

  toolCall: ToolCall;

  result?: ToolResult;

  startTime: Date;

  endTime?: Date;

  durationMs?: number;
}

