import { type MessageType, type TokenUsage } from '../domain';
import { type ContentBlock, type ToolUseResultData } from '../jsonl';

// Tool Types

/**
 * Tool call extracted from assistant message.
 */
export interface ToolCall {
  /** Tool use ID for linking to results */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Whether this is a Task (subagent) tool call */
  isTask: boolean;
  /** Task description if isTask */
  taskDescription?: string;
  /** Task subagent type if isTask */
  taskSubagentType?: string;
}

/**
 * Tool result extracted from user message.
 */
export interface ToolResult {
  /** Corresponding tool_use ID */
  toolUseId: string;
  /** Result content */
  content: string | unknown[];
  /** Whether the tool execution errored */
  isError: boolean;
}

// Parsed Message

/**
 * Parsed and enriched message from JSONL.
 * This is the application's internal representation after parsing raw JSONL entries.
 */
export interface ParsedMessage {
  /** Unique message identifier */
  uuid: string;
  /** Parent message UUID for threading */
  parentUuid: string | null;
  /** Message type */
  type: MessageType;
  /** Message timestamp */
  timestamp: Date;
  /** Message role if present */
  role?: string;
  /** Message content (string or content blocks) */
  content: ContentBlock[] | string;
  /** Token usage for this message */
  usage?: TokenUsage;
  /** Model used for this response */
  model?: string;
  // Metadata
  /** Current working directory when message was created */
  cwd?: string;
  /** Git branch context */
  gitBranch?: string;
  /** Agent ID for subagent messages */
  agentId?: string;
  /** Whether this is a sidechain message */
  isSidechain: boolean;
  /** Whether this is a meta message */
  isMeta: boolean;
  /** User type ("external" for user input) */
  userType?: string;
  // Extracted tool information
  /** Tool calls made in this message */
  toolCalls: ToolCall[];
  /** Tool results received in this message */
  toolResults: ToolResult[];
  /** Source tool use ID if this is a tool result message */
  sourceToolUseID?: string;
  /** Source assistant UUID if this is a tool result message */
  sourceToolAssistantUUID?: string;
  /** Tool use result information if this is a tool result message */
  toolUseResult?: ToolUseResultData;
  /** Whether this is a compact summary boundary message */
  isCompactSummary?: boolean;
  /** API request ID for deduplicating streaming entries */
  requestId?: string;
  /** System entry subtype (api_error, bridge_status, memory_saved, etc.) */
  subtype?: string;
  /** Structured event data for displayable system entries */
  eventData?: SystemEventData;
}

// System Event Data

/**
 * Structured data for displayable system events (api_error, bridge_status, memory_saved).
 */
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
