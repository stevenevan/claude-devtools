import { Events } from '@wailsio/runtime';

import {
  CancelScan,
  EmptyTrash,
  ListTrash,
  RestoreTrash,
  ScanClaudeDir,
  TrashItems,
} from '../../../../bindings/claude-devtools/internal/maintenanceservice/maintenanceservice';

import { reviveDates } from '../reviveDates';

import type {
  DirUsage,
  ElectronAPI,
  MaintenanceScanProgress,
  TrashReceipt,
} from '@shared/types';

type MaintenanceSlice = Pick<ElectronAPI, 'maintenance'>;

export const maintenanceApi: MaintenanceSlice = {
  maintenance: {
    scanClaudeDir: async (): Promise<DirUsage[]> => {
      const raw = await ScanClaudeDir();
      return reviveDates(raw as unknown as DirUsage[]);
    },

    cancelScan: (): Promise<void> => CancelScan(),

    onScanProgress: (callback: (progress: MaintenanceScanProgress) => void): (() => void) => {
      const off = Events.On('maintenance:scan-progress', (e) => {
        callback(e.data as MaintenanceScanProgress);
      });
      return off;
    },

    trashItems: async (paths: string[]): Promise<TrashReceipt> => {
      const raw = await TrashItems(paths);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    listTrash: async (): Promise<TrashReceipt[]> => {
      const raw = await ListTrash();
      return reviveDates(raw as unknown as TrashReceipt[]);
    },

    restoreTrash: (id: string): Promise<void> => RestoreTrash(id),

    emptyTrash: (ids: string[]): Promise<void> => EmptyTrash(ids),

    onMuteWatcher: (callback: (muted: boolean) => void): (() => void) => {
      const off = Events.On('maintenance:mute-watcher', (e) => {
        callback((e.data as { muted: boolean }).muted);
      });
      return off;
    },
  },
};
