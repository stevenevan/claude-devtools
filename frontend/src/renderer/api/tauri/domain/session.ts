import type { PluginsAPI, SessionAPI, DesktopAPI } from '@shared/types';

import { call } from '../invoke';

type FlatSessionCommands = Pick<
  DesktopAPI,
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
  | 'parseNLQuery'
>;

export const sessionCommands: FlatSessionCommands = {
  getProjects: () => call<Awaited<ReturnType<DesktopAPI['getProjects']>>>('get_projects'),
  getSessions: (projectId) => call<Awaited<ReturnType<DesktopAPI['getSessions']>>>('get_sessions', { projectId }),
  getSessionsPaginated: (projectId, cursor, limit, options) =>
    call<Awaited<ReturnType<DesktopAPI['getSessionsPaginated']>>>('get_sessions_paginated', {
      projectId,
      cursor,
      limit: limit ?? null,
      options: options ?? null,
    }),
  searchSessions: (projectId, query, maxResults) =>
    call<Awaited<ReturnType<DesktopAPI['searchSessions']>>>('search_sessions', {
      projectId,
      query,
      maxResults: maxResults ?? null,
    }),
  searchAllProjects: (query, maxResults) =>
    call<Awaited<ReturnType<DesktopAPI['searchAllProjects']>>>('search_all_projects', {
      query,
      maxResults: maxResults ?? null,
    }),
  searchSessionsFiltered: (filters, maxResults) =>
    call<Awaited<ReturnType<DesktopAPI['searchSessionsFiltered']>>>('search_sessions_filtered', {
      query: filters.query ?? null,
      maxResults: maxResults ?? null,
      statusFilter: filters.statusFilter ?? null,
      minCreatedAt: filters.minCreatedAt ?? null,
      maxCreatedAt: filters.maxCreatedAt ?? null,
    }),
  searchSessionContent: (projectId, sessionId, query, isRegex, caseSensitive, cursor, pageSize) =>
    call<Awaited<ReturnType<DesktopAPI['searchSessionContent']>>>('search_session_content', {
      projectId,
      sessionId,
      query,
      isRegex: isRegex ?? false,
      caseSensitive: caseSensitive ?? false,
      cursor: cursor ?? null,
      pageSize: pageSize ?? null,
    }),
  getSessionDetail: (projectId, sessionId) =>
    call<Awaited<ReturnType<DesktopAPI['getSessionDetail']>>>(
      'get_session_detail',
      { projectId, sessionId },
      { reviveDates: true }
    ),
  getSessionDetailIncremental: (projectId, sessionId) =>
    call<Awaited<ReturnType<DesktopAPI['getSessionDetailIncremental']>>>(
      'get_session_detail_incremental',
      { projectId, sessionId },
      { reviveDates: true }
    ),
  getSessionMetrics: (projectId, sessionId) =>
    call<Awaited<ReturnType<DesktopAPI['getSessionMetrics']>>>('get_session_metrics', {
      projectId,
      sessionId,
    }),
  getWaterfallData: (projectId, sessionId) =>
    call<Awaited<ReturnType<DesktopAPI['getWaterfallData']>>>(
      'get_waterfall_data',
      { projectId, sessionId },
      { reviveDates: true }
    ),
  getSubagentDetail: (projectId, sessionId, subagentId) =>
    call<Awaited<ReturnType<DesktopAPI['getSubagentDetail']>>>(
      'get_subagent_detail',
      { projectId, sessionId, subagentId },
      { reviveDates: true }
    ),
  getSessionGroups: (projectId, sessionId) =>
    call<Awaited<ReturnType<DesktopAPI['getSessionGroups']>>>('get_session_groups', {
      projectId,
      sessionId,
    }),
  getSessionsByIds: (projectId, sessionIds) =>
    call<Awaited<ReturnType<DesktopAPI['getSessionsByIds']>>>('get_sessions_by_ids', {
      projectId,
      sessionIds,
    }),
  getRepositoryGroups: () =>
    call<Awaited<ReturnType<DesktopAPI['getRepositoryGroups']>>>('get_repository_groups'),
  getWorktreeSessions: (worktreeId) =>
    call<Awaited<ReturnType<DesktopAPI['getWorktreeSessions']>>>('get_worktree_sessions', {
      worktreeId,
    }),
  parseNLQuery: (query) => call<Awaited<ReturnType<DesktopAPI['parseNLQuery']>>>('parse_nl_query', { query }),
};

export const sessionApi: SessionAPI = {
  scrollToLine: (sessionId, lineNumber) =>
    call<void>('session_scroll_to_line', { sessionId, lineNumber }),
};

export const pluginsApi: PluginsAPI = {
  list: () => call<Awaited<ReturnType<PluginsAPI['list']>>>('plugins_discover'),
};
