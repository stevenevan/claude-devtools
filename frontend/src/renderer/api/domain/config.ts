import { Dialogs, Events } from '@wailsio/runtime';

import {
  ConfigAddAnnotation,
  ConfigAddBookmark,
  ConfigAddFilterPreset,
  ConfigAddIgnoreRegex,
  ConfigAddIgnoreRepository,
  ConfigAddToGroup,
  ConfigAddTrigger,
  ConfigClearSnooze,
  ConfigCreateGroup,
  ConfigDeleteGroup,
  ConfigExportAnnotations,
  ConfigGet,
  ConfigGetAnnotations,
  ConfigGetBookmarks,
  ConfigGetClaudeRootInfo,
  ConfigGetGroups,
  ConfigGetSessionTags,
  ConfigGetTriggers,
  ConfigHideSession,
  ConfigHideSessions,
  ConfigImportAnnotations,
  ConfigOpenInEditor,
  ConfigPinSession,
  ConfigRemoveAnnotation,
  ConfigRemoveBookmark,
  ConfigRemoveFilterPreset,
  ConfigRemoveFromGroup,
  ConfigRemoveIgnoreRegex,
  ConfigRemoveIgnoreRepository,
  ConfigRemoveTrigger,
  ConfigRenameFilterPreset,
  ConfigSetDefaultFilterPreset,
  ConfigSetSessionTags,
  ConfigSnooze,
  ConfigUnhideSession,
  ConfigUnhideSessions,
  ConfigUnpinSession,
  ConfigUpdate,
  ConfigUpdateAnnotation,
  ConfigUpdateTrigger,
  DismissSuggestion,
  GetDismissedSuggestions,
} from '../../../../bindings/claude-devtools/internal/configservice/configservice';
import {
  NotificationsClear,
  NotificationsDelete,
  NotificationsGet,
  NotificationsGetUnreadCount,
  NotificationsMarkAllRead,
  NotificationsMarkRead,
  NotificationsTestTrigger,
  RaiseConfigDrift,
  SetNotificationPolicy,
  WebhookTestSend,
} from '../../../../bindings/claude-devtools/internal/notifyservice/notificationservice';
import { SessionScrollToLine } from '../../../../bindings/claude-devtools/internal/sessionservice/sessionservice';
import { PluginsDiscover } from '../../../../bindings/claude-devtools/internal/systemservice/systemservice';

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
  get: () => ConfigGet() as unknown as Promise<AppConfig>,
  update: (section, data) => ConfigUpdate(section, data) as unknown as Promise<AppConfig>,
  addIgnoreRegex: (pattern) => ConfigAddIgnoreRegex(pattern) as unknown as Promise<AppConfig>,
  removeIgnoreRegex: (pattern) => ConfigRemoveIgnoreRegex(pattern) as unknown as Promise<AppConfig>,
  addIgnoreRepository: (repositoryId) =>
    ConfigAddIgnoreRepository(repositoryId) as unknown as Promise<AppConfig>,
  removeIgnoreRepository: (repositoryId) =>
    ConfigRemoveIgnoreRepository(repositoryId) as unknown as Promise<AppConfig>,
  snooze: (minutes) => ConfigSnooze(minutes) as unknown as Promise<AppConfig>,
  clearSnooze: () => ConfigClearSnooze() as unknown as Promise<AppConfig>,
  addTrigger: (trigger) =>
    ConfigAddTrigger(trigger as unknown as Parameters<typeof ConfigAddTrigger>[0]) as unknown as Promise<AppConfig>,
  updateTrigger: (triggerId, updates) =>
    ConfigUpdateTrigger(triggerId, updates) as unknown as Promise<AppConfig>,
  removeTrigger: (triggerId) => ConfigRemoveTrigger(triggerId) as unknown as Promise<AppConfig>,
  getTriggers: () => ConfigGetTriggers() as unknown as Promise<NotificationTrigger[]>,
  testTrigger: (trigger: NotificationTrigger): Promise<TriggerTestResult> =>
    NotificationsTestTrigger(
      trigger as unknown as Parameters<typeof NotificationsTestTrigger>[0],
      null
    ) as unknown as Promise<TriggerTestResult>,
  pinSession: (projectId, sessionId) => ConfigPinSession(projectId, sessionId),
  unpinSession: (projectId, sessionId) => ConfigUnpinSession(projectId, sessionId),
  hideSession: (projectId, sessionId) => ConfigHideSession(projectId, sessionId),
  unhideSession: (projectId, sessionId) => ConfigUnhideSession(projectId, sessionId),
  hideSessions: (projectId, sessionIds) => ConfigHideSessions(projectId, sessionIds),
  unhideSessions: (projectId, sessionIds) => ConfigUnhideSessions(projectId, sessionIds),
  getClaudeRootInfo: () => ConfigGetClaudeRootInfo() as unknown as Promise<ClaudeRootInfo>,
  openInEditor: () => ConfigOpenInEditor(),
  addBookmark: (sessionId: string, projectId: string, groupId: string, note?: string) =>
    ConfigAddBookmark(sessionId, projectId, groupId, note ?? null),
  removeBookmark: (bookmarkId: string) => ConfigRemoveBookmark(bookmarkId),
  getBookmarks: () =>
    ConfigGetBookmarks() as unknown as Promise<
      {
        id: string;
        sessionId: string;
        projectId: string;
        groupId: string;
        note?: string;
        createdAt: number;
      }[]
    >,
  setSessionTags: (sessionId: string, tags: string[]) => ConfigSetSessionTags(sessionId, tags),
  getSessionTags: (sessionId: string) =>
    ConfigGetSessionTags(sessionId) as unknown as Promise<string[]>,
  addAnnotation: ({ sessionId, projectId, targetId, text, color }) =>
    ConfigAddAnnotation(
      sessionId,
      projectId,
      targetId,
      text,
      color
    ) as unknown as Promise<AnnotationEntry>,
  updateAnnotation: (annotationId, patch) =>
    ConfigUpdateAnnotation(annotationId, patch.text ?? null, patch.color ?? null),
  removeAnnotation: (annotationId) => ConfigRemoveAnnotation(annotationId),
  getAnnotations: () => ConfigGetAnnotations() as unknown as Promise<AnnotationEntry[]>,
  createGroup: (name: string) => ConfigCreateGroup(name),
  deleteGroup: (name: string) => ConfigDeleteGroup(name),
  addToGroup: (name: string, sessionId: string) => ConfigAddToGroup(name, sessionId),
  removeFromGroup: (name: string, sessionId: string) => ConfigRemoveFromGroup(name, sessionId),
  getGroups: () => ConfigGetGroups() as unknown as Promise<Record<string, string[]>>,
  addFilterPreset: (name, filter) =>
    ConfigAddFilterPreset(name, filter) as unknown as Promise<FilterPresetEntry>,
  removeFilterPreset: (presetId) => ConfigRemoveFilterPreset(presetId),
  renameFilterPreset: (presetId, name) => ConfigRenameFilterPreset(presetId, name),
  setDefaultFilterPreset: (presetId) => ConfigSetDefaultFilterPreset(presetId),
  exportAnnotations: (sessionIds) => ConfigExportAnnotations(sessionIds),
  importAnnotations: (json) =>
    ConfigImportAnnotations(json) as unknown as Promise<AnnotationImportReport>,
  getDismissedSuggestions: () => GetDismissedSuggestions() as unknown as Promise<string[]>,
  dismissSuggestion: (rule) => DismissSuggestion(rule),

  selectFolders: async (): Promise<string[]> => {
    const result = await Dialogs.OpenFile({
      CanChooseDirectories: true,
      CanChooseFiles: false,
      AllowsMultipleSelection: true,
    });
    return result;
  },
  selectClaudeRootFolder: async (): Promise<ClaudeRootFolderSelection | null> => {
    const result = await Dialogs.OpenFile({
      CanChooseDirectories: true,
      CanChooseFiles: false,
    });
    if (!result) return null;
    return {
      path: result,
      isClaudeDirName: result.endsWith('.claude'),
      hasProjectsDir: false,
    };
  },
  findWslClaudeRoots: async (): Promise<WslClaudeRootCandidate[]> => [],
};

const notificationsApiImpl: NotificationsAPI = {
  get: (options) =>
    NotificationsGet(
      options as unknown as Parameters<typeof NotificationsGet>[0]
    ) as unknown as ReturnType<NotificationsAPI['get']>,
  markRead: (id) => NotificationsMarkRead(id),
  markAllRead: () => NotificationsMarkAllRead(),
  delete: (id) => NotificationsDelete(id),
  clear: () => NotificationsClear(),
  getUnreadCount: () => NotificationsGetUnreadCount(),
  onNew: (callback) => {
    const off = Events.On('notification:new', (e) => {
      callback(null, e.data);
    });
    return off;
  },
  onUpdated: (callback) => {
    const off = Events.On('notification:updated', (e) => {
      callback(null, e.data as { total: number; unreadCount: number });
    });
    return off;
  },
  onClicked: (callback) => {
    const off = Events.On('notification:clicked', (e) => {
      callback(null, e.data);
    });
    return off;
  },
  setNotificationPolicy: (retentionDays, maxCount) =>
    SetNotificationPolicy(retentionDays, maxCount) as unknown as Promise<[number, number]>,
  raiseConfigDrift: (file, hourBucket, keyCount) =>
    RaiseConfigDrift(file, hourBucket, keyCount),
};

const sessionApiImpl: SessionAPI = {
  scrollToLine: (sessionId: string, lineNumber: number) =>
    SessionScrollToLine(sessionId, lineNumber) as unknown as Promise<void>,
};

const pluginsApiImpl: PluginsAPI = {
  list: () => PluginsDiscover() as unknown as Promise<PluginEntry[]>,
};

const webhookApiImpl: WebhookAPI = {
  testSend: (endpoint) =>
    WebhookTestSend(endpoint as unknown as Parameters<typeof WebhookTestSend>[0]),
};

export const configApi: ConfigSlice = {
  config: configApiImpl,
  notifications: notificationsApiImpl,
  session: sessionApiImpl,
  plugins: pluginsApiImpl,
  webhook: webhookApiImpl,
};
