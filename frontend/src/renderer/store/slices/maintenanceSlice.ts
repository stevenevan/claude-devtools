import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { DirUsage, MaintenanceScanProgress, TrashReceipt } from '@shared/types';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:maintenance');

const LOCAL_ONLY_ERROR = 'Storage maintenance operates on this local machine only';

export interface MaintenanceSlice {
  dirs: DirUsage[];
  scanning: boolean;
  error: string | null;
  progress: MaintenanceScanProgress | null;
  receipts: TrashReceipt[];
  trashLoading: boolean;
  trashError: string | null;

  scanStorage: () => Promise<void>;
  cancelScan: () => Promise<void>;
  setMaintenanceProgress: (progress: MaintenanceScanProgress) => void;
  loadTrash: () => Promise<void>;
  trashItems: (paths: string[]) => Promise<TrashReceipt | null>;
  restoreTrash: (id: string) => Promise<void>;
  emptyTrash: (ids: string[]) => Promise<void>;
}

export const createMaintenanceSlice: StateCreator<AppState, [], [], MaintenanceSlice> = (
  set,
  get
) => ({
  dirs: [],
  scanning: false,
  error: null,
  progress: null,
  receipts: [],
  trashLoading: false,
  trashError: null,

  scanStorage: async () => {
    if (get().connectionMode !== 'local') {
      set({ error: 'Storage maintenance operates on this local machine only' });
      return;
    }

    set({ scanning: true, error: null, progress: null });
    try {
      const dirs = await api.maintenance.scanClaudeDir();
      set({ dirs, scanning: false });
    } catch (err) {
      logger.error('Failed to scan storage:', err);
      set({ scanning: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  cancelScan: async () => {
    try {
      await api.maintenance.cancelScan();
    } catch (err) {
      logger.error('Failed to cancel scan:', err);
    }
  },

  setMaintenanceProgress: (progress) => {
    set({ progress });
  },

  loadTrash: async () => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      const receipts = await api.maintenance.listTrash();
      set({ receipts, trashLoading: false });
    } catch (err) {
      logger.error('Failed to list trash:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },

  trashItems: async (paths) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return null;
    }

    set({ trashLoading: true, trashError: null });
    try {
      const receipt = await api.maintenance.trashItems(paths);
      await get().loadTrash();
      return receipt;
    } catch (err) {
      logger.error('Failed to trash items:', err);
      set({ trashError: err instanceof Error ? err.message : String(err) });
      // A batch can fail partway through; the manifest only records items that
      // actually moved, so refresh to reflect whatever really landed in trash.
      await get().loadTrash();
      return null;
    }
  },

  restoreTrash: async (id) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      await api.maintenance.restoreTrash(id);
      await get().loadTrash();
    } catch (err) {
      logger.error('Failed to restore trash:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },

  emptyTrash: async (ids) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      await api.maintenance.emptyTrash(ids);
      await get().loadTrash();
    } catch (err) {
      logger.error('Failed to empty trash:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },
});
