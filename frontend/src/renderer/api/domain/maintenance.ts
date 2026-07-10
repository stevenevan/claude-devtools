import { Events } from '@wailsio/runtime';

import {
  AnalyzeHistory,
  CancelScan,
  EmptyTrash,
  GetMaintenanceCutoff,
  ListTrash,
  PruneHistory,
  ReadPlanFile,
  RestoreTrash,
  RollbackBinary,
  ScanCategory,
  ScanClaudeDir,
  SetMaintenanceCutoff,
  TrashItems,
} from '../../../../bindings/claude-devtools/internal/maintenanceservice/maintenanceservice';

import { reviveDates } from '../reviveDates';

import type {
  Candidate,
  DirUsage,
  ElectronAPI,
  HistoryStats,
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

    scanCategory: async (id: string): Promise<Candidate[]> => {
      const raw = await ScanCategory(id);
      return reviveDates(raw as unknown as Candidate[]);
    },

    getCutoff: (id: string): Promise<number> => GetMaintenanceCutoff(id),

    setCutoff: (id: string, days: number): Promise<void> => SetMaintenanceCutoff(id, days),

    readPlanFile: (name: string): Promise<string> => ReadPlanFile(name),

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

    rollbackBinary: async (activePath: string, backupPath: string): Promise<TrashReceipt> => {
      const raw = await RollbackBinary(activePath, backupPath);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    analyzeHistory: async (): Promise<HistoryStats> => {
      const raw = await AnalyzeHistory();
      return reviveDates(raw as unknown as HistoryStats);
    },

    pruneHistory: async (cutoffDays: number): Promise<TrashReceipt> => {
      const raw = await PruneHistory(cutoffDays);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    onTrashed: (callback: (projects: string[]) => void): (() => void) => {
      const off = Events.On('maintenance:trashed', (e) => {
        callback((e.data as { projects: string[] }).projects);
      });
      return off;
    },
  },
};
