

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { SessionDetail } from '@shared/types';
import type { SnapshotMeta } from '@shared/types/api';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:snapshot');

export interface SnapshotSlice {
  snapshots: SnapshotMeta[];
  snapshotsLoading: boolean;
  snapshotDetails: Map<string, SessionDetail>;

  fetchSnapshots: () => Promise<void>;
  createSnapshotFromSession: (
    projectId: string,
    sessionId: string,
    label?: string
  ) => Promise<SnapshotMeta | null>;
  deleteSnapshot: (snapshotId: string) => Promise<void>;
  loadSnapshotDetail: (snapshotId: string) => Promise<SessionDetail | null>;
}

export const createSnapshotSlice: StateCreator<AppState, [], [], SnapshotSlice> = (set, get) => ({
  snapshots: [],
  snapshotsLoading: false,
  snapshotDetails: new Map(),

  fetchSnapshots: async () => {
    set({ snapshotsLoading: true });
    try {
      const list = await api.snapshots.list();
      set({ snapshots: list, snapshotsLoading: false });
    } catch (error) {
      logger.error('Failed to fetch snapshots:', error);
      set({ snapshotsLoading: false });
    }
  },

  createSnapshotFromSession: async (projectId, sessionId, label) => {
    try {
      const meta = await api.snapshots.createFromSession(projectId, sessionId, label);
      const list = await api.snapshots.list();
      set({ snapshots: list });
      return meta;
    } catch (error) {
      logger.error('Failed to create snapshot:', error);
      return null;
    }
  },

  deleteSnapshot: async (snapshotId) => {
    try {
      await api.snapshots.delete(snapshotId);
      const next = get().snapshots.filter((s) => s.id !== snapshotId);
      const cache = new Map(get().snapshotDetails);
      cache.delete(snapshotId);
      set({ snapshots: next, snapshotDetails: cache });
    } catch (error) {
      logger.error('Failed to delete snapshot:', error);
    }
  },

  loadSnapshotDetail: async (snapshotId) => {
    const cached = get().snapshotDetails.get(snapshotId);
    if (cached) return cached;
    try {
      const detail = await api.snapshots.open(snapshotId);
      const cache = new Map(get().snapshotDetails);
      cache.set(snapshotId, detail);
      set({ snapshotDetails: cache });
      return detail;
    } catch (error) {
      logger.error('Failed to open snapshot:', error);
      return null;
    }
  },
});
