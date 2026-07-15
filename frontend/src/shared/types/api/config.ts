// Config API

import type {
  AppConfig,
  FilterPresetEntry,
  FilterPresetPayload,
  NotificationTrigger,
  TriggerTestResult,
} from '../notifications';

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

  selectFolders: () => Promise<string[]>;

  selectClaudeRootFolder: () => Promise<ClaudeRootFolderSelection | null>;

  getClaudeRootInfo: () => Promise<ClaudeRootInfo>;

  findWslClaudeRoots: () => Promise<WslClaudeRootCandidate[]>;

  openInEditor: () => Promise<void>;

  pinSession: (projectId: string, sessionId: string) => Promise<void>;

  unpinSession: (projectId: string, sessionId: string) => Promise<void>;

  hideSession: (projectId: string, sessionId: string) => Promise<void>;

  unhideSession: (projectId: string, sessionId: string) => Promise<void>;

  hideSessions: (projectId: string, sessionIds: string[]) => Promise<void>;

  unhideSessions: (projectId: string, sessionIds: string[]) => Promise<void>;

  addBookmark: (
    sessionId: string,
    projectId: string,
    groupId: string,
    note?: string
  ) => Promise<void>;

  removeBookmark: (bookmarkId: string) => Promise<void>;

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

  setSessionTags: (sessionId: string, tags: string[]) => Promise<void>;

  getSessionTags: (sessionId: string) => Promise<string[]>;

  addAnnotation: (input: {
    sessionId: string;
    projectId: string;
    targetId: string;
    text: string;
    color: string;
  }) => Promise<AnnotationEntry>;

  updateAnnotation: (
    annotationId: string,
    patch: { text?: string; color?: string }
  ) => Promise<boolean>;

  removeAnnotation: (annotationId: string) => Promise<void>;

  getAnnotations: () => Promise<AnnotationEntry[]>;

  createGroup: (name: string) => Promise<boolean>;

  deleteGroup: (name: string) => Promise<void>;

  addToGroup: (name: string, sessionId: string) => Promise<void>;

  removeFromGroup: (name: string, sessionId: string) => Promise<void>;

  getGroups: () => Promise<Record<string, string[]>>;

  addFilterPreset: (name: string, filter: FilterPresetPayload) => Promise<FilterPresetEntry>;

  removeFilterPreset: (presetId: string) => Promise<void>;

  renameFilterPreset: (presetId: string, name: string) => Promise<boolean>;

  setDefaultFilterPreset: (presetId: string | null) => Promise<void>;

  exportAnnotations: (sessionIds: string[]) => Promise<string>;

  importAnnotations: (json: string) => Promise<AnnotationImportReport>;

  // Permission-suggestion dismissals (Week 30). Persisted across restarts.
  getDismissedSuggestions: () => Promise<string[]>;

  dismissSuggestion: (rule: string) => Promise<void>;
}

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

  defaultPath: string;

  effectivePath: string;

  resolvedPath: string;

  customPath: string | null;
}

export interface ClaudeRootFolderSelection {

  path: string;

  isClaudeDirName: boolean;

  hasProjectsDir: boolean;
}

export interface WslClaudeRootCandidate {

  distro: string;

  path: string;

  hasProjectsDir: boolean;
}
