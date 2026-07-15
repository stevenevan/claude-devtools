

import type { ConversationGroup, FileChangeEvent, SessionDetail, SubagentDetail } from '../chunks';
import type {
  AggregatedSessionTodos,
  AnalyticsResponse,
  ContentSearchResult,
  CostForecast,
  ErrorClustersResponse,
  ErrorHotspotsResponse,
  FileGraphResponse,
  FilteredSearchResponse,
  ModelComparisonResponse,
  PaginatedSessionsResult,
  ProductivityMetrics,
  Project,
  RepositoryGroup,
  SearchFilters,
  SearchSessionsResult,
  Session,
  SessionDurationResponse,
  SessionMetrics,
  SessionsByIdsOptions,
  SessionsPaginationOptions,
  ToolAnalyticsResponse,
  ToolTimeHeatmapResponse,
} from '../domain';
import type { WaterfallData } from '../visualization';
import type { AgentConfig, GlobalAgent, GlobalPlugin, GlobalSkill } from './agents';
import type { BackendCacheStats, BackendTimingSummary } from './backend';
import type { ClaudeJSONBackup, ClaudeJSONCensus, PurgeResult } from './claudeJson';
import type { ConfigAPI } from './config';
import type { ContextInfo } from './context';
import type { MaintenanceAPI } from './maintenance';
import type { MCPStatusView } from './mcp';
import type { PermissionRulesView, PermissionScope } from './permissions';
import type { NotificationsAPI } from './notificationsApi';
import type { PluginsAPI } from './plugins';
import type { ParsedNLQuery } from './search';
import type { ClaudeMdFileInfo, SessionAPI } from './session';
import type { SnapshotsAPI } from './snapshots';
import type { SshAPI } from './ssh';
import type { HttpServerAPI, UpdaterAPI } from './system';
import type { WebhookAPI } from './webhook';

export type * from './agents';
export type * from './backend';
export type * from './claudeJson';
export type * from './config';
export type * from './context';
export type * from './maintenance';
export type * from './mcp';
export type * from './permissions';
export type * from './notificationsApi';
export type * from './plugins';
export type * from './search';
export type * from './session';
export type * from './snapshots';
export type * from './ssh';
export type * from './system';
export type * from './webhook';

export interface GlobalSettingsPatch {
  env: Record<string, string>;
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface HookEntry {
  event: string;
  matcher: string;
  commands: string[];
  fingerprint: string;
  index: number;
}

export interface HookView {
  enabled: HookEntry[];
  disabled: HookEntry[];
}

export interface DuplicateGroup {
  name: string;
  entries: GlobalPlugin[];
}

// Source is one settings.json/settings.local.json location on disk. `raw` is
// the file's exact text, unmasked — masking happens client-side at render.
export interface Source {
  path: string;
  kind: string;
  exists: boolean;
  isAnomaly: boolean;
  raw: string;
}

// SourcesView is the full settings-source enumeration for a project: every
// source plus a merged, provenance-tracked effective view.
export interface SourcesView {
  sources: Source[];
  merged: Record<string, unknown>;
  provenance: Record<string, string>;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getProjects: () => Promise<Project[]>;
  getSessions: (projectId: string) => Promise<Session[]>;
  getSessionsPaginated: (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ) => Promise<PaginatedSessionsResult>;
  searchSessions: (
    projectId: string,
    query: string,
    maxResults?: number
  ) => Promise<SearchSessionsResult>;
  searchAllProjects: (query: string, maxResults?: number) => Promise<SearchSessionsResult>;

  searchSessionsFiltered: (
    filters: SearchFilters,
    maxResults?: number
  ) => Promise<FilteredSearchResponse>;

  searchSessionContent: (
    projectId: string,
    sessionId: string,
    query: string,
    isRegex?: boolean,
    caseSensitive?: boolean,
    cursor?: number,
    pageSize?: number
  ) => Promise<ContentSearchResult>;
  getSessionDetail: (projectId: string, sessionId: string) => Promise<SessionDetail | null>;

  getSessionDetailIncremental: (
    projectId: string,
    sessionId: string
  ) => Promise<SessionDetail | null>;
  getSessionMetrics: (projectId: string, sessionId: string) => Promise<SessionMetrics | null>;
  getAnalytics: (days: number) => Promise<AnalyticsResponse>;
  getCostForecast: (windowDays: number) => Promise<CostForecast>;
  getProductivityMetrics: (days: number) => Promise<ProductivityMetrics>;
  getSessionDurationStats: (days: number) => Promise<SessionDurationResponse>;
  getModelComparison: (days: number) => Promise<ModelComparisonResponse>;
  getFileGraph: (projectId: string, sessionId: string) => Promise<FileGraphResponse>;
  getToolAnalytics: (projectId: string, days: number) => Promise<ToolAnalyticsResponse>;
  getToolTimeHeatmap: (
    projectId: string,
    days: number,
    toolFilter?: string | null
  ) => Promise<ToolTimeHeatmapResponse>;
  getErrorHotspots: (
    projectId: string,
    days: number,
    minOccurrences: number
  ) => Promise<ErrorHotspotsResponse>;
  getErrorClusters: (
    projectId: string,
    days: number,
    minClusterSize: number
  ) => Promise<ErrorClustersResponse>;
  getAllTodos: (projectIds: string[]) => Promise<AggregatedSessionTodos[]>;
  getWaterfallData: (projectId: string, sessionId: string) => Promise<WaterfallData | null>;
  getSubagentDetail: (
    projectId: string,
    sessionId: string,
    subagentId: string
  ) => Promise<SubagentDetail | null>;
  getSessionGroups: (projectId: string, sessionId: string) => Promise<ConversationGroup[]>;
  getSessionsByIds: (
    projectId: string,
    sessionIds: string[],
    options?: SessionsByIdsOptions
  ) => Promise<Session[]>;

  // Repository grouping (worktree support)
  getRepositoryGroups: () => Promise<RepositoryGroup[]>;
  getWorktreeSessions: (worktreeId: string) => Promise<Session[]>;

  // Validation methods
  validatePath: (
    relativePath: string,
    projectPath: string
  ) => Promise<{ exists: boolean; isDirectory?: boolean }>;
  validateMentions: (
    mentions: { type: 'path'; value: string }[],
    projectPath: string
  ) => Promise<Record<string, boolean>>;

  // CLAUDE.md reading methods
  readClaudeMdFiles: (projectRoot: string) => Promise<Record<string, ClaudeMdFileInfo>>;
  readDirectoryClaudeMd: (dirPath: string) => Promise<ClaudeMdFileInfo>;
  readMentionedFile: (
    absolutePath: string,
    projectRoot: string,
    maxTokens?: number
  ) => Promise<ClaudeMdFileInfo | null>;

  // Agent config reading
  readAgentConfigs: (projectRoot: string) => Promise<Record<string, AgentConfig>>;

  // Global ~/.claude/ config reading
  readGlobalAgents: () => Promise<GlobalAgent[]>;
  readGlobalSkills: () => Promise<GlobalSkill[]>;
  readGlobalPlugins: () => Promise<GlobalPlugin[]>;
  readGlobalSettings: () => Promise<Record<string, unknown>>;
  updateGlobalSettings: (patch: GlobalSettingsPatch) => Promise<void>;
  readHooks: () => Promise<HookView>;
  toggleHook: (
    event: string,
    matcherIndex: number,
    fingerprint: string,
    enable: boolean
  ) => Promise<void>;
  setPluginEnabled: (key: string, enable: boolean) => Promise<void>;
  dedupePlugin: (name: string, keepKey: string) => Promise<void>;
  detectPluginDuplicates: () => Promise<DuplicateGroup[]>;
  enumerateSettingsSources: (projectRoot: string) => Promise<SourcesView>;

  // ~/.claude.json inspector (Week 20, read-only). Census carries kinds/sizes
  // only; per-value display and backups are server-side masked.
  readClaudeJSON: () => Promise<ClaudeJSONCensus>;
  revealClaudeJSONValue: (keyPath: string) => Promise<string>;
  readClaudeJSONMasked: () => Promise<string>;
  listClaudeJSONBackups: () => Promise<ClaudeJSONBackup[]>;
  readClaudeJSONBackup: (name: string) => Promise<string>;

  // ~/.claude.json guarded purge-write (Week 21). Removes provably-stale
  // project entries under the program's tightest guardrails; app-side backups
  // are enumerable and restorable (full-file, auth included).
  purgeClaudeJSONProjects: (keys: string[]) => Promise<PurgeResult>;
  listClaudeJSONAppBackups: () => Promise<ClaudeJSONBackup[]>;
  restoreClaudeJSONAppBackup: (name: string) => Promise<void>;

  // MCP status dashboard (Week 22, read-only). Aggregates ~/.claude.json
  // (top-level + per-project mcpServers), .mcp.json, and the auth-needed
  // connector cache; every commandOrUrl is server-side masked.
  getMCPStatus: () => Promise<MCPStatusView>;

  // Permissions consolidation editor (Week 19). Merges permission rules
  // across global + project + project-local settings; only global and
  // project-local rows are writable.
  getPermissionRules: (projectRoot: string) => Promise<PermissionRulesView>;
  addPermissionRule: (scope: PermissionScope, list: string, rule: string) => Promise<void>;
  removePermissionRule: (scope: PermissionScope, list: string, rule: string) => Promise<void>;
  movePermissionRule: (
    from: PermissionScope,
    to: PermissionScope,
    fromList: string,
    toList: string,
    rule: string
  ) => Promise<void>;

  // Notifications API
  notifications: NotificationsAPI;

  // Config API
  config: ConfigAPI;

  // Deep link navigation
  session: SessionAPI;

  // Session snapshots (sprint 36)
  snapshots: SnapshotsAPI;

  // Storage maintenance (Week 1 read-only scan)
  maintenance: MaintenanceAPI;

  // Plugins (sprint 38)
  plugins: PluginsAPI;

  // Webhooks (sprint 41)
  webhook: WebhookAPI;

  // Natural language query (sprint 43; lexical only)
  parseNLQuery: (query: string) => Promise<ParsedNLQuery>;

  // Backend observability (sprint 46)
  getBackendTimings: (limit?: number) => Promise<BackendTimingSummary[]>;
  getCacheStats: () => Promise<BackendCacheStats>;
  setCacheCapacity: (capacity: number) => Promise<void>;
  clearSessionCache: () => Promise<void>;

  // Window zoom sync (for traffic-light-safe layout)
  getZoomFactor: () => Promise<number>;
  onZoomFactorChanged: (callback: (zoomFactor: number) => void) => () => void;

  // File change events (real-time updates)
  onFileChange: (callback: (event: FileChangeEvent) => void) => () => void;
  onTodoChange: (callback: (event: FileChangeEvent) => void) => () => void;

  // Session refresh (Ctrl+R / Cmd+R intercepted by main process)
  onSessionRefresh: (callback: () => void) => () => void;

  // Shell operations
  openPath: (
    targetPath: string,
    projectRoot?: string
  ) => Promise<{ success: boolean; error?: string }>;
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

  // Window controls (when title bar is hidden, e.g. Windows / Linux)
  windowControls: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    relaunch: () => Promise<void>;
  };

  // Updater API
  updater: UpdaterAPI;

  // SSH API
  ssh: SshAPI;

  // Context API
  context: {
    list: () => Promise<ContextInfo[]>;
    getActive: () => Promise<string>;
    switch: (contextId: string) => Promise<{ contextId: string }>;
    onChanged: (callback: (event: unknown, data: ContextInfo) => void) => () => void;
  };

  // HTTP Server API
  httpServer: HttpServerAPI;
}
