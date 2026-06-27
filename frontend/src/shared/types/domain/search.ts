
export interface SearchResult {

  sessionId: string;

  projectId: string;

  sessionTitle: string;

  matchedText: string;

  context: string;

  messageType: 'user' | 'assistant';

  timestamp: number;

  groupId?: string;

  itemType?: 'user' | 'ai';

  matchIndexInItem?: number;

  matchStartOffset?: number;

  messageUuid?: string;
}

export interface SearchSessionsResult {

  results: SearchResult[];

  totalMatches: number;

  sessionsSearched: number;

  query: string;

  isPartial?: boolean;
}

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

export interface SearchFilters {
  query?: string;
  statusFilter?: 'ongoing' | 'completed';
  minCreatedAt?: number;
  maxCreatedAt?: number;
}

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
