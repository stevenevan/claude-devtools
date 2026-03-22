/**
 * Tauri-based implementation of ElectronAPI.
 *
 * Delegates all data operations to an internal HttpAPIClient connected
 * to the sidecar server, while using Tauri plugin APIs for native
 * operations (dialogs, shell, window controls, etc.).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';

import { HttpAPIClient } from './httpClient';

import type {
  AppConfig,
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

  static async create(): Promise<TauriAPIClient | null> {
    // Try window global first (injected by Rust setup)
    if (window.__SIDECAR_PORT__) {
      return new TauriAPIClient(window.__SIDECAR_PORT__);
    }
    // Poll invoke until the sidecar reports its port.
    // The webview JS may run before the Rust setup() finishes starting the sidecar.
    const MAX_ATTEMPTS = 50;
    const POLL_INTERVAL_MS = 100;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const port = await invoke<number>('get_sidecar_port');
        return new TauriAPIClient(port);
      } catch {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }
    console.error('[TauriAPIClient] Sidecar did not start within 5 seconds');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Native: App version (from Cargo.toml via Tauri)
  // ---------------------------------------------------------------------------

  getAppVersion = (): Promise<string> => getVersion();

  // ---------------------------------------------------------------------------
  // Data operations — delegate to HTTP sidecar
  // ---------------------------------------------------------------------------

  getProjects = async (): Promise<Project[]> => {
    try {
      return await invoke<Project[]>('get_projects');
    } catch {
      return this.http.getProjects();
    }
  };

  getSessions = (projectId: string): Promise<Session[]> => this.http.getSessions(projectId);

  getSessionsPaginated = async (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> => {
    try {
      return await invoke<PaginatedSessionsResult>('get_sessions_paginated', {
        projectId,
        cursor,
        limit,
        options,
      });
    } catch {
      return this.http.getSessionsPaginated(projectId, cursor, limit, options);
    }
  };

  searchSessions = (
    projectId: string,
    query: string,
    maxResults?: number
  ): Promise<SearchSessionsResult> => this.http.searchSessions(projectId, query, maxResults);

  searchAllProjects = (query: string, maxResults?: number): Promise<SearchSessionsResult> =>
    this.http.searchAllProjects(query, maxResults);

  getSessionDetail = (projectId: string, sessionId: string): Promise<SessionDetail | null> =>
    this.http.getSessionDetail(projectId, sessionId);

  getSessionMetrics = async (
    projectId: string,
    sessionId: string
  ): Promise<SessionMetrics | null> => {
    try {
      return await invoke<SessionMetrics>('parse_session_metrics', {
        projectId,
        sessionId,
      });
    } catch {
      // Fallback to sidecar HTTP
      return this.http.getSessionMetrics(projectId, sessionId);
    }
  };

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

  get notifications(): NotificationsAPI {
    return this.http.notifications;
  }

  // ---------------------------------------------------------------------------
  // Config — mostly HTTP sidecar, with native dialog overrides
  // ---------------------------------------------------------------------------

  config: ConfigAPI = {
    // Data operations via Rust commands with HTTP fallback
    get: async () => {
      try {
        return await invoke<AppConfig>('config_get');
      } catch {
        return this.http.config.get();
      }
    },
    update: async (section, data) => {
      try {
        return await invoke<AppConfig>('config_update', { section, data });
      } catch {
        return this.http.config.update(section, data);
      }
    },
    addIgnoreRegex: async (pattern) => {
      try {
        return await invoke<AppConfig>('config_add_ignore_regex', { pattern });
      } catch {
        return this.http.config.addIgnoreRegex(pattern);
      }
    },
    removeIgnoreRegex: async (pattern) => {
      try {
        return await invoke<AppConfig>('config_remove_ignore_regex', { pattern });
      } catch {
        return this.http.config.removeIgnoreRegex(pattern);
      }
    },
    addIgnoreRepository: async (repositoryId) => {
      try {
        return await invoke<AppConfig>('config_add_ignore_repository', { repositoryId });
      } catch {
        return this.http.config.addIgnoreRepository(repositoryId);
      }
    },
    removeIgnoreRepository: async (repositoryId) => {
      try {
        return await invoke<AppConfig>('config_remove_ignore_repository', { repositoryId });
      } catch {
        return this.http.config.removeIgnoreRepository(repositoryId);
      }
    },
    snooze: async (minutes) => {
      try {
        return await invoke<AppConfig>('config_snooze', { minutes });
      } catch {
        return this.http.config.snooze(minutes);
      }
    },
    clearSnooze: async () => {
      try {
        return await invoke<AppConfig>('config_clear_snooze');
      } catch {
        return this.http.config.clearSnooze();
      }
    },
    addTrigger: async (trigger) => {
      try {
        return await invoke<AppConfig>('config_add_trigger', { trigger });
      } catch {
        return this.http.config.addTrigger(trigger);
      }
    },
    updateTrigger: async (triggerId, updates) => {
      try {
        return await invoke<AppConfig>('config_update_trigger', { triggerId, updates });
      } catch {
        return this.http.config.updateTrigger(triggerId, updates);
      }
    },
    removeTrigger: async (triggerId) => {
      try {
        return await invoke<AppConfig>('config_remove_trigger', { triggerId });
      } catch {
        return this.http.config.removeTrigger(triggerId);
      }
    },
    getTriggers: async () => {
      try {
        return await invoke<NotificationTrigger[]>('config_get_triggers');
      } catch {
        return this.http.config.getTriggers();
      }
    },
    // testTrigger stays on HTTP — depends on ErrorDetector (Sprint 6)
    testTrigger: (trigger: NotificationTrigger): Promise<TriggerTestResult> =>
      this.http.config.testTrigger(trigger),
    pinSession: async (projectId, sessionId) => {
      try {
        await invoke('config_pin_session', { projectId, sessionId });
      } catch {
        await this.http.config.pinSession(projectId, sessionId);
      }
    },
    unpinSession: async (projectId, sessionId) => {
      try {
        await invoke('config_unpin_session', { projectId, sessionId });
      } catch {
        await this.http.config.unpinSession(projectId, sessionId);
      }
    },
    hideSession: async (projectId, sessionId) => {
      try {
        await invoke('config_hide_session', { projectId, sessionId });
      } catch {
        await this.http.config.hideSession(projectId, sessionId);
      }
    },
    unhideSession: async (projectId, sessionId) => {
      try {
        await invoke('config_unhide_session', { projectId, sessionId });
      } catch {
        await this.http.config.unhideSession(projectId, sessionId);
      }
    },
    hideSessions: async (projectId, sessionIds) => {
      try {
        await invoke('config_hide_sessions', { projectId, sessionIds });
      } catch {
        await this.http.config.hideSessions(projectId, sessionIds);
      }
    },
    unhideSessions: async (projectId, sessionIds) => {
      try {
        await invoke('config_unhide_sessions', { projectId, sessionIds });
      } catch {
        await this.http.config.unhideSessions(projectId, sessionIds);
      }
    },
    getClaudeRootInfo: async () => {
      try {
        return await invoke<ClaudeRootInfo>('config_get_claude_root_info');
      } catch {
        return this.http.config.getClaudeRootInfo();
      }
    },
    openInEditor: async () => {
      try {
        await invoke('config_open_in_editor');
      } catch {
        await this.http.config.openInEditor();
      }
    },

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

  get session(): SessionAPI {
    return this.http.session;
  }

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

  get ssh(): SshAPI {
    return this.http.ssh;
  }

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
