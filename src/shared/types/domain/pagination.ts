import { type Session, type SessionMetadataLevel } from './project';

/**
 * Cursor for session pagination.
 * Uses timestamp + sessionId as a composite cursor for stable pagination.
 */
export interface SessionCursor {
  /** Unix timestamp (birthtimeMs) of the session file */
  timestamp: number;
  /** Session ID for tie-breaking when timestamps are equal */
  sessionId: string;
}

/**
 * Result of paginated session listing.
 */
export interface PaginatedSessionsResult {
  /** Sessions for this page */
  sessions: Session[];
  /** Cursor for next page (null if no more pages) */
  nextCursor: string | null;
  /** Whether there are more sessions to load */
  hasMore: boolean;
  /** Total count of sessions (for display purposes) */
  totalCount: number;
}

/**
 * Options controlling paginated session listing behavior.
 */
export interface SessionsPaginationOptions {
  /**
   * Whether to compute an accurate totalCount by scanning all sessions.
   * Disable for faster background refreshes.
   * @default true
   */
  includeTotalCount?: boolean;
  /**
   * Whether to pre-filter all session files before paging.
   * Disable for faster top-of-list refreshes.
   * @default true
   */
  prefilterAll?: boolean;
  /**
   * Metadata depth to return for listed sessions.
   * - light: filesystem metadata only (fast)
   * - deep: includes parsed session content summary fields (slower)
   * @default 'deep'
   */
  metadataLevel?: SessionMetadataLevel;
}
