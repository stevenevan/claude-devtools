/**
 * A single search result from searching sessions.
 */
export interface SearchResult {
  /** Session ID where match was found */
  sessionId: string;
  /** Project ID */
  projectId: string;
  /** Session title/first message */
  sessionTitle: string;
  /** The matched text (trimmed) */
  matchedText: string;
  /** Context around the match */
  context: string;
  /** Message type (user/assistant) */
  messageType: 'user' | 'assistant';
  /** Timestamp of the message */
  timestamp: number;
  /** Stable chat group ID used by in-session navigation (e.g., "user-..." or "ai-...") */
  groupId?: string;
  /** Searchable item type used for in-session matching */
  itemType?: 'user' | 'ai';
  /** Match index within the item's searchable text (0-based) */
  matchIndexInItem?: number;
  /** Character offset of the match within the searchable text */
  matchStartOffset?: number;
  /** Source message UUID for diagnostics/fallback mapping */
  messageUuid?: string;
}

/**
 * Result of a search operation.
 */
export interface SearchSessionsResult {
  /** Search results */
  results: SearchResult[];
  /** Total matches found */
  totalMatches: number;
  /** Sessions searched */
  sessionsSearched: number;
  /** Search query used */
  query: string;
  /** True when fast mode intentionally returns only a recent subset */
  isPartial?: boolean;
}

/**
 * A session-level search result from filtered search.
 */
export interface FilteredSearchResult {
  sessionId: string;
  projectId: string;
  projectPath: string;
  preview?: string;
  customTitle?: string;
  agentName?: string;
  timestamp: number;
  messageCount: number;
  isOngoing?: boolean;
  hasSubagents: boolean;
  contextConsumption?: number;
}

/**
 * Filters for advanced session search.
 */
export interface SearchFilters {
  query?: string;
  statusFilter?: 'ongoing' | 'completed';
  minCreatedAt?: number;
  maxCreatedAt?: number;
}

/**
 * Result of a filtered session search.
 */
export interface FilteredSearchResponse {
  results: FilteredSearchResult[];
  total: number;
  query?: string;
}

export interface ContentSearchParams {
  projectId: string;
  sessionId: string;
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  cursor?: number;
  pageSize?: number;
}

export type ContentMatchSource =
  | 'userMessage'
  | 'aiText'
  | 'aiThinking'
  | 'toolCallName'
  | 'toolCallInput'
  | 'toolResultContent'
  | 'systemText';

export interface ContentSearchMatch {
  chunkIndex: number;
  chunkId: string;
  chunkType: string;
  source: ContentMatchSource;
  contentBlockIndex: number;
  charOffset: number;
  matchLength: number;
  contextSnippet: string;
  matchedText: string;
}

export interface ContentSearchResult {
  matches: ContentSearchMatch[];
  totalMatches: number;
  nextCursor: number | null;
  hasMore: boolean;
  query: string;
  isRegex: boolean;
  chunksSearched: number;
}
