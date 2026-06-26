import { type UsageMetadata } from '../jsonl';

/**
 * Token usage statistics (alias for API compatibility).
 * Maps to UsageMetadata from the spec.
 */
export type TokenUsage = UsageMetadata;

/**
 * Message type classification for parsed messages.
 */
export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

/**
 * Message category for chunk building.
 * Used to classify messages into one of four categories for independent chunk creation.
 */
export type MessageCategory = 'user' | 'system' | 'hardNoise' | 'ai' | 'compact';

/**
 * Project information derived from ~/.claude/projects/ directory.
 */
export interface Project {
  /** Encoded directory name (e.g., "-Users-username-projectname") */
  id: string;
  /** Decoded actual filesystem path */
  path: string;
  /** Display name (last path segment) */
  name: string;
  /** List of session IDs (JSONL filenames without extension) */
  sessions: string[];
  /** Unix timestamp when project directory was created */
  createdAt: number;
  /** Unix timestamp of most recent session activity */
  mostRecentSession?: number;
}

/**
 * Session metadata and summary.
 */
export type SessionMetadataLevel = 'light' | 'deep';

/**
 * Per-phase token breakdown for compaction-aware context consumption.
 */
export interface PhaseTokenBreakdown {
  /** 1-based phase number */
  phaseNumber: number;
  /** Tokens added during this phase */
  contribution: number;
  /** Context window at peak (pre-compaction or final) */
  peakTokens: number;
  /** Tokens after compaction (undefined for the last/current phase) */
  postCompaction?: number;
}

export interface Session {
  /** Session UUID (JSONL filename without extension) */
  id: string;
  /** Parent project ID */
  projectId: string;
  /** Project filesystem path */
  projectPath: string;
  /** Task list data from ~/.claude/todos/{id}.json if exists */
  todoData?: unknown;
  /** Unix timestamp when session file was created */
  createdAt: number;
  /** First user message text (for preview) */
  firstMessage?: string;
  /** Timestamp of first user message (RFC3339) */
  messageTimestamp?: string;
  /** Whether this session has subagents */
  hasSubagents: boolean;
  /** Total message count in the session */
  messageCount: number;
  /** Whether the session is ongoing (last AI response has no output yet) */
  isOngoing?: boolean;
  /** Git branch name if available */
  gitBranch?: string;
  /** Metadata completeness level */
  metadataLevel?: SessionMetadataLevel;
  /** Total context consumed (compaction-aware sum of all phases) */
  contextConsumption?: number;
  /** Number of compaction events */
  compactionCount?: number;
  /** Per-phase token breakdown for tooltip display */
  phaseBreakdown?: PhaseTokenBreakdown[];
  /** Custom title set by the user (from /title command) */
  customTitle?: string;
  /** Agent name when session uses a named agent */
  agentName?: string;
}

/**
 * Aggregated metrics for a session or chunk.
 */
export interface SessionMetrics {
  /** Duration in milliseconds */
  durationMs: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Cache read tokens */
  cacheReadTokens: number;
  /** Cache creation tokens */
  cacheCreationTokens: number;
  /** Number of messages */
  messageCount: number;
  /** Estimated cost in USD */
  costUsd?: number;
  /** Primary model used in this session */
  model?: string;
}

/**
 * Options for targeted session fetches by session ID.
 */
export interface SessionsByIdsOptions {
  /**
   * Metadata depth to return for each session.
   * - light: fast preview fields suitable for list/sidebar
   * - deep: full summary metadata (slower)
   * @default provider-specific default (SSH=light, local=deep)
   */
  metadataLevel?: SessionMetadataLevel;
}
