// Config API

import type {
  AppConfig,
  FilterPresetEntry,
  FilterPresetPayload,
  NotificationTrigger,
  TriggerTestResult,
} from '../notifications';

/**
 * Config API exposed via preload.
 */
export interface ConfigAPI {
  get: () => Promise<AppConfig>;
  update: (section: string, data: object) => Promise<AppConfig>;
  addIgnoreRegex: (pattern: string) => Promise<AppConfig>;
  removeIgnoreRegex: (pattern: string) => Promise<AppConfig>;
  addIgnoreRepository: (repositoryId: string) => Promise<AppConfig>;
  removeIgnoreRepository: (repositoryId: string) => Promise<AppConfig>;
  snooze: (minutes: number) => Promise<AppConfig>;
  clearSnooze: () => Promise<AppConfig>;
  // Trigger management methods
  addTrigger: (trigger: Omit<NotificationTrigger, 'isBuiltin'>) => Promise<AppConfig>;
  updateTrigger: (triggerId: string, updates: Partial<NotificationTrigger>) => Promise<AppConfig>;
  removeTrigger: (triggerId: string) => Promise<AppConfig>;
  getTriggers: () => Promise<NotificationTrigger[]>;
  testTrigger: (trigger: NotificationTrigger) => Promise<TriggerTestResult>;
  /** Opens native folder selection dialog and returns selected paths */
  selectFolders: () => Promise<string[]>;
  /** Open native dialog to select local Claude root folder */
  selectClaudeRootFolder: () => Promise<ClaudeRootFolderSelection | null>;
  /** Get resolved Claude root path info for local mode */
  getClaudeRootInfo: () => Promise<ClaudeRootInfo>;
  /** Find Windows WSL Claude root candidates (UNC paths) */
  findWslClaudeRoots: () => Promise<WslClaudeRootCandidate[]>;
  /** Opens the config JSON file in an external editor */
  openInEditor: () => Promise<void>;
  /** Pin a session for a project */
  pinSession: (projectId: string, sessionId: string) => Promise<void>;
  /** Unpin a session for a project */
  unpinSession: (projectId: string, sessionId: string) => Promise<void>;
  /** Hide a session for a project */
  hideSession: (projectId: string, sessionId: string) => Promise<void>;
  /** Unhide a session for a project */
  unhideSession: (projectId: string, sessionId: string) => Promise<void>;
  /** Bulk hide sessions for a project */
  hideSessions: (projectId: string, sessionIds: string[]) => Promise<void>;
  /** Bulk unhide sessions for a project */
  unhideSessions: (projectId: string, sessionIds: string[]) => Promise<void>;
  /** Add a bookmark on an AI group */
  addBookmark: (
    sessionId: string,
    projectId: string,
    groupId: string,
    note?: string
  ) => Promise<void>;
  /** Remove a bookmark by ID */
  removeBookmark: (bookmarkId: string) => Promise<void>;
  /** Get all bookmarks */
  getBookmarks: () => Promise<
    {
      id: string;
      sessionId: string;
      projectId: string;
      groupId: string;
      note?: string;
      createdAt: number;
    }[]
  >;
  /** Set tags for a session */
  setSessionTags: (sessionId: string, tags: string[]) => Promise<void>;
  /** Get tags for a session */
  getSessionTags: (sessionId: string) => Promise<string[]>;
  /** Add an inline annotation anchored to a display target within a session */
  addAnnotation: (input: {
    sessionId: string;
    projectId: string;
    targetId: string;
    text: string;
    color: string;
  }) => Promise<AnnotationEntry>;
  /** Update an annotation's text or color */
  updateAnnotation: (
    annotationId: string,
    patch: { text?: string; color?: string }
  ) => Promise<boolean>;
  /** Remove an annotation by ID */
  removeAnnotation: (annotationId: string) => Promise<void>;
  /** Get all annotations */
  getAnnotations: () => Promise<AnnotationEntry[]>;
  /** Create a named manual session group */
  createGroup: (name: string) => Promise<boolean>;
  /** Delete a manual session group by name */
  deleteGroup: (name: string) => Promise<void>;
  /** Add a session to a manual group */
  addToGroup: (name: string, sessionId: string) => Promise<void>;
  /** Remove a session from a manual group */
  removeFromGroup: (name: string, sessionId: string) => Promise<void>;
  /** Get all manual groups as { groupName: sessionIds[] } */
  getGroups: () => Promise<Record<string, string[]>>;
  /** Save a new filter preset (sprint 35); returns the persisted entry */
  addFilterPreset: (name: string, filter: FilterPresetPayload) => Promise<FilterPresetEntry>;
  /** Remove a filter preset by id */
  removeFilterPreset: (presetId: string) => Promise<void>;
  /** Rename a filter preset; returns whether a preset with that id was found */
  renameFilterPreset: (presetId: string, name: string) => Promise<boolean>;
  /** Set or clear the default filter preset (auto-applied on first sidebar mount) */
  setDefaultFilterPreset: (presetId: string | null) => Promise<void>;
  /** Export annotations + bookmarks for the given session ids as JSON.
   * Empty array exports everything (sprint 37). */
  exportAnnotations: (sessionIds: string[]) => Promise<string>;
  /** Import annotations + bookmarks from a previously exported JSON bundle.
   * Conflicts: annotations matched by (sessionId, targetId) — newer
   * `updatedAt` wins; bookmarks matched by (sessionId, groupId) skip duplicates. */
  importAnnotations: (json: string) => Promise<AnnotationImportReport>;
}

/** Counts returned by `importAnnotations` (sprint 37). */
export interface AnnotationImportReport {
  annotationsAdded: number;
  annotationsUpdated: number;
  annotationsSkipped: number;
  bookmarksAdded: number;
  bookmarksSkipped: number;
}

export interface AnnotationEntry {
  id: string;
  sessionId: string;
  projectId: string;
  targetId: string;
  text: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClaudeRootInfo {
  /** Auto-detected default Claude root path for this machine */
  defaultPath: string;
  /** Effective path currently used by local context */
  resolvedPath: string;
  /** Custom override path from settings (null means auto-detect) */
  customPath: string | null;
}

export interface ClaudeRootFolderSelection {
  /** Selected directory absolute path */
  path: string;
  /** Whether the selected folder name is exactly ".claude" */
  isClaudeDirName: boolean;
  /** Whether selected folder contains a "projects" directory */
  hasProjectsDir: boolean;
}

export interface WslClaudeRootCandidate {
  /** WSL distribution name (e.g. Ubuntu) */
  distro: string;
  /** Candidate Claude root path in UNC format */
  path: string;
  /** True if this root contains "projects" directory */
  hasProjectsDir: boolean;
}
