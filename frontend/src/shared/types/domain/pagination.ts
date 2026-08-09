import { type GlobalSession, type Session, type SessionMetadataLevel } from './project';

export interface SessionCursor {

  timestamp: number;

  sessionId: string;
}

export interface PaginatedSessionsResult {

  sessions: Session[];

  nextCursor: string | null;

  hasMore: boolean;

  totalCount: number;
}

export interface PaginatedGlobalSessionsResult {
  sessions: GlobalSession[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SessionsPaginationOptions {

  includeTotalCount?: boolean;

  prefilterAll?: boolean;

  metadataLevel?: SessionMetadataLevel;
}
