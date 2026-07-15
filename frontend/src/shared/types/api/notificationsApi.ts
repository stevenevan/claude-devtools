// Notifications API

import type { DetectedError } from '../notifications';

interface NotificationsResult {
  notifications: DetectedError[];
  total: number;
  totalCount: number;
  unreadCount: number;
  hasMore: boolean;
}

export interface NotificationsAPI {
  get: (options?: { limit?: number; offset?: number }) => Promise<NotificationsResult>;
  markRead: (id: string) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  delete: (id: string) => Promise<boolean>;
  clear: () => Promise<boolean>;
  getUnreadCount: () => Promise<number>;
  onNew: (callback: (event: unknown, error: unknown) => void) => () => void;
  onUpdated: (
    callback: (event: unknown, payload: { total: number; unreadCount: number }) => void
  ) => () => void;
  onClicked: (callback: (event: unknown, data: unknown) => void) => () => void;
  // Week 13 auto-prune bounds. Returns the clamped [retentionDays, maxCount].
  setNotificationPolicy: (retentionDays: number, maxCount: number) => Promise<[number, number]>;
  // Week 32 config-drift alert. The backend builds the DetectedError + synthetic
  // ToolUseID dedup ("config-drift:<file>:<hourBucket>"); the frontend listener
  // only mute-correlates + debounces before calling this. keyCount is 0 (the
  // frontend has no diff — the deep-linked diff view shows detail).
  raiseConfigDrift: (file: string, hourBucket: number, keyCount: number) => Promise<void>;
}
