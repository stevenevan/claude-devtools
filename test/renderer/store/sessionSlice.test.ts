/**
 * Tests for the sessionSlice - session list, pagination, pinning, hiding, multi-select.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTestStore } from './storeTestUtils';

import type { Session } from '../../../src/renderer/types/data';
import type { TestStore } from './storeTestUtils';

// Mock the API module to prevent Tauri invoke errors in async operations
vi.mock('../../../src/renderer/api', () => ({
  api: {
    getSessions: vi.fn().mockResolvedValue([]),
    getSessionsPaginated: vi.fn().mockResolvedValue({
      sessions: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    }),
    getSessionsByIds: vi.fn().mockResolvedValue([]),
    getSessionDetail: vi.fn().mockResolvedValue(null),
    getSessionDetailIncremental: vi.fn().mockResolvedValue(null),
    readClaudeMdFiles: vi.fn().mockResolvedValue({}),
    readDirectoryClaudeMd: vi.fn().mockResolvedValue(null),
    readMentionedFile: vi.fn().mockResolvedValue(null),
    readAgentConfigs: vi.fn().mockResolvedValue({}),
    config: {
      get: vi.fn().mockResolvedValue({ sessions: {} }),
      pinSession: vi.fn().mockResolvedValue(undefined),
      unpinSession: vi.fn().mockResolvedValue(undefined),
      hideSession: vi.fn().mockResolvedValue(undefined),
      unhideSession: vi.fn().mockResolvedValue(undefined),
      hideSessions: vi.fn().mockResolvedValue(undefined),
      unhideSessions: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

let store: TestStore;

beforeEach(() => {
  store = createTestStore();
});

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    messageCount: 5,
    isOngoing: false,
    projectPath: '/test/project',
    ...overrides,
  } as Session;
}

describe('sessionSlice', () => {
  describe('initial state', () => {
    it('starts with empty sessions and default pagination', () => {
      const state = store.getState();
      expect(state.sessions).toEqual([]);
      expect(state.selectedSessionId).toBeNull();
      expect(state.sessionsLoading).toBe(false);
      expect(state.sessionsError).toBeNull();
      expect(state.sessionsCursor).toBeNull();
      expect(state.sessionsHasMore).toBe(false);
      expect(state.sessionsTotalCount).toBe(0);
      expect(state.sessionsLoadingMore).toBe(false);
      expect(state.pinnedSessionIds).toEqual([]);
      expect(state.hiddenSessionIds).toEqual([]);
      expect(state.showHiddenSessions).toBe(false);
      expect(state.sidebarSelectedSessionIds).toEqual([]);
      expect(state.sidebarMultiSelectActive).toBe(false);
      expect(state.sessionSortMode).toBe('recent');
    });
  });

  describe('selectSession', () => {
    it('sets selectedSessionId and resets detail state', () => {
      // Set a project so selectSession doesn't warn about missing project
      store.setState({ selectedProjectId: 'p1' });
      store.getState().selectSession('session-1');

      const state = store.getState();
      expect(state.selectedSessionId).toBe('session-1');
      expect(state.sessionDetail).toBeNull();
      expect(state.sessionContextStats).toBeNull();
      expect(state.sessionDetailError).toBeNull();
    });
  });

  describe('clearSelection', () => {
    it('clears all selection state', () => {
      store.setState({
        selectedProjectId: 'p1',
        selectedSessionId: 's1',
        sessions: [makeSession({ id: 's1' })],
      });

      store.getState().clearSelection();

      const state = store.getState();
      expect(state.selectedProjectId).toBeNull();
      expect(state.selectedSessionId).toBeNull();
      expect(state.sessions).toEqual([]);
      expect(state.sessionDetail).toBeNull();
    });
  });

  describe('resetSessionsPagination', () => {
    it('resets all pagination state', () => {
      store.setState({
        sessions: [makeSession({ id: 's1' })],
        sessionsCursor: 'cursor-1',
        sessionsHasMore: true,
        sessionsTotalCount: 50,
        sessionsLoadingMore: true,
        sessionsError: 'some error',
      });

      store.getState().resetSessionsPagination();

      const state = store.getState();
      expect(state.sessions).toEqual([]);
      expect(state.sessionsCursor).toBeNull();
      expect(state.sessionsHasMore).toBe(false);
      expect(state.sessionsTotalCount).toBe(0);
      expect(state.sessionsLoadingMore).toBe(false);
      expect(state.sessionsError).toBeNull();
    });
  });

  describe('pinning', () => {
    it('togglePinSession adds sessionId to pinnedSessionIds optimistically', async () => {
      store.setState({
        selectedProjectId: 'p1',
        pinnedSessionIds: [],
      });

      // Don't await — just trigger the optimistic update
      void store.getState().togglePinSession('s1');

      // Check optimistic state immediately
      expect(store.getState().pinnedSessionIds).toContain('s1');
    });

    it('togglePinSession removes sessionId when already pinned', async () => {
      store.setState({
        selectedProjectId: 'p1',
        pinnedSessionIds: ['s1', 's2'],
      });

      void store.getState().togglePinSession('s1');

      expect(store.getState().pinnedSessionIds).not.toContain('s1');
      expect(store.getState().pinnedSessionIds).toContain('s2');
    });

    it('togglePinSession no-ops without selectedProjectId', () => {
      store.setState({ pinnedSessionIds: [] });
      void store.getState().togglePinSession('s1');
      expect(store.getState().pinnedSessionIds).toEqual([]);
    });
  });

  describe('hiding', () => {
    it('toggleHideSession adds sessionId to hiddenSessionIds optimistically', () => {
      store.setState({
        selectedProjectId: 'p1',
        hiddenSessionIds: [],
      });

      void store.getState().toggleHideSession('s1');

      expect(store.getState().hiddenSessionIds).toContain('s1');
    });

    it('toggleHideSession removes sessionId when already hidden', () => {
      store.setState({
        selectedProjectId: 'p1',
        hiddenSessionIds: ['s1', 's2'],
      });

      void store.getState().toggleHideSession('s1');

      expect(store.getState().hiddenSessionIds).not.toContain('s1');
      expect(store.getState().hiddenSessionIds).toContain('s2');
    });

    it('hideMultipleSessions adds multiple IDs optimistically', () => {
      store.setState({
        selectedProjectId: 'p1',
        hiddenSessionIds: ['s1'],
      });

      void store.getState().hideMultipleSessions(['s2', 's3']);

      const hidden = store.getState().hiddenSessionIds;
      expect(hidden).toContain('s1');
      expect(hidden).toContain('s2');
      expect(hidden).toContain('s3');
    });

    it('hideMultipleSessions deduplicates existing IDs', () => {
      store.setState({
        selectedProjectId: 'p1',
        hiddenSessionIds: ['s1'],
      });

      void store.getState().hideMultipleSessions(['s1', 's2']);

      // s1 should not be duplicated
      const hidden = store.getState().hiddenSessionIds;
      expect(hidden.filter((id) => id === 's1')).toHaveLength(1);
    });

    it('unhideMultipleSessions removes multiple IDs optimistically', () => {
      store.setState({
        selectedProjectId: 'p1',
        hiddenSessionIds: ['s1', 's2', 's3'],
      });

      void store.getState().unhideMultipleSessions(['s1', 's3']);

      const hidden = store.getState().hiddenSessionIds;
      expect(hidden).toEqual(['s2']);
    });

    it('toggleShowHiddenSessions toggles the flag', () => {
      expect(store.getState().showHiddenSessions).toBe(false);
      store.getState().toggleShowHiddenSessions();
      expect(store.getState().showHiddenSessions).toBe(true);
      store.getState().toggleShowHiddenSessions();
      expect(store.getState().showHiddenSessions).toBe(false);
    });
  });

  describe('sort mode', () => {
    it('sets session sort mode', () => {
      store.getState().setSessionSortMode('alphabetical');
      expect(store.getState().sessionSortMode).toBe('alphabetical');

      store.getState().setSessionSortMode('recent');
      expect(store.getState().sessionSortMode).toBe('recent');
    });
  });

  describe('sidebar multi-select', () => {
    it('toggleSidebarSessionSelection adds and removes sessions', () => {
      store.getState().toggleSidebarSessionSelection('s1');
      expect(store.getState().sidebarSelectedSessionIds).toEqual(['s1']);
      expect(store.getState().sidebarMultiSelectActive).toBe(true);

      store.getState().toggleSidebarSessionSelection('s2');
      expect(store.getState().sidebarSelectedSessionIds).toEqual(['s1', 's2']);

      store.getState().toggleSidebarSessionSelection('s1');
      expect(store.getState().sidebarSelectedSessionIds).toEqual(['s2']);
    });

    it('clearSidebarSelection clears all and exits multi-select', () => {
      store.getState().toggleSidebarSessionSelection('s1');
      store.getState().toggleSidebarSessionSelection('s2');

      store.getState().clearSidebarSelection();

      expect(store.getState().sidebarSelectedSessionIds).toEqual([]);
      expect(store.getState().sidebarMultiSelectActive).toBe(false);
    });

    it('toggleSidebarMultiSelect enters and exits selection mode', () => {
      expect(store.getState().sidebarMultiSelectActive).toBe(false);

      store.getState().toggleSidebarMultiSelect();
      expect(store.getState().sidebarMultiSelectActive).toBe(true);

      // Exiting clears selections
      store.getState().toggleSidebarSessionSelection('s1');
      store.getState().toggleSidebarMultiSelect();
      expect(store.getState().sidebarMultiSelectActive).toBe(false);
      expect(store.getState().sidebarSelectedSessionIds).toEqual([]);
    });
  });

  describe('bulk pin', () => {
    it('pinMultipleSessions adds new IDs optimistically', () => {
      store.setState({
        selectedProjectId: 'p1',
        pinnedSessionIds: ['s1'],
      });

      void store.getState().pinMultipleSessions(['s2', 's3']);

      const pinned = store.getState().pinnedSessionIds;
      expect(pinned).toContain('s1');
      expect(pinned).toContain('s2');
      expect(pinned).toContain('s3');
    });

    it('pinMultipleSessions skips already-pinned IDs', () => {
      store.setState({
        selectedProjectId: 'p1',
        pinnedSessionIds: ['s1'],
      });

      void store.getState().pinMultipleSessions(['s1', 's2']);

      const pinned = store.getState().pinnedSessionIds;
      expect(pinned.filter((id) => id === 's1')).toHaveLength(1);
    });

    it('pinMultipleSessions no-ops without selectedProjectId', () => {
      store.setState({ pinnedSessionIds: [] });
      void store.getState().pinMultipleSessions(['s1']);
      expect(store.getState().pinnedSessionIds).toEqual([]);
    });
  });
});
