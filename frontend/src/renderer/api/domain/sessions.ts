import {
  GetProjects,
  GetRepositoryGroups,
  GetSessionDetail,
  GetSessionDetailIncremental,
  GetSessionGroups,
  GetSessions,
  GetSessionsByIds,
  GetSessionsPaginated,
  GetSubagentDetail,
  GetWaterfallData,
  GetWorktreeSessions,
  ParseSessionMetrics,
} from '../../../../bindings/claude-devtools/internal/sessionservice/sessionservice';
import {
  SearchAllProjects,
  SearchSessionContent,
  SearchSessions,
  SearchSessionsFiltered,
} from '../../../../bindings/claude-devtools/internal/searchservice/searchservice';
import {
  SnapshotsCreateFromSession,
  SnapshotsDelete,
  SnapshotsList,
  SnapshotsOpen,
} from '../../../../bindings/claude-devtools/internal/snapshotservice/snapshotservice';

import { reviveDates } from '../reviveDates';

import type {
  ContentSearchResult,
  ConversationGroup,
  WailsAPI,
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
  WailsAPI,
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
  getProjects: (): Promise<Project[]> =>
    GetProjects() as unknown as Promise<Project[]>,

  getSessions: (projectId: string): Promise<Session[]> =>
    GetSessions(projectId, null) as unknown as Promise<Session[]>,

  getSessionsPaginated: (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> =>
    GetSessionsPaginated(
      projectId,
      cursor,
      limit ?? null,
      (options ?? null) as unknown as Parameters<typeof GetSessionsPaginated>[3],
      null
    ) as unknown as Promise<PaginatedSessionsResult>,

  searchSessions: (
    projectId: string,
    query: string,
    maxResults?: number
  ): Promise<SearchSessionsResult> =>
    SearchSessions(
      projectId,
      query,
      maxResults ?? null,
      null
    ) as unknown as Promise<SearchSessionsResult>,

  searchAllProjects: (query: string, maxResults?: number): Promise<SearchSessionsResult> =>
    SearchAllProjects(query, maxResults ?? null, null) as unknown as Promise<SearchSessionsResult>,

  searchSessionsFiltered: (
    filters: SearchFilters,
    maxResults?: number
  ): Promise<FilteredSearchResponse> =>
    SearchSessionsFiltered(
      filters.query ?? null,
      maxResults ?? null,
      filters.statusFilter ?? null,
      filters.minCreatedAt ?? null,
      filters.maxCreatedAt ?? null,
      null
    ) as unknown as Promise<FilteredSearchResponse>,

  searchSessionContent: (
    projectId: string,
    sessionId: string,
    query: string,
    isRegex?: boolean,
    caseSensitive?: boolean,
    cursor?: number,
    pageSize?: number
  ): Promise<ContentSearchResult> =>
    SearchSessionContent(
      projectId,
      sessionId,
      query,
      isRegex ?? false,
      caseSensitive ?? false,
      cursor ?? null,
      pageSize ?? null
    ) as unknown as Promise<ContentSearchResult>,

  getSessionDetail: async (projectId: string, sessionId: string): Promise<SessionDetail | null> => {
    const raw = await GetSessionDetail(projectId, sessionId);
    return reviveDates(raw as unknown as SessionDetail);
  },

  getSessionDetailIncremental: async (
    projectId: string,
    sessionId: string
  ): Promise<SessionDetail | null> => {
    const raw = await GetSessionDetailIncremental(projectId, sessionId);
    return reviveDates(raw as unknown as SessionDetail);
  },

  getSessionMetrics: (projectId: string, sessionId: string): Promise<SessionMetrics | null> =>
    ParseSessionMetrics(projectId, sessionId) as unknown as Promise<SessionMetrics | null>,

  getWaterfallData: async (projectId: string, sessionId: string): Promise<WaterfallData | null> => {
    const raw = await GetWaterfallData(projectId, sessionId);
    return raw ? reviveDates(raw as unknown as WaterfallData) : null;
  },

  getSubagentDetail: async (
    projectId: string,
    sessionId: string,
    subagentId: string
  ): Promise<SubagentDetail | null> => {
    const raw = await GetSubagentDetail(projectId, sessionId, subagentId);
    return raw ? reviveDates(raw as unknown as SubagentDetail) : null;
  },

  getSessionGroups: (projectId: string, sessionId: string): Promise<ConversationGroup[]> =>
    GetSessionGroups(projectId, sessionId) as unknown as Promise<ConversationGroup[]>,

  getSessionsByIds: (
    projectId: string,
    sessionIds: string[],
    _options?: SessionsByIdsOptions
  ): Promise<Session[]> =>
    GetSessionsByIds(projectId, sessionIds, null) as unknown as Promise<Session[]>,

  getRepositoryGroups: (): Promise<RepositoryGroup[]> =>
    GetRepositoryGroups() as unknown as Promise<RepositoryGroup[]>,

  getWorktreeSessions: (worktreeId: string): Promise<Session[]> =>
    GetWorktreeSessions(worktreeId) as unknown as Promise<Session[]>,

  snapshots: {
    list: () => SnapshotsList() as unknown as Promise<SnapshotMeta[]>,
    createFromSession: (projectId, sessionId, label) =>
      SnapshotsCreateFromSession(projectId, sessionId, label ?? null) as unknown as Promise<SnapshotMeta>,
    delete: (snapshotId) => SnapshotsDelete(snapshotId),
    open: async (snapshotId) => {
      const raw = await SnapshotsOpen(snapshotId);
      return reviveDates(raw as unknown as SessionDetail);
    },
  } satisfies SnapshotsAPI,
};
