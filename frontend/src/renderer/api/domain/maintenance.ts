import { Events } from '@wailsio/runtime';

import {
  CancelScan,
  ScanClaudeDir,
} from '../../../../bindings/claude-devtools/internal/maintenanceservice/maintenanceservice';

import { reviveDates } from '../reviveDates';

import type { DirUsage, ElectronAPI, MaintenanceScanProgress } from '@shared/types';

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
  },
};
