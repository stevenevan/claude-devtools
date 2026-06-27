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
}
