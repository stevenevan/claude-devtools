import { type SessionMetrics } from '../domain';
import { type ParsedMessage, type ToolCall } from '../messages';

import { type ToolExecution } from './baseChunks';
import { type Process } from './processes';

export interface TaskExecution {

  taskCall: ToolCall;

  taskCallTimestamp: Date;

  subagent: Process;

  toolResult: ParsedMessage;

  resultTimestamp: Date;

  durationMs: number;
}

export interface ConversationGroup {

  id: string;

  type: 'user-ai-exchange';

  userMessage: ParsedMessage;

  aiResponses: ParsedMessage[];

  processes: Process[];

  toolExecutions: ToolExecution[];

  taskExecutions: TaskExecution[];

  startTime: Date;

  endTime: Date;

  durationMs: number;

  metrics: SessionMetrics;
}
