import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

import type {
  AnnotationEntry,
  AppConfig,
  ClaudeRootFolderSelection,
  ClaudeRootInfo,
  ConfigAPI,
  ElectronAPI,
  FilterPresetEntry,
  NotificationsAPI,
  NotificationTrigger,
  PluginEntry,
  PluginsAPI,
  SessionAPI,
  TriggerTestResult,
  WebhookAPI,
  WslClaudeRootCandidate,
} from '@shared/types';
import type { AnnotationImportReport } from '@shared/types/api';

type ConfigSlice = Pick<
  ElectronAPI,
  'config' | 'notifications' | 'session' | 'plugins' | 'webhook'
>;

const configApiImpl: ConfigAPI = {
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
  unpinSession: (projectId, sessionId) => invoke('config_unpin_session', { projectId, sessionId }),
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
  removeBookmark: (bookmarkId: string) => invoke('config_remove_bookmark', { bookmarkId }),
  getBookmarks: () =>
    invoke<
      {
        id: string;
        sessionId: string;
        projectId: string;
        groupId: string;
        note?: string;
        createdAt: number;
      }[]
    >('config_get_bookmarks'),
  setSessionTags: (sessionId: string, tags: string[]) =>
    invoke('config_set_session_tags', { sessionId, tags }),
  getSessionTags: (sessionId: string) => invoke<string[]>('config_get_session_tags', { sessionId }),
  addAnnotation: ({ sessionId, projectId, targetId, text, color }) =>
    invoke<AnnotationEntry>('config_add_annotation', {
      sessionId,
      projectId,
      targetId,
      text,
      color,
    }),
  updateAnnotation: (annotationId, patch) =>
    invoke<boolean>('config_update_annotation', {
      annotationId,
      text: patch.text ?? null,
      color: patch.color ?? null,
    }),
  removeAnnotation: (annotationId) => invoke('config_remove_annotation', { annotationId }),
  getAnnotations: () => invoke<AnnotationEntry[]>('config_get_annotations'),
  createGroup: (name: string) => invoke<boolean>('config_create_group', { name }),
  deleteGroup: (name: string) => invoke<void>('config_delete_group', { name }),
  addToGroup: (name: string, sessionId: string) =>
    invoke<void>('config_add_to_group', { name, sessionId }),
  removeFromGroup: (name: string, sessionId: string) =>
    invoke<void>('config_remove_from_group', { name, sessionId }),
  getGroups: () => invoke<Record<string, string[]>>('config_get_groups'),
  addFilterPreset: (name, filter) =>
    invoke<FilterPresetEntry>('config_add_filter_preset', { name, filter }),
  removeFilterPreset: (presetId) => invoke<void>('config_remove_filter_preset', { presetId }),
  renameFilterPreset: (presetId, name) =>
    invoke<boolean>('config_rename_filter_preset', { presetId, name }),
  setDefaultFilterPreset: (presetId) =>
    invoke<void>('config_set_default_filter_preset', { presetId }),
  exportAnnotations: (sessionIds) => invoke<string>('config_export_annotations', { sessionIds }),
  importAnnotations: (json) =>
    invoke<AnnotationImportReport>('config_import_annotations', { json }),

  selectFolders: async (): Promise<string[]> => {
    const result = await open({ directory: true, multiple: true });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  },
  selectClaudeRootFolder: async (): Promise<ClaudeRootFolderSelection | null> => {
    const result = (await open({ directory: true, multiple: false })) as string | string[] | null;
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

const notificationsApiImpl: NotificationsAPI = {
  get: (options) => invoke('notifications_get', { options }),
  markRead: (id) => invoke<boolean>('notifications_mark_read', { id }),
  markAllRead: () => invoke<boolean>('notifications_mark_all_read'),
  delete: (id) => invoke<boolean>('notifications_delete', { id }),
  clear: () => invoke<boolean>('notifications_clear'),
  getUnreadCount: () => invoke<number>('notifications_get_unread_count'),
  onNew: (callback) => {
    let unlisten: UnlistenFn | null = null;
    void listen('notification:new', (event) => {
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
    void listen<{ total: number; unreadCount: number }>('notification:updated', (event) => {
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
    void listen('notification:clicked', (event) => {
      callback(null, event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  },
};

const sessionApiImpl: SessionAPI = {
  scrollToLine: (sessionId: string, lineNumber: number) =>
    invoke('session_scroll_to_line', { sessionId, lineNumber }),
};

const pluginsApiImpl: PluginsAPI = {
  list: () => invoke<PluginEntry[]>('plugins_discover'),
};

const webhookApiImpl: WebhookAPI = {
  testSend: (endpoint) => invoke<void>('webhook_test_send', { endpoint }),
};

export const configApi: ConfigSlice = {
  config: configApiImpl,
  notifications: notificationsApiImpl,
  session: sessionApiImpl,
  plugins: pluginsApiImpl,
  webhook: webhookApiImpl,
};
