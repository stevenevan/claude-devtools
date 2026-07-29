

// Core Type Aliases

type EntryType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

type ContentType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';

type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;

// Content Blocks

interface BaseContent {
  type: ContentType;
}

export interface TextContent extends BaseContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent extends BaseContent {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface ToolUseContent extends BaseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent extends BaseContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageContent extends BaseContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | ToolResultContent
  | ImageContent;

// Usage Metadata

export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// Messages

interface UserMessage {
  role: 'user';
  content: string | ContentBlock[];
}

interface AssistantMessage {
  role: 'assistant';
  model: string;
  id: string;
  type: 'message';
  content: ContentBlock[];
  stop_reason: StopReason;
  stop_sequence: string | null;
  usage: UsageMetadata;
}

// JSONL Entries

interface BaseEntry {
  type: EntryType;
  timestamp?: string;
  uuid?: string;
}

interface ConversationalEntry extends BaseEntry {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: 'external';
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  slug?: string;
}

export type ToolUseResultData = Record<string, unknown>;

export interface UserEntry extends ConversationalEntry {
  type: 'user';
  message: UserMessage;
  isMeta?: boolean;
  agentId?: string;

  toolUseResult?: ToolUseResultData;
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
}

export interface AssistantEntry extends ConversationalEntry {
  type: 'assistant';
  message: AssistantMessage;
  requestId: string;
  agentId?: string;
}

export interface SystemEntry extends ConversationalEntry {
  type: 'system';
  subtype: 'turn_duration' | 'init';
  durationMs: number;
  isMeta: boolean;
}

export interface SummaryEntry extends BaseEntry {
  type: 'summary';
  summary: string;
  leafUuid: string;
}

export interface FileHistorySnapshotEntry extends BaseEntry {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: {
    messageId: string;
    // Older sessions wrote a bare string value here; current ones write this
    // object, and `backupFileName` may be null. Readers must tolerate both.
    trackedFileBackups: Record<
      string,
      | string
      | {
          backupFileName: string | null;
          version: number;
          backupTime: string;
          realParentDir?: string;
        }
    >;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

export interface QueueOperationEntry extends BaseEntry {
  type: 'queue-operation';
  operation: string;
}

export type ChatHistoryEntry =
  | UserEntry
  | AssistantEntry
  | SystemEntry
  | SummaryEntry
  | FileHistorySnapshotEntry
  | QueueOperationEntry;

export type ConversationalChatEntry = UserEntry | AssistantEntry | SystemEntry;

// Subagent Directory Structures

// Message Flow Pattern

