import { type MessageType, type TokenUsage } from '../domain';
import { type ContentBlock, type ToolUseResultData } from '../jsonl';

// Tool Types

export interface ToolCall {

  id: string;

  name: string;

  input: Record<string, unknown>;

  isTask: boolean;

  taskDescription?: string;

  taskSubagentType?: string;
}

export interface ToolResult {

  toolUseId: string;

  content: string | unknown[];

  isError: boolean;
}

// Parsed Message

export interface ParsedMessage {

  uuid: string;

  parentUuid: string | null;

  type: MessageType;

  timestamp: Date;

  role?: string;

  content: ContentBlock[] | string;

  usage?: TokenUsage;

  model?: string;
  // Metadata

  cwd?: string;

  gitBranch?: string;

  agentId?: string;

  isSidechain: boolean;

  isMeta: boolean;

  userType?: string;
  // Extracted tool information

  toolCalls: ToolCall[];

  toolResults: ToolResult[];

  sourceToolUseID?: string;

  sourceToolAssistantUUID?: string;

  toolUseResult?: ToolUseResultData;

  isCompactSummary?: boolean;

  requestId?: string;

  subtype?: string;

  eventData?: SystemEventData;
}

// System Event Data

export interface SystemEventData {
  subtype: string;
  // api_error
  errorStatus?: number;
  errorType?: string;
  errorMessage?: string;
  retryAttempt?: number;
  maxRetries?: number;
  retryInMs?: number;
  // bridge_status
  bridgeContent?: string;
  bridgeUrl?: string;
  // memory_saved
  writtenPaths?: string[];
  memoryVerb?: string;
  // turn_duration
  durationMs?: number;
  // queue_operation
  operation?: string;
  queuedContent?: string;
}
