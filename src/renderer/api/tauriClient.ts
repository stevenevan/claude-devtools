/**
 * Tauri-based implementation of ElectronAPI.
 *
 * Delegates all data operations to an internal HttpAPIClient connected
 * to the sidecar server, while using Tauri plugin APIs for native
 * operations (dialogs, shell, window controls, etc.).
 */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';

import { HttpAPIClient } from './httpClient';

import type {
  ClaudeMdFileInfo,
  ClaudeRootFolderSelection,
  ClaudeRootInfo,
  ConfigAPI,
  ContextInfo,
  ConversationGroup,
  ElectronAPI,
  FileChangeEvent,
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
  SubagentDetail,
  TriggerTestResult,
  UpdaterAPI,
  WaterfallData,
  WslClaudeRootCandidate,
} from '@shared/types';
import type { AgentConfig } from '@shared/types/api';

export class TauriAPIClient implements ElectronAPI {
  private http: HttpAPIClient;

  constructor(sidecarPort: number) {
    this.http = new HttpAPIClient(`http://127.0.0.1:${sidecarPort}`);
  }

  // ---------------------------------------------------------------------------
  // Static factory — resolves sidecar port from Tauri command
  // ---------------------------------------------------------------------------

  static async create(): Promise<TauriAPIClient> {
    // Try window global first (injected by Rust setup)
    if (window.__SIDECAR_PORT__) {
      return new TauriAPIClient(window.__SIDECAR_PORT__);
    }
    // Fall back to invoke
    const port = await invoke<number>('get_sidecar_port');
    return new TauriAPIClient(port);
  }

  // ---------------------------------------------------------------------------
  // Native: App version (from Cargo.toml via Tauri)
  // ---------------------------------------------------------------------------

  getAppVersion = (): Promise<string> => getVersion();

  // ---------------------------------------------------------------------------
  // Data operations — delegate to HTTP sidecar
  // ---------------------------------------------------------------------------

  getProjects = (): Promise<Project[]> => this.http.getProjects();

  getSessions = (projectId: string): Promise<Session[]> => this.http.getSessions(projectId);

  getSessionsPaginated = (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> =>
    this.http.getSessionsPaginated(projectId, cursor, limit, options);

  searchSessions = (
    projectId: string,
    query: string,
    maxResults?: number
  ): Promise<SearchSessionsResult> => this.http.searchSessions(projectId, query, maxResults);

  searchAllProjects = (query: string, maxResults?: number): Promise<SearchSessionsResult> =>
    this.http.searchAllProjects(query, maxResults);

  getSessionDetail = (projectId: string, sessionId: string): Promise<SessionDetail | null> =>
    this.http.getSessionDetail(projectId, sessionId);

  getSessionMetrics = (projectId: string, sessionId: string): Promise<SessionMetrics | null> =>
    this.http.getSessionMetrics(projectId, sessionId);

  getWaterfallData = (projectId: string, sessionId: string): Promise<WaterfallData | null> =>
    this.http.getWaterfallData(projectId, sessionId);

  getSubagentDetail = (
    projectId: string,
    sessionId: string,
    subagentId: string
  ): Promise<SubagentDetail | null> =>
    this.http.getSubagentDetail(projectId, sessionId, subagentId);

  getSessionGroups = (projectId: string, sessionId: string): Promise<ConversationGroup[]> =>
    this.http.getSessionGroups(projectId, sessionId);

  getSessionsByIds = (
    projectId: string,
    sessionIds: string[],
    options?: SessionsByIdsOptions
  ): Promise<Session[]> => this.http.getSessionsByIds(projectId, sessionIds, options);

  getRepositoryGroups = (): Promise<RepositoryGroup[]> => this.http.getRepositoryGroups();

  getWorktreeSessions = (worktreeId: string): Promise<Session[]> =>
    this.http.getWorktreeSessions(worktreeId);

  validatePath = (
    relativePath: string,
    projectPath: string
  ): Promise<{ exists: boolean; isDirectory?: boolean }> =>
    this.http.validatePath(relativePath, projectPath);

  validateMentions = (
    mentions: { type: 'path'; value: string }[],
    projectPath: string
  ): Promise<Record<string, boolean>> => this.http.validateMentions(mentions, projectPath);

  readClaudeMdFiles = (projectRoot: string): Promise<Record<string, ClaudeMdFileInfo>> =>
    this.http.readClaudeMdFiles(projectRoot);

  readDirectoryClaudeMd = (dirPath: string): Promise<ClaudeMdFileInfo> =>
    this.http.readDirectoryClaudeMd(dirPath);

  readMentionedFile = (
    absolutePath: string,
    projectRoot: string,
    maxTokens?: number
  ): Promise<ClaudeMdFileInfo | null> =>
    this.http.readMentionedFile(absolutePath, projectRoot, maxTokens);

  readAgentConfigs = (projectRoot: string): Promise<Record<string, AgentConfig>> =>
    this.http.readAgentConfigs(projectRoot);

  // ---------------------------------------------------------------------------
  // Notifications — delegate to HTTP sidecar (CRUD + SSE events)
  // ---------------------------------------------------------------------------

  notifications: NotificationsAPI = this.http.notifications;

  // ---------------------------------------------------------------------------
  // Config — mostly HTTP sidecar, with native dialog overrides
  // ---------------------------------------------------------------------------

  config: ConfigAPI = {
    // Data operations via sidecar
    get: () => this.http.config.get(),
    update: (section, data) => this.http.config.update(section, data),
    addIgnoreRegex: (pattern) => this.http.config.addIgnoreRegex(pattern),
    removeIgnoreRegex: (pattern) => this.http.config.removeIgnoreRegex(pattern),
    addIgnoreRepository: (repositoryId) => this.http.config.addIgnoreRepository(repositoryId),
    removeIgnoreRepository: (repositoryId) =>
      this.http.config.removeIgnoreRepository(repositoryId),
    snooze: (minutes) => this.http.config.snooze(minutes),
    clearSnooze: () => this.http.config.clearSnooze(),
    addTrigger: (trigger) => this.http.config.addTrigger(trigger),
    updateTrigger: (triggerId, updates) => this.http.config.updateTrigger(triggerId, updates),
    removeTrigger: (triggerId) => this.http.config.removeTrigger(triggerId),
    getTriggers: () => this.http.config.getTriggers(),
    testTrigger: (trigger: NotificationTrigger): Promise<TriggerTestResult> =>
      this.http.config.testTrigger(trigger),
    pinSession: (projectId, sessionId) => this.http.config.pinSession(projectId, sessionId),
    unpinSession: (projectId, sessionId) => this.http.config.unpinSession(projectId, sessionId),
    hideSession: (projectId, sessionId) => this.http.config.hideSession(projectId, sessionId),
    unhideSession: (projectId, sessionId) => this.http.config.unhideSession(projectId, sessionId),
    hideSessions: (projectId, sessionIds) => this.http.config.hideSessions(projectId, sessionIds),
    unhideSessions: (projectId, sessionIds) =>
      this.http.config.unhideSessions(projectId, sessionIds),
    getClaudeRootInfo: () => this.http.config.getClaudeRootInfo(),
    openInEditor: () => this.http.config.openInEditor(),

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
        hasProjectsDir: false, // Will be validated by the config handler
      };
    },
    findWslClaudeRoots: async (): Promise<WslClaudeRootCandidate[]> => [],
  };

  // ---------------------------------------------------------------------------
  // Session navigation — sidecar
  // ---------------------------------------------------------------------------

  session: SessionAPI = this.http.session;

  // ---------------------------------------------------------------------------
  // Zoom — Tauri doesn't have Electron's zoom sync mechanism
  // ---------------------------------------------------------------------------

  getZoomFactor = async (): Promise<number> => 1.0;

  onZoomFactorChanged = (_callback: (zoomFactor: number) => void): (() => void) => {
    return () => {};
  };

  // ---------------------------------------------------------------------------
  // File/todo change events — SSE from sidecar
  // ---------------------------------------------------------------------------

  onFileChange = (callback: (event: FileChangeEvent) => void): (() => void) =>
    this.http.onFileChange(callback);

  onTodoChange = (callback: (event: FileChangeEvent) => void): (() => void) =>
    this.http.onTodoChange(callback);

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
  // Updater — stub for now (Tauri updater has different manifest format)
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
  // SSH — delegate to HTTP sidecar
  // ---------------------------------------------------------------------------

  ssh: SshAPI = this.http.ssh;

  // ---------------------------------------------------------------------------
  // Context — delegate to HTTP sidecar
  // ---------------------------------------------------------------------------

  context = {
    list: (): Promise<ContextInfo[]> => this.http.context.list(),
    getActive: (): Promise<string> => this.http.context.getActive(),
    switch: (contextId: string): Promise<{ contextId: string }> =>
      this.http.context.switch(contextId),
    onChanged: (callback: (event: unknown, data: ContextInfo) => void): (() => void) =>
      this.http.context.onChanged(callback),
  };

  // ---------------------------------------------------------------------------
  // HTTP Server — sidecar IS the HTTP server
  // ---------------------------------------------------------------------------

  httpServer: HttpServerAPI = {
    start: (): Promise<HttpServerStatus> =>
      Promise.resolve({ running: true, port: window.__SIDECAR_PORT__ }),
    stop: (): Promise<HttpServerStatus> => {
      console.warn('[TauriAPIClient] Cannot stop sidecar HTTP server');
      return Promise.resolve({ running: true, port: window.__SIDECAR_PORT__ });
    },
    getStatus: (): Promise<HttpServerStatus> =>
      Promise.resolve({ running: true, port: window.__SIDECAR_PORT__ }),
  };
}
