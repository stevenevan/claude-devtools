import { createFilterActions } from './filterActions';
import { createHideActions } from './hideActions';
import { createPaginationActions } from './paginationActions';
import { createPinActions } from './pinActions';
import { createSelectionActions } from './selectionActions';
import { createUiActions } from './uiActions';

import type { AppState } from '../../types';
import type { SessionSlice } from './types';
import type { SessionSortMode } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

export type { SessionFilterState, SessionSlice } from './types';

export const createSessionSlice: StateCreator<AppState, [], [], SessionSlice> = (set, get) => ({
  sessions: [],
  selectedSessionId: null,
  sessionsLoading: false,
  sessionsError: null,
  // Pagination state
  sessionsCursor: null,
  sessionsHasMore: false,
  sessionsTotalCount: 0,
  sessionsLoadingMore: false,
  // Pinned sessions
  pinnedSessionIds: [],
  // Hidden sessions
  hiddenSessionIds: [],
  showHiddenSessions: false,
  // Multi-select
  sidebarSelectedSessionIds: [],
  sidebarMultiSelectActive: false,
  // Sort mode
  sessionSortMode: 'recent' as SessionSortMode,
  // Advanced filters
  activeFilters: {},
  ...createFilterActions(set),
  ...createPaginationActions(set, get),
  ...createSelectionActions(set, get),
  ...createPinActions(set, get),
  ...createHideActions(set, get),
  ...createUiActions(set),
});
