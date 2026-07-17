import type {
  AnnotationEntry,
  AppConfig,
  ClaudeRootInfo,
  ConfigAPI,
  FilterPresetEntry,
  NotificationTrigger,
} from '@shared/types';
import type { AnnotationImportReport } from '@shared/types/api';

import { bridgeEvent } from '../eventBridge';
import { call } from '../invoke';

// Notification event wirings owned by the Wails "config" adapter, ported to
// Tauri `listen`. Two-arg WailsAPI callbacks `(event, data)` are fed `null` as
// the leading event arg, matching the current Wails adapter.
export const notificationEvents = {
  onNew: (callback: (event: unknown, error: unknown) => void): (() => void) =>
    bridgeEvent<unknown>('notification:new', (data) => callback(null, data)),
  onUpdated: (
    callback: (event: unknown, payload: { total: number; unreadCount: number }) => void
  ): (() => void) =>
    bridgeEvent<{ total: number; unreadCount: number }>('notification:updated', (data) =>
      callback(null, data)
    ),
  onClicked: (callback: (event: unknown, data: unknown) => void): (() => void) =>
    bridgeEvent<unknown>('notification:clicked', (data) => callback(null, data)),
};

// ConfigService-backed methods of the WailsAPI.config slice (W12). Mirrors the
// Wails configApiImpl (domain/config.ts) method-for-method, routed through the
// Tauri invoke bridge. The remaining ConfigAPI methods are backed by OTHER
// services/host APIs not ported here — testTrigger (NotifyService, W14),
// selectFolders / selectClaudeRootFolder / findWslClaudeRoots (native dialogs /
// WSL) — so they are omitted and fall through to makeSlice's notPorted stub.
// No reviveDates: the Wails config adapter revives none of these.
type ConfigCommands = Pick<
  ConfigAPI,
  | 'get'
  | 'update'
  | 'addIgnoreRegex'
  | 'removeIgnoreRegex'
  | 'addIgnoreRepository'
  | 'removeIgnoreRepository'
  | 'snooze'
  | 'clearSnooze'
  | 'addTrigger'
  | 'updateTrigger'
  | 'removeTrigger'
  | 'getTriggers'
  | 'pinSession'
  | 'unpinSession'
  | 'hideSession'
  | 'unhideSession'
  | 'hideSessions'
  | 'unhideSessions'
  | 'getClaudeRootInfo'
  | 'openInEditor'
  | 'addBookmark'
  | 'removeBookmark'
  | 'getBookmarks'
  | 'addAnnotation'
  | 'updateAnnotation'
  | 'removeAnnotation'
  | 'getAnnotations'
  | 'setSessionTags'
  | 'getSessionTags'
  | 'createGroup'
  | 'deleteGroup'
  | 'addToGroup'
  | 'removeFromGroup'
  | 'getGroups'
  | 'addFilterPreset'
  | 'removeFilterPreset'
  | 'renameFilterPreset'
  | 'setDefaultFilterPreset'
  | 'exportAnnotations'
  | 'importAnnotations'
  | 'getDismissedSuggestions'
  | 'dismissSuggestion'
>;

export const configApi: ConfigCommands = {
  get: () => call<AppConfig>('config_get'),
  update: (section, data) => call<AppConfig>('config_update', { section, data }),
  addIgnoreRegex: (pattern) => call<AppConfig>('config_add_ignore_regex', { pattern }),
  removeIgnoreRegex: (pattern) => call<AppConfig>('config_remove_ignore_regex', { pattern }),
  addIgnoreRepository: (repositoryId) =>
    call<AppConfig>('config_add_ignore_repository', { repositoryId }),
  removeIgnoreRepository: (repositoryId) =>
    call<AppConfig>('config_remove_ignore_repository', { repositoryId }),
  snooze: (minutes) => call<AppConfig>('config_snooze', { minutes: minutes ?? null }),
  clearSnooze: () => call<AppConfig>('config_clear_snooze'),
  addTrigger: (trigger) => call<AppConfig>('config_add_trigger', { trigger }),
  updateTrigger: (triggerId, updates) =>
    call<AppConfig>('config_update_trigger', { triggerId, updates }),
  removeTrigger: (triggerId) => call<AppConfig>('config_remove_trigger', { triggerId }),
  getTriggers: () => call<NotificationTrigger[]>('config_get_triggers'),
  pinSession: (projectId, sessionId) => call<void>('config_pin_session', { projectId, sessionId }),
  unpinSession: (projectId, sessionId) =>
    call<void>('config_unpin_session', { projectId, sessionId }),
  hideSession: (projectId, sessionId) =>
    call<void>('config_hide_session', { projectId, sessionId }),
  unhideSession: (projectId, sessionId) =>
    call<void>('config_unhide_session', { projectId, sessionId }),
  hideSessions: (projectId, sessionIds) =>
    call<void>('config_hide_sessions', { projectId, sessionIds }),
  unhideSessions: (projectId, sessionIds) =>
    call<void>('config_unhide_sessions', { projectId, sessionIds }),
  getClaudeRootInfo: () => call<ClaudeRootInfo>('config_get_claude_root_info'),
  openInEditor: () => call<void>('config_open_in_editor'),
  addBookmark: (sessionId, projectId, groupId, note) =>
    call<void>('config_add_bookmark', { sessionId, projectId, groupId, note: note ?? null }),
  removeBookmark: (bookmarkId) => call<void>('config_remove_bookmark', { bookmarkId }),
  getBookmarks: () =>
    call<
      {
        id: string;
        sessionId: string;
        projectId: string;
        groupId: string;
        note?: string;
        createdAt: number;
      }[]
    >('config_get_bookmarks'),
  setSessionTags: (sessionId, tags) => call<void>('config_set_session_tags', { sessionId, tags }),
  getSessionTags: (sessionId) => call<string[]>('config_get_session_tags', { sessionId }),
  addAnnotation: ({ sessionId, projectId, targetId, text, color }) =>
    call<AnnotationEntry>('config_add_annotation', {
      sessionId,
      projectId,
      targetId,
      text,
      color,
    }),
  updateAnnotation: (annotationId, patch) =>
    call<boolean>('config_update_annotation', {
      annotationId,
      text: patch.text ?? null,
      color: patch.color ?? null,
    }),
  removeAnnotation: (annotationId) => call<void>('config_remove_annotation', { annotationId }),
  getAnnotations: () => call<AnnotationEntry[]>('config_get_annotations'),
  createGroup: (name) => call<boolean>('config_create_group', { name }),
  deleteGroup: (name) => call<void>('config_delete_group', { name }),
  addToGroup: (name, sessionId) => call<void>('config_add_to_group', { name, sessionId }),
  removeFromGroup: (name, sessionId) => call<void>('config_remove_from_group', { name, sessionId }),
  getGroups: () => call<Record<string, string[]>>('config_get_groups'),
  addFilterPreset: (name, filter) =>
    call<FilterPresetEntry>('config_add_filter_preset', { name, filter }),
  removeFilterPreset: (presetId) => call<void>('config_remove_filter_preset', { presetId }),
  renameFilterPreset: (presetId, name) =>
    call<boolean>('config_rename_filter_preset', { presetId, name }),
  setDefaultFilterPreset: (presetId) => call<void>('config_set_default_filter_preset', { presetId }),
  exportAnnotations: (sessionIds) => call<string>('config_export_annotations', { sessionIds }),
  importAnnotations: (json) =>
    call<AnnotationImportReport>('config_import_annotations', { jsonStr: json }),
  getDismissedSuggestions: () => call<string[]>('get_dismissed_suggestions'),
  dismissSuggestion: (rule) => call<void>('dismiss_suggestion', { rule }),
};
