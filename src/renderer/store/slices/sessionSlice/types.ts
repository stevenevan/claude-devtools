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
  applyFilterPreset: (filter: SessionFilterState) => void;
  sessionsCursor: string | null;
  sessionsHasMore: boolean;
  sessionsTotalCount: number;
  sessionsLoadingMore: boolean;
  pinnedSessionIds: string[];
  hiddenSessionIds: string[];
  showHiddenSessions: boolean;
  sidebarSelectedSessionIds: string[];
  sidebarMultiSelectActive: boolean;
  sessionSortMode: SessionSortMode;

  fetchSessions: (projectId: string) => Promise<void>;
  fetchSessionsInitial: (projectId: string) => Promise<void>;
  fetchSessionsMore: () => Promise<void>;
  resetSessionsPagination: () => void;
  selectSession: (id: string) => void;
  clearSelection: () => void;
  refreshSessionsInPlace: (projectId: string) => Promise<void>;
  togglePinSession: (sessionId: string) => Promise<void>;
  loadPinnedSessions: () => Promise<void>;
  setSessionSortMode: (mode: SessionSortMode) => void;
  toggleHideSession: (sessionId: string) => Promise<void>;
  hideMultipleSessions: (sessionIds: string[]) => Promise<void>;
  unhideMultipleSessions: (sessionIds: string[]) => Promise<void>;
  loadHiddenSessions: () => Promise<void>;
  toggleShowHiddenSessions: () => void;
  toggleSidebarSessionSelection: (sessionId: string) => void;
  clearSidebarSelection: () => void;
  toggleSidebarMultiSelect: () => void;
  pinMultipleSessions: (sessionIds: string[]) => Promise<void>;
}

type SessionSliceCreator = StateCreator<AppState, [], [], SessionSlice>;
export type SessionSliceSet = Parameters<SessionSliceCreator>[0];
export type SessionSliceGet = Parameters<SessionSliceCreator>[1];
