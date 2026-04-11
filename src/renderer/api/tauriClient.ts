/**
 * Tauri-based implementation of ElectronAPI.
 *
 * All data operations use Tauri invoke() to call native Rust commands.
 * Native operations (dialogs, shell, window controls) use Tauri plugin APIs.
 */

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';

// eslint-disable-next-line security/detect-unsafe-regex -- anchored pattern with bounded quantifier; no backtracking risk
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;

/**
 * Recursively convert ISO-8601 date strings to Date objects in a plain object.
 * Tauri invoke() returns raw JSON without a JSON.parse reviver, so date fields
 * from Rust (serialized as ISO strings) need manual conversion to match the
 * Date instances the renderer expects (e.g. for .getTime() calls).
 */
function reviveDates<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' && ISO_DATE_RE.test(obj)) {
    const d = new Date(obj);
    if (!isNaN(d.getTime())) return d as unknown as T;
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(reviveDates) as unknown as T;
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = reviveDates(value);
    }
    return result as T;
  }
  return obj;
}

import type {
  AnalyticsResponse,
  AppConfig,
  ClaudeMdFileInfo,
  ClaudeRootFolderSelection,
  ClaudeRootInfo,
  ConfigAPI,
  ContextInfo,
  ConversationGroup,
  ElectronAPI,
  FileChangeEvent,
  FilteredSearchResponse,
  HttpServerAPI,
  HttpServerStatus,
  NotificationsAPI,
  NotificationTrigger,
  PaginatedSessionsResult,
  Project,
  RepositoryGroup,
  SearchSessionsResult,
  Session,
  SessionAPI,
  SessionDetail,
  SessionMetrics,
  SessionsByIdsOptions,
  SessionsPaginationOptions,
  SshAPI,
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionStatus,
  SshLastConnection,
  SubagentDetail,
  TriggerTestResult,
  UpdaterAPI,
  WaterfallData,
  WslClaudeRootCandidate,
} from '@shared/types';
import type { AgentConfig, GlobalAgent, GlobalPlugin, GlobalSkill } from '@shared/types/api';

export class TauriAPIClient implements ElectronAPI {
  // ---------------------------------------------------------------------------
  // Native: App version (from Cargo.toml via Tauri)
  // ---------------------------------------------------------------------------

  getAppVersion = (): Promise<string> => getVersion();

  // ---------------------------------------------------------------------------
  // Data operations — Rust invoke()
  // ---------------------------------------------------------------------------

  getProjects = (): Promise<Project[]> => invoke<Project[]>('get_projects');

  getSessions = (projectId: string): Promise<Session[]> =>
    invoke<Session[]>('get_sessions', { projectId });

  getSessionsPaginated = (
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
    });

  searchSessions = (
    projectId: string,
    query: string,
    maxResults?: number
  ): Promise<SearchSessionsResult> =>
    invoke<SearchSessionsResult>('search_sessions', { projectId, query, maxResults });

  searchAllProjects = (query: string, maxResults?: number): Promise<SearchSessionsResult> =>
    invoke<SearchSessionsResult>('search_all_projects', { query, maxResults });

  searchSessionsFiltered = (
    filters: import('@shared/types/domain').SearchFilters,
    maxResults?: number
  ): Promise<FilteredSearchResponse> =>
    invoke<FilteredSearchResponse>('search_sessions_filtered', {
      query: filters.query ?? null,
      maxResults,
      statusFilter: filters.statusFilter ?? null,
      minCreatedAt: filters.minCreatedAt ?? null,
      maxCreatedAt: filters.maxCreatedAt ?? null,
    });

  searchSessionContent = (
    projectId: string,
    sessionId: string,
    query: string,
    isRegex?: boolean,
    caseSensitive?: boolean,
    cursor?: number,
    pageSize?: number
  ): Promise<import('@shared/types/domain').ContentSearchResult> =>
    invoke<import('@shared/types/domain').ContentSearchResult>('search_session_content', {
      projectId,
      sessionId,
      query,
      isRegex: isRegex ?? false,
      caseSensitive: caseSensitive ?? false,
      cursor: cursor ?? null,
      pageSize: pageSize ?? null,
    });

  getSessionDetail = async (
    projectId: string,
    sessionId: string
  ): Promise<SessionDetail | null> => {
    const raw = await invoke<SessionDetail>('get_session_detail', { projectId, sessionId });
    return reviveDates(raw);
  };

  getSessionDetailIncremental = async (
    projectId: string,
    sessionId: string
  ): Promise<SessionDetail | null> => {
    const raw = await invoke<SessionDetail>('get_session_detail_incremental', { projectId, sessionId });
    return reviveDates(raw);
  };

  getSessionMetrics = (projectId: string, sessionId: string): Promise<SessionMetrics | null> =>
    invoke<SessionMetrics>('parse_session_metrics', { projectId, sessionId });

  getAnalytics = (days: number): Promise<AnalyticsResponse> =>
    invoke<AnalyticsResponse>('get_analytics', { days });

  getWaterfallData = async (
    projectId: string,
    sessionId: string
  ): Promise<WaterfallData | null> => {
    const raw = await invoke<WaterfallData | null>('get_waterfall_data', {
      projectId,
      sessionId,
    });
    return raw ? reviveDates(raw) : null;
  };

  getSubagentDetail = async (
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
  };

  getSessionGroups = (projectId: string, sessionId: string): Promise<ConversationGroup[]> =>
    invoke<ConversationGroup[]>('get_session_groups', { projectId, sessionId });

  getSessionsByIds = (
    projectId: string,
    sessionIds: string[],
    _options?: SessionsByIdsOptions
  ): Promise<Session[]> => invoke<Session[]>('get_sessions_by_ids', { projectId, sessionIds });

  getRepositoryGroups = (): Promise<RepositoryGroup[]> =>
    invoke<RepositoryGroup[]>('get_repository_groups');

  getWorktreeSessions = (worktreeId: string): Promise<Session[]> =>
    invoke<Session[]>('get_worktree_sessions', { worktreeId });

  validatePath = (
    relativePath: string,
    projectPath: string
  ): Promise<{ exists: boolean; isDirectory?: boolean }> =>
    invoke<{ exists: boolean; isDirectory?: boolean }>('validate_path', {
      relativePath,
      projectPath,
    });

  validateMentions = (
    mentions: { type: 'path'; value: string }[],
    projectPath: string
  ): Promise<Record<string, boolean>> =>
    invoke<Record<string, boolean>>('validate_mentions', { mentions, projectPath });

  readClaudeMdFiles = (projectRoot: string): Promise<Record<string, ClaudeMdFileInfo>> =>
    invoke<Record<string, ClaudeMdFileInfo>>('read_claude_md_files', { projectRoot });

  readDirectoryClaudeMd = (dirPath: string): Promise<ClaudeMdFileInfo> =>
    invoke<ClaudeMdFileInfo>('read_directory_claude_md', { dirPath });

  readMentionedFile = (
    absolutePath: string,
    projectRoot: string,
    maxTokens?: number
  ): Promise<ClaudeMdFileInfo | null> =>
    invoke<ClaudeMdFileInfo | null>('read_mentioned_file', {
      absolutePath,
      projectRoot,
      maxTokens,
    });

  readAgentConfigs = (projectRoot: string): Promise<Record<string, AgentConfig>> =>
    invoke<Record<string, AgentConfig>>('read_agent_configs', { projectRoot });

  // ---------------------------------------------------------------------------
  // Global ~/.claude/ config reading
  // ---------------------------------------------------------------------------

  readGlobalAgents = (): Promise<GlobalAgent[]> => invoke<GlobalAgent[]>('read_global_agents');

  readGlobalSkills = (): Promise<GlobalSkill[]> => invoke<GlobalSkill[]>('read_global_skills');

  readGlobalPlugins = (): Promise<GlobalPlugin[]> => invoke<GlobalPlugin[]>('read_global_plugins');

  readGlobalSettings = (): Promise<Record<string, unknown>> =>
    invoke<Record<string, unknown>>('read_global_settings');

  // ---------------------------------------------------------------------------
  // Notifications — Rust commands + Tauri events
  // ---------------------------------------------------------------------------

  notifications: NotificationsAPI = {
    get: (options) => invoke('notifications_get', { options }),
    markRead: (id) => invoke<boolean>('notifications_mark_read', { id }),
    markAllRead: () => invoke<boolean>('notifications_mark_all_read'),
    delete: (id) => invoke<boolean>('notifications_delete', { id }),
    clear: () => invoke<boolean>('notifications_clear'),
    getUnreadCount: () => invoke<number>('notifications_get_unread_count'),
    onNew: (callback) => {
      let unlisten: UnlistenFn | null = null;
      listen('notification:new', (event) => {
        callback(null, event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => {
        unlisten?.();
      };
    },
    onUpdated: (callback) => {
      let unlisten: UnlistenFn | null = null;
      listen<{ total: number; unreadCount: number }>('notification:updated', (event) => {
        callback(null, event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => {
        unlisten?.();
      };
    },
    onClicked: (callback) => {
      let unlisten: UnlistenFn | null = null;
      listen('notification:clicked', (event) => {
        callback(null, event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => {
        unlisten?.();
      };
    },
  };

  // ---------------------------------------------------------------------------
  // Config — Rust commands + native dialog overrides
  // ---------------------------------------------------------------------------

  config: ConfigAPI = {
    get: () => invoke<AppConfig>('config_get'),
    update: (section, data) => invoke<AppConfig>('config_update', { section, data }),
    addIgnoreRegex: (pattern) => invoke<AppConfig>('config_add_ignore_regex', { pattern }),
    removeIgnoreRegex: (pattern) => invoke<AppConfig>('config_remove_ignore_regex', { pattern }),
    addIgnoreRepository: (repositoryId) =>
      invoke<AppConfig>('config_add_ignore_repository', { repositoryId }),
    removeIgnoreRepository: (repositoryId) =>
      invoke<AppConfig>('config_remove_ignore_repository', { repositoryId }),
    snooze: (minutes) => invoke<AppConfig>('config_snooze', { minutes }),
    clearSnooze: () => invoke<AppConfig>('config_clear_snooze'),
    addTrigger: (trigger) => invoke<AppConfig>('config_add_trigger', { trigger }),
    updateTrigger: (triggerId, updates) =>
      invoke<AppConfig>('config_update_trigger', { triggerId, updates }),
    removeTrigger: (triggerId) => invoke<AppConfig>('config_remove_trigger', { triggerId }),
    getTriggers: () => invoke<NotificationTrigger[]>('config_get_triggers'),
    testTrigger: (trigger: NotificationTrigger): Promise<TriggerTestResult> =>
      invoke<TriggerTestResult>('notifications_test_trigger', { trigger }),
    pinSession: (projectId, sessionId) => invoke('config_pin_session', { projectId, sessionId }),
    unpinSession: (projectId, sessionId) =>
      invoke('config_unpin_session', { projectId, sessionId }),
    hideSession: (projectId, sessionId) => invoke('config_hide_session', { projectId, sessionId }),
    unhideSession: (projectId, sessionId) =>
      invoke('config_unhide_session', { projectId, sessionId }),
    hideSessions: (projectId, sessionIds) =>
      invoke('config_hide_sessions', { projectId, sessionIds }),
    unhideSessions: (projectId, sessionIds) =>
      invoke('config_unhide_sessions', { projectId, sessionIds }),
    getClaudeRootInfo: () => invoke<ClaudeRootInfo>('config_get_claude_root_info'),
    openInEditor: () => invoke('config_open_in_editor'),
    addBookmark: (sessionId: string, projectId: string, groupId: string, note?: string) =>
      invoke('config_add_bookmark', { sessionId, projectId, groupId, note: note ?? null }),
    removeBookmark: (bookmarkId: string) =>
      invoke('config_remove_bookmark', { bookmarkId }),
    getBookmarks: () =>
      invoke<{ id: string; sessionId: string; projectId: string; groupId: string; note?: string; createdAt: number }[]>('config_get_bookmarks'),
    setSessionTags: (sessionId: string, tags: string[]) =>
      invoke('config_set_session_tags', { sessionId, tags }),
    getSessionTags: (sessionId: string) =>
      invoke<string[]>('config_get_session_tags', { sessionId }),

    // Native: folder selection dialogs via Tauri plugin
    selectFolders: async (): Promise<string[]> => {
      const result = await open({ directory: true, multiple: true });
      if (!result) return [];
      return Array.isArray(result) ? result : [result];
    },
    selectClaudeRootFolder: async (): Promise<ClaudeRootFolderSelection | null> => {
      const result = await open({ directory: true, multiple: false });
      if (!result) return null;
      const path = Array.isArray(result) ? result[0] : result;
      return {
        path,
        isClaudeDirName: path.endsWith('.claude'),
        hasProjectsDir: false,
      };
    },
    findWslClaudeRoots: async (): Promise<WslClaudeRootCandidate[]> => [],
  };

  // ---------------------------------------------------------------------------
  // Session navigation
  // ---------------------------------------------------------------------------

  session: SessionAPI = {
    scrollToLine: (sessionId: string, lineNumber: number) =>
      invoke('session_scroll_to_line', { sessionId, lineNumber }),
  };

  // ---------------------------------------------------------------------------
  // Zoom — Tauri doesn't have Electron's zoom sync mechanism
  // ---------------------------------------------------------------------------

  getZoomFactor = async (): Promise<number> => 1.0;

  onZoomFactorChanged = (_callback: (zoomFactor: number) => void): (() => void) => {
    return () => {};
  };

  // ---------------------------------------------------------------------------
  // File/todo change events — native Tauri events from Rust watcher
  // ---------------------------------------------------------------------------

  onFileChange = (callback: (event: FileChangeEvent) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    listen<FileChangeEvent>('file-change', (tauriEvent) => {
      callback(tauriEvent.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  };

  onTodoChange = (callback: (event: FileChangeEvent) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    listen<FileChangeEvent>('todo-change', (tauriEvent) => {
      callback(tauriEvent.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  };

  // Session refresh handled by frontend keydown listener
  onSessionRefresh = (_callback: () => void): (() => void) => {
    return () => {};
  };

  // ---------------------------------------------------------------------------
  // Native: Shell operations via Tauri plugins
  // ---------------------------------------------------------------------------

  openPath = async (
    targetPath: string,
    _projectRoot?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await openPath(targetPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  openExternal = async (url: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await openUrl(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // ---------------------------------------------------------------------------
  // Native: Window controls via Tauri window API
  // ---------------------------------------------------------------------------

  windowControls = {
    minimize: async (): Promise<void> => {
      await getCurrentWindow().minimize();
    },
    maximize: async (): Promise<void> => {
      const win = getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    },
    close: async (): Promise<void> => {
      await getCurrentWindow().close();
    },
    isMaximized: async (): Promise<boolean> => {
      return getCurrentWindow().isMaximized();
    },
    relaunch: async (): Promise<void> => {
      await relaunch();
    },
  };

  // ---------------------------------------------------------------------------
  // Updater — stub (Tauri updater has different manifest format)
  // ---------------------------------------------------------------------------

  updater: UpdaterAPI = {
    check: async (): Promise<void> => {},
    download: async (): Promise<void> => {},
    install: async (): Promise<void> => {},
    onStatus: (_callback): (() => void) => {
      return () => {};
    },
  };

  // ---------------------------------------------------------------------------
  // SSH — Rust commands + Tauri events
  // ---------------------------------------------------------------------------

  ssh: SshAPI = {
    connect: (config) => invoke<SshConnectionStatus>('ssh_connect', { config }),
    disconnect: () => invoke<SshConnectionStatus>('ssh_disconnect'),
    getState: () => invoke<SshConnectionStatus>('ssh_get_state'),
    test: (config) => invoke<{ success: boolean; error?: string }>('ssh_test', { config }),
    getConfigHosts: () => invoke<SshConfigHostEntry[]>('ssh_get_config_hosts'),
    resolveHost: (alias) => invoke<SshConfigHostEntry | null>('ssh_resolve_host', { alias }),
    saveLastConnection: (config) => invoke('ssh_save_last_connection', { config }),
    getLastConnection: () => invoke<SshLastConnection | null>('ssh_get_last_connection'),
    onStatus: (callback) => {
      let unlisten: UnlistenFn | null = null;
      listen<SshConnectionStatus>('ssh-status', (event) => {
        callback(null, event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => {
        unlisten?.();
      };
    },
  };

  // ---------------------------------------------------------------------------
  // Context — always local (SSH context handled by Rust SSH state)
  // ---------------------------------------------------------------------------

  context = {
    list: (): Promise<ContextInfo[]> => invoke('context_list'),
    getActive: (): Promise<string> => invoke('context_get_active'),
    switch: (contextId: string): Promise<{ contextId: string }> =>
      invoke('context_switch', { contextId }),
    onChanged: (_callback: (event: unknown, data: ContextInfo) => void): (() => void) => {
      return () => {};
    },
  };

  // ---------------------------------------------------------------------------
  // HTTP Server — no separate server in Tauri mode
  // ---------------------------------------------------------------------------

  httpServer: HttpServerAPI = {
    start: (): Promise<HttpServerStatus> => Promise.resolve({ running: true, port: 0 }),
    stop: (): Promise<HttpServerStatus> => Promise.resolve({ running: true, port: 0 }),
    getStatus: (): Promise<HttpServerStatus> => Promise.resolve({ running: true, port: 0 }),
  };
}
