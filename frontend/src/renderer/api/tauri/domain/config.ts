import type {
  AnnotationEntry,
  AppConfig,
  ClaudeRootInfo,
  ClaudeRootFolderSelection,
  ConfigAPI,
  FilterPresetEntry,
  NotificationsAPI,
  NotificationTrigger,
  TriggerTestResult,
  WebhookAPI,
  WslClaudeRootCandidate,
} from '@shared/types';
import type { AnnotationImportReport } from '@shared/types/api';
import { open } from '@tauri-apps/plugin-dialog';

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
// Tauri invoke bridge. testTrigger is NotifyService-backed (W14) — the Wails
// twin routes it through NotificationsTestTrigger, so the Tauri twin calls
// `notifications_test_trigger`. The remaining ConfigAPI methods are host APIs
// not ported here — selectFolders / selectClaudeRootFolder / findWslClaudeRoots
// (native dialogs / WSL) — so they fall through to makeSlice's notPorted stub.
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
  | 'testTrigger'
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
  | 'selectFolders'
  | 'selectClaudeRootFolder'
  | 'findWslClaudeRoots'
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
  // Wails passes null for the limit arg; match it.
  testTrigger: (trigger) =>
    call<TriggerTestResult>('notifications_test_trigger', { trigger, limit: null }),
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
  selectFolders: async (): Promise<string[]> => {
    const selected = await open({ directory: true, multiple: true });
    if (Array.isArray(selected)) return selected;
    return selected ? [selected] : [];
  },
  selectClaudeRootFolder: async (): Promise<ClaudeRootFolderSelection | null> => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return null;
    return {
      path: selected,
      isClaudeDirName: selected.endsWith('.claude'),
      hasProjectsDir: false,
    };
  },
  findWslClaudeRoots: async (): Promise<WslClaudeRootCandidate[]> => [],
};

// NotifyService-backed store methods of the WailsAPI.notifications slice (W14).
// Mirrors the Wails notificationsApiImpl (domain/config.ts) method-for-method.
// The three event methods (onNew/onUpdated/onClicked) live in notificationEvents
// above. No reviveDates: DetectedError.createdAt/timestamp are plain numbers and
// the Wails twin revives nothing here. The registered `get_state` command has no
// counterpart on the NotificationsAPI contract, so it is intentionally unwired.
type NotificationsCommands = Pick<
  NotificationsAPI,
  | 'get'
  | 'markRead'
  | 'markAllRead'
  | 'delete'
  | 'clear'
  | 'getUnreadCount'
  | 'setNotificationPolicy'
  | 'raiseConfigDrift'
>;

export const notificationsApi: NotificationsCommands = {
  get: (options) =>
    call<Awaited<ReturnType<NotificationsAPI['get']>>>('notifications_get', {
      options: options ?? null,
    }),
  markRead: (id) => call<boolean>('notifications_mark_read', { id }),
  markAllRead: () => call<boolean>('notifications_mark_all_read'),
  delete: (id) => call<boolean>('notifications_delete', { id }),
  clear: () => call<boolean>('notifications_clear'),
  getUnreadCount: () => call<number>('notifications_get_unread_count'),
  setNotificationPolicy: (retentionDays, maxCount) =>
    call<[number, number]>('set_notification_policy', { retentionDays, maxCount }),
  raiseConfigDrift: (file, hourBucket, keyCount) =>
    call<void>('raise_config_drift', { file, hourBucket, keyCount }),
};

// NotifyService-backed webhook slice (W14). Mirrors the Wails webhookApiImpl.
export const webhookApi: WebhookAPI = {
  testSend: (endpoint) => call<void>('webhook_test_send', { endpoint }),
};
