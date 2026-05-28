import type { AppState } from '../../types';
import type { Session, SessionSortMode } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

export interface SessionFilterState {
  dateMin?: number;
  dateMax?: number;
  minContext?: number;
  maxContext?: number;
  minCompactions?: number;
  agentName?: string;
  tags?: string[];
}

export interface SessionSlice {
  sessions: Session[];
  selectedSessionId: string | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  activeFilters: SessionFilterState;
  setFilter: (patch: Partial<SessionFilterState>) => void;
  clearFilters: () => void;
  /** Replace activeFilters wholesale with a preset payload (sprint 35).
   * Replaces (not merges) so absent fields are cleared. */
  applyFilterPreset: (filter: SessionFilterState) => void;
  // Pagination state
  sessionsCursor: string | null;
  sessionsHasMore: boolean;
  sessionsTotalCount: number;
  sessionsLoadingMore: boolean;
  // Pinned sessions
  pinnedSessionIds: string[];
  // Hidden sessions
  hiddenSessionIds: string[];
  showHiddenSessions: boolean;
  // Multi-select
  sidebarSelectedSessionIds: string[];
  sidebarMultiSelectActive: boolean;
  // Sort mode
  sessionSortMode: SessionSortMode;

  fetchSessions: (projectId: string) => Promise<void>;
  fetchSessionsInitial: (projectId: string) => Promise<void>;
  fetchSessionsMore: () => Promise<void>;
  resetSessionsPagination: () => void;
  selectSession: (id: string) => void;
  clearSelection: () => void;
  /** Refresh sessions list without loading states - for real-time updates */
  refreshSessionsInPlace: (projectId: string) => Promise<void>;
  /** Toggle pin/unpin for a session */
  togglePinSession: (sessionId: string) => Promise<void>;
  /** Load pinned sessions from config for current project */
  loadPinnedSessions: () => Promise<void>;
  /** Set session sort mode */
  setSessionSortMode: (mode: SessionSortMode) => void;
  /** Toggle hide/unhide for a session */
  toggleHideSession: (sessionId: string) => Promise<void>;
  /** Bulk hide sessions */
  hideMultipleSessions: (sessionIds: string[]) => Promise<void>;
  /** Bulk unhide sessions */
  unhideMultipleSessions: (sessionIds: string[]) => Promise<void>;
  /** Load hidden sessions from config for current project */
  loadHiddenSessions: () => Promise<void>;
  /** Toggle showing hidden sessions in sidebar */
  toggleShowHiddenSessions: () => void;
  /** Toggle one session's checkbox in sidebar multi-select */
  toggleSidebarSessionSelection: (sessionId: string) => void;
  /** Clear all selections and exit multi-select mode */
  clearSidebarSelection: () => void;
  /** Enter/exit selection mode */
  toggleSidebarMultiSelect: () => void;
  /** Bulk pin for multi-select */
  pinMultipleSessions: (sessionIds: string[]) => Promise<void>;
}

type SessionSliceCreator = StateCreator<AppState, [], [], SessionSlice>;
export type SessionSliceSet = Parameters<SessionSliceCreator>[0];
export type SessionSliceGet = Parameters<SessionSliceCreator>[1];
