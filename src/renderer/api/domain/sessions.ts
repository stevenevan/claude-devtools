import { invoke } from '@tauri-apps/api/core';

import { reviveDates } from '../reviveDates';

import type {
  ContentSearchResult,
  ConversationGroup,
  ElectronAPI,
  FilteredSearchResponse,
  PaginatedSessionsResult,
  Project,
  RepositoryGroup,
  SearchFilters,
  SearchSessionsResult,
  Session,
  SessionDetail,
  SessionMetrics,
  SessionsByIdsOptions,
  SessionsPaginationOptions,
  SnapshotMeta,
  SnapshotsAPI,
  SubagentDetail,
  WaterfallData,
} from '@shared/types';

type SessionsSlice = Pick<
  ElectronAPI,
  | 'getProjects'
  | 'getSessions'
  | 'getSessionsPaginated'
  | 'searchSessions'
  | 'searchAllProjects'
  | 'searchSessionsFiltered'
  | 'searchSessionContent'
  | 'getSessionDetail'
  | 'getSessionDetailIncremental'
  | 'getSessionMetrics'
  | 'getWaterfallData'
  | 'getSubagentDetail'
  | 'getSessionGroups'
  | 'getSessionsByIds'
  | 'getRepositoryGroups'
  | 'getWorktreeSessions'
  | 'snapshots'
>;

export const sessionsApi: SessionsSlice = {
  getProjects: (): Promise<Project[]> => invoke<Project[]>('get_projects'),

  getSessions: (projectId: string): Promise<Session[]> =>
    invoke<Session[]>('get_sessions', { projectId }),

  getSessionsPaginated: (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> =>
    invoke<PaginatedSessionsResult>('get_sessions_paginated', {
      projectId,
      cursor,
      limit,
      options,
    }),

  searchSessions: (
    projectId: string,
    query: string,
    maxResults?: number
  ): Promise<SearchSessionsResult> =>
    invoke<SearchSessionsResult>('search_sessions', { projectId, query, maxResults }),

  searchAllProjects: (query: string, maxResults?: number): Promise<SearchSessionsResult> =>
    invoke<SearchSessionsResult>('search_all_projects', { query, maxResults }),

  searchSessionsFiltered: (
    filters: SearchFilters,
    maxResults?: number
  ): Promise<FilteredSearchResponse> =>
    invoke<FilteredSearchResponse>('search_sessions_filtered', {
      query: filters.query ?? null,
      maxResults,
      statusFilter: filters.statusFilter ?? null,
      minCreatedAt: filters.minCreatedAt ?? null,
      maxCreatedAt: filters.maxCreatedAt ?? null,
    }),

  searchSessionContent: (
    projectId: string,
    sessionId: string,
    query: string,
    isRegex?: boolean,
    caseSensitive?: boolean,
    cursor?: number,
    pageSize?: number
  ): Promise<ContentSearchResult> =>
    invoke<ContentSearchResult>('search_session_content', {
      projectId,
      sessionId,
      query,
      isRegex: isRegex ?? false,
      caseSensitive: caseSensitive ?? false,
      cursor: cursor ?? null,
      pageSize: pageSize ?? null,
    }),

  getSessionDetail: async (projectId: string, sessionId: string): Promise<SessionDetail | null> => {
    const raw = await invoke<SessionDetail>('get_session_detail', { projectId, sessionId });
    return reviveDates(raw);
  },

  getSessionDetailIncremental: async (
    projectId: string,
    sessionId: string
  ): Promise<SessionDetail | null> => {
    const raw = await invoke<SessionDetail>('get_session_detail_incremental', {
      projectId,
      sessionId,
    });
    return reviveDates(raw);
  },

  getSessionMetrics: (projectId: string, sessionId: string): Promise<SessionMetrics | null> =>
    invoke<SessionMetrics>('parse_session_metrics', { projectId, sessionId }),

  getWaterfallData: async (projectId: string, sessionId: string): Promise<WaterfallData | null> => {
    const raw = await invoke<WaterfallData | null>('get_waterfall_data', {
      projectId,
      sessionId,
    });
    return raw ? reviveDates(raw) : null;
  },

  getSubagentDetail: async (
    projectId: string,
    sessionId: string,
    subagentId: string
  ): Promise<SubagentDetail | null> => {
    const raw = await invoke<SubagentDetail | null>('get_subagent_detail', {
      projectId,
      sessionId,
      subagentId,
    });
    return raw ? reviveDates(raw) : null;
  },

  getSessionGroups: (projectId: string, sessionId: string): Promise<ConversationGroup[]> =>
    invoke<ConversationGroup[]>('get_session_groups', { projectId, sessionId }),

  getSessionsByIds: (
    projectId: string,
    sessionIds: string[],
    _options?: SessionsByIdsOptions
  ): Promise<Session[]> => invoke<Session[]>('get_sessions_by_ids', { projectId, sessionIds }),

  getRepositoryGroups: (): Promise<RepositoryGroup[]> =>
    invoke<RepositoryGroup[]>('get_repository_groups'),

  getWorktreeSessions: (worktreeId: string): Promise<Session[]> =>
    invoke<Session[]>('get_worktree_sessions', { worktreeId }),

  snapshots: {
    list: () => invoke<SnapshotMeta[]>('snapshots_list'),
    createFromSession: (projectId, sessionId, label) =>
      invoke<SnapshotMeta>('snapshots_create_from_session', {
        projectId,
        sessionId,
        label: label ?? null,
      }),
    delete: (snapshotId) => invoke<void>('snapshots_delete', { snapshotId }),
    open: async (snapshotId) => {
      const raw = await invoke<SessionDetail>('snapshots_open', { snapshotId });
      return reviveDates(raw);
    },
  } satisfies SnapshotsAPI,
};
