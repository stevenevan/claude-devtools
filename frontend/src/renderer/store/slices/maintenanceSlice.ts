import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { DirUsage, MaintenanceScanProgress } from '@shared/types';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:maintenance');

export interface MaintenanceSlice {
  dirs: DirUsage[];
  scanning: boolean;
  error: string | null;
  progress: MaintenanceScanProgress | null;

  scanStorage: () => Promise<void>;
  cancelScan: () => Promise<void>;
  setMaintenanceProgress: (progress: MaintenanceScanProgress) => void;
}

export const createMaintenanceSlice: StateCreator<AppState, [], [], MaintenanceSlice> = (
  set,
  get
) => ({
  dirs: [],
  scanning: false,
  error: null,
  progress: null,

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
});
